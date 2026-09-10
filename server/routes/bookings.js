const router      = require('express').Router();
const mongoose    = require('mongoose');
const Booking     = require('../models/Booking');
const Availability= require('../models/Availability');
const User        = require('../models/User');
const verifyToken = require('../middleware/verifyToken');
const { validate, BookingSchema, ReviewSchema } = require('../middleware/validate');
const { triggerBadgeCheck }   = require('../services/badges');
const { notify }              = require('../services/notifications');
const { createDailyRoom }     = require('../services/daily');
const { refundPayment }       = require('../services/stripe');
const { recomputeUserRating, recomputeHostResponseMetrics } = require('../services/reviews');
const { completeBooking }     = require('../services/bookingLifecycle');
const stitcher                = require('../stitcher');

// ── GET /api/bookings — list own bookings (paginated) ─────────────────────────
// BUG-8: added pagination — previously returned all bookings with no limit.
router.get('/', verifyToken, async (req, res) => {
  try {
    const { status } = req.query;
    const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = {
      $or: [{ host: req.user.id }, { guest: req.user.id }],
    };
    if (status) filter.status = status;

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .populate('host',  'name avatar podcastName avgRating')
        .populate('guest', 'name avatar expertise avgRating')
        .sort({ slotStart: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Booking.countDocuments(filter),
    ]);

    res.json({
      bookings,
      pagination: { total, page, limit, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── GET /api/bookings/:id ─────────────────────────────────────────────────────
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .populate('host',  'name avatar podcastName')
      .populate('guest', 'name avatar expertise');

    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const isParticipant = [booking.host._id, booking.guest._id]
      .some((id) => id.toString() === req.user.id);
    if (!isParticipant) return res.status(403).json({ error: 'Forbidden' });

    res.json({ booking });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/bookings — create a booking request ─────────────────────────────
// BUG-7: wrapped in a MongoDB transaction so the overlap check and the insert
// are atomic. Without this, two concurrent requests could both pass the conflict
// check before either creates a document, resulting in double-bookings.
router.post('/', verifyToken, validate(BookingSchema), async (req, res) => {
  const session = await mongoose.startSession();
  try {
    session.startTransaction();

    const { hostId, slotStart, slotEnd, topics, message } = req.body;

    if (hostId === req.user.id) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'You cannot book yourself' });
    }

    const host = await User.findById(hostId)
      .select('role isBlocked sessionRateCents')
      .session(session);

    if (!host || host.isBlocked) {
      await session.abortTransaction();
      return res.status(404).json({ error: 'Host not found' });
    }
    if (host.role !== 'host') {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Selected user is not a host' });
    }

    const start = new Date(slotStart);
    const end   = new Date(slotEnd);

    if (end <= start) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'slotEnd must be after slotStart' });
    }
    if (start <= new Date()) {
      await session.abortTransaction();
      return res.status(400).json({ error: 'Cannot book a slot in the past' });
    }

    const conflict = await Booking.findOne({
      host:   hostId,
      status: { $in: ['pending', 'confirmed'] },
      $or:    [{ slotStart: { $lt: end }, slotEnd: { $gt: start } }],
    }).session(session);

    if (conflict) {
      await session.abortTransaction();
      return res.status(409).json({ error: 'Slot already booked' });
    }

    // create() with a session must receive an array and returns an array.
    const [booking] = await Booking.create([{
      host:        hostId,
      guest:       req.user.id,
      slotStart:   start,
      slotEnd:     end,
      topics,
      message,
      amountCents: host.sessionRateCents || 0,
    }], { session });

    await session.commitTransaction();

    // Audit — fire-and-forget after commit succeeds.
    stitcher.audit.logReq(req, {
      collectionName: 'bookings',
      documentId:     booking._id,
      action:         'create',
      actor:          req.user.id,
      actorRole:      req.user.role,
      after: {
        host:        booking.host,
        guest:       booking.guest,
        slotStart:   booking.slotStart,
        slotEnd:     booking.slotEnd,
        status:      booking.status,
        amountCents: booking.amountCents,
      },
    });

    stitcher.events.emit(stitcher.EVENTS.BOOKING_CREATED, {
      bookingId:   booking._id.toString(),
      hostId:      booking.host.toString(),
      guestId:     booking.guest.toString(),
      amountCents: booking.amountCents,
    });

    // Notify outside the transaction — failure must not roll back the booking.
    notify(hostId, {
      type:  'booking_request',
      title: 'New booking request',
      body:  'You have a new podcast booking request',
      link:  `/bookings/${booking._id}`,
    }).catch((err) => console.error('Notify failed:', err.message));

    res.status(201).json({ booking });
  } catch (err) {
    // abortTransaction can itself throw if commitTransaction already ran and
    // the session transitioned to a terminal state — swallow that error.
    await session.abortTransaction().catch(() => {});
    // E11000 = duplicate key from the unique partial index (committed conflict).
    // 112    = WriteConflict when two concurrent transactions race to commit.
    if (err.code === 11000 || err.code === 112) {
      return res.status(409).json({ error: 'Slot already booked' });
    }
    res.status(err.status || 500).json({ error: err.message });
  } finally {
    session.endSession();
  }
});

// ── PATCH /api/bookings/:id/confirm ──────────────────────────────────────────
router.patch('/:id/confirm', verifyToken, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Not found' });
    if (booking.host.toString() !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (booking.status !== 'pending') return res.status(400).json({ error: 'Cannot confirm' });

    const { roomUrl } = await createDailyRoom(booking._id.toString());

    const prevStatus     = booking.status;
    booking.status       = 'confirmed';
    booking.dailyRoomUrl = roomUrl;
    booking.respondedAt  = new Date();  // BUG-4
    await booking.save();

    stitcher.audit.logReq(req, {
      collectionName: 'bookings',
      documentId:     booking._id,
      action:         'update',
      actor:          req.user.id,
      actorRole:      req.user.role,
      before: { status: prevStatus },
      after:  { status: 'confirmed', respondedAt: booking.respondedAt },
    });

    stitcher.events.emit(stitcher.EVENTS.BOOKING_CONFIRMED, {
      bookingId: booking._id.toString(),
      hostId:    booking.host.toString(),
      guestId:   booking.guest.toString(),
    });

    // BUG-3: mark the matching availability slot as booked (best-effort — a
    // booking can exist without a formal availability slot, so no error if absent).
    Availability.updateOne(
      { user: booking.host, start: booking.slotStart, end: booking.slotEnd, isBooked: false },
      { isBooked: true }
    ).catch((err) => console.error('Availability update failed:', err.message));

    // BUG-4: update host response metrics (async, non-blocking).
    recomputeHostResponseMetrics(booking.host.toString())
      .catch((err) => console.error('Response metrics failed:', err.message));

    notify(booking.guest.toString(), {
      type:  'booking_confirmed',
      title: 'Booking confirmed!',
      body:  'Your podcast session has been confirmed.',
      link:  `/bookings/${booking._id}`,
    }).catch((err) => console.error('Notify failed:', err.message));

    res.json({ booking });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PATCH /api/bookings/:id/cancel ────────────────────────────────────────────
router.patch('/:id/cancel', verifyToken, async (req, res) => {
  try {
    // BUG-1 + BUG-6: select stripePaymentIntentId so we can issue the refund.
    const booking = await Booking.findById(req.params.id).select('+stripePaymentIntentId');
    if (!booking) return res.status(404).json({ error: 'Not found' });
    const statusBeforeCancel = booking.status;

    const isParticipant = [booking.host, booking.guest]
      .some((id) => id.toString() === req.user.id);
    if (!isParticipant) return res.status(403).json({ error: 'Forbidden' });

    if (['completed', 'cancelled'].includes(booking.status)) {
      return res.status(400).json({ error: 'Cannot cancel' });
    }

    // BUG-6: refund held payment before cancelling.
    if (booking.paymentStatus === 'held' && booking.stripePaymentIntentId) {
      try {
        await refundPayment(booking.stripePaymentIntentId);
        booking.paymentStatus = 'refunded';
      } catch (refundErr) {
        // Log and continue — cancellation proceeds; finance team reconciles manually.
        console.error(`Refund failed for booking ${booking._id}:`, refundErr.message);
      }
    }

    booking.status = 'cancelled';
    // BUG-4: record response time when host declines a pending request.
    if (!booking.respondedAt) booking.respondedAt = new Date();
    await booking.save();

    stitcher.audit.logReq(req, {
      collectionName: 'bookings',
      documentId:     booking._id,
      action:         'update',
      actor:          req.user.id,
      actorRole:      req.user.role,
      before: { status: statusBeforeCancel, paymentStatus: booking.paymentStatus },
      after:  { status: 'cancelled',        paymentStatus: booking.paymentStatus },
    });

    stitcher.events.emit(stitcher.EVENTS.BOOKING_CANCELLED, {
      bookingId: booking._id.toString(),
      hostId:    booking.host.toString(),
      guestId:   booking.guest.toString(),
      refunded:  booking.paymentStatus === 'refunded',
    });

    // BUG-4: update host response metrics (async, non-blocking).
    recomputeHostResponseMetrics(booking.host.toString())
      .catch((err) => console.error('Response metrics failed:', err.message));

    res.json({ booking });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/bookings/:id/review ─────────────────────────────────────────────
router.post('/:id/review', verifyToken, validate(ReviewSchema), async (req, res) => {
  try {
    const { rating, comment } = req.body;
    const booking = await Booking.findById(req.params.id);
    if (!booking) return res.status(404).json({ error: 'Not found' });
    if (booking.status !== 'completed') return res.status(400).json({ error: 'Booking not completed' });

    const isHost  = booking.host.toString()  === req.user.id;
    const isGuest = booking.guest.toString() === req.user.id;
    if (!isHost && !isGuest) return res.status(403).json({ error: 'Forbidden' });

    if (isGuest) booking.hostReview  = { rating, comment };
    if (isHost)  booking.guestReview = { rating, comment };
    await booking.save();

    const reviewedUserId = isGuest ? booking.host.toString() : booking.guest.toString();

    await recomputeUserRating(reviewedUserId);
    await triggerBadgeCheck(reviewedUserId);

    stitcher.events.emit(stitcher.EVENTS.BOOKING_REVIEWED, {
      bookingId:   booking._id.toString(),
      reviewerId:  req.user.id,
      reviewedId:  reviewedUserId,
      rating,
    });

    res.json({ booking });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── PATCH /api/bookings/:id/complete ─────────────────────────────────────────
// BUG-1: must select +stripePaymentIntentId so completeBooking() can find and
// capture the PaymentIntent. Previously the field was excluded (select: false)
// and the escrow release was silently skipped on every session completion.
router.patch('/:id/complete', verifyToken, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.id)
      .select('+stripePaymentIntentId')
      .populate('host', 'stripeAccountId');
    if (!booking) return res.status(404).json({ error: 'Not found' });

    const isParticipant = [booking.host._id, booking.guest]
      .some((id) => id.toString() === req.user.id);
    if (!isParticipant) return res.status(403).json({ error: 'Forbidden' });

    if (booking.status !== 'confirmed') {
      return res.status(400).json({ error: 'Only a confirmed booking can be completed' });
    }

    await completeBooking(booking);

    stitcher.audit.logReq(req, {
      collectionName: 'bookings',
      documentId:     booking._id,
      action:         'update',
      actor:          req.user.id,
      actorRole:      req.user.role,
      before: { status: 'confirmed' },
      after:  { status: 'completed', recordingReady: booking.recordingReady },
    });

    stitcher.events.emit(stitcher.EVENTS.BOOKING_COMPLETED, {
      bookingId: booking._id.toString(),
      hostId:    booking.host._id.toString(),
      guestId:   booking.guest.toString(),
    });

    res.json({ booking });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
