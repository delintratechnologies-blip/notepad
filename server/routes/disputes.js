/**
 * Dispute routes — booking dispute lifecycle.
 *
 * Who can do what:
 *   raise         — any authenticated user who is a party to a completed booking
 *   view /my      — authenticated user, own disputes only
 *   view /:id     — the disputing parties or admin
 *   review        — admin only (open → under_review)
 *   resolve       — admin only (open|under_review → resolved)
 *   dismiss       — admin only (open|under_review → dismissed)
 *
 * Booking status transitions driven here:
 *   raise dispute  → booking.status = 'disputed'
 */

const router       = require('express').Router();
const Dispute      = require('../models/Dispute');
const Booking      = require('../models/Booking');
const verifyToken  = require('../middleware/verifyToken');
const requireAdmin = require('../middleware/requireAdmin');
const stitcher     = require('../stitcher');

const VALID_REASONS = ['no_show', 'technical_issue', 'content_violation', 'payment_issue', 'other'];

// ── POST /api/disputes — raise a dispute ──────────────────────────────────────
router.post('/', verifyToken, async (req, res) => {
  try {
    const { bookingId, reason, description } = req.body;

    if (!bookingId || !reason || !description) {
      return res.status(400).json({ error: 'bookingId, reason, and description are required' });
    }
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ error: `reason must be one of: ${VALID_REASONS.join(', ')}` });
    }
    if (description.length < 20) {
      return res.status(400).json({ error: 'description must be at least 20 characters' });
    }

    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const userId  = req.user.id;
    const isHost  = booking.host.toString()  === userId;
    const isGuest = booking.guest.toString() === userId;
    if (!isHost && !isGuest) {
      return res.status(403).json({ error: 'You are not a party to this booking' });
    }

    // A booking in 'disputed' state already has an active dispute.
    if (booking.status === 'disputed') {
      return res.status(409).json({ error: 'A dispute for this booking already exists' });
    }

    // Per policy: disputes may only be raised on completed sessions.
    if (booking.status !== 'completed') {
      return res.status(400).json({
        error: 'Disputes can only be raised on completed bookings',
      });
    }

    // Per policy: max 3 open disputes per user at any time.
    const openCount = await Dispute.countDocuments({
      raisedBy: userId,
      status:   { $in: ['open', 'under_review'] },
    });
    if (openCount >= 3) {
      return res.status(429).json({
        error: 'You have 3 or more open disputes. Resolve existing disputes before raising new ones.',
      });
    }

    const againstUser = isHost ? booking.guest : booking.host;

    const dispute = await Dispute.create({
      booking:     bookingId,
      raisedBy:    userId,
      againstUser,
      reason,
      description,
    });

    await Booking.findByIdAndUpdate(bookingId, { status: 'disputed' });

    stitcher.audit.logReq(req, {
      collectionName: 'disputes',
      documentId:     dispute._id,
      action:         'create',
      actor:          userId,
      after:          { booking: bookingId, reason, status: 'open' },
    });

    stitcher.events.emit(stitcher.EVENTS.DISPUTE_RAISED, {
      disputeId:  dispute._id.toString(),
      bookingId:  bookingId.toString(),
      raisedById: userId,
      againstId:  againstUser.toString(),
    });

    res.status(201).json({ success: true, dispute });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: 'A dispute for this booking already exists' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/disputes/my — authenticated user's own disputes ─────────────────
router.get('/my', verifyToken, async (req, res) => {
  try {
    const disputes = await Dispute.find({ raisedBy: req.user.id })
      .populate('booking',     'slotStart slotEnd status amountCents')
      .populate('againstUser', 'name avatar')
      .sort({ createdAt: -1 });
    res.json({ success: true, disputes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/disputes — admin: all disputes ───────────────────────────────────
router.get('/', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const pg  = Math.max(1, parseInt(page,  10));
    const lim = Math.min(100, Math.max(1, parseInt(limit, 10)));

    const [disputes, total] = await Promise.all([
      Dispute.find(filter)
        .populate('raisedBy',    'name avatar')
        .populate('againstUser', 'name avatar')
        .populate('booking',     'slotStart slotEnd status amountCents')
        .sort({ createdAt: -1 })
        .skip((pg - 1) * lim)
        .limit(lim),
      Dispute.countDocuments(filter),
    ]);

    res.json({ success: true, disputes, total, page: pg, limit: lim });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/disputes/:id — get single dispute (own or admin) ─────────────────
router.get('/:id', verifyToken, async (req, res) => {
  try {
    const dispute = await Dispute.findById(req.params.id)
      .populate('booking',     'slotStart slotEnd status amountCents host guest')
      .populate('raisedBy',    'name avatar')
      .populate('againstUser', 'name avatar')
      .populate('resolvedBy',  'name');

    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });

    const userId    = req.user.id;
    const isAdmin   = req.user.role === 'admin';
    const isParty   = dispute.raisedBy._id.toString() === userId ||
                      dispute.againstUser._id.toString() === userId;

    if (!isAdmin && !isParty) {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json({ success: true, dispute });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/disputes/:id/review — admin: open → under_review ───────────────
router.post('/:id/review', verifyToken, requireAdmin, async (req, res) => {
  try {
    const dispute = await Dispute.findById(req.params.id);
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    if (dispute.status !== 'open') {
      return res.status(400).json({ error: 'Only open disputes can be moved to review' });
    }

    const before    = { status: dispute.status };
    dispute.status  = 'under_review';
    await dispute.save();

    stitcher.audit.logReq(req, {
      collectionName: 'disputes',
      documentId:     dispute._id,
      action:         'update',
      actor:          req.user.id,
      before,
      after:          { status: 'under_review' },
    });

    res.json({ success: true, dispute });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/disputes/:id/resolve — admin: resolve with resolution text ──────
router.post('/:id/resolve', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { resolution } = req.body;
    if (!resolution || resolution.trim().length < 10) {
      return res.status(400).json({ error: 'resolution text (min 10 chars) is required' });
    }

    const dispute = await Dispute.findById(req.params.id);
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    if (!['open', 'under_review'].includes(dispute.status)) {
      return res.status(400).json({ error: 'Dispute is already resolved or dismissed' });
    }

    const before       = { status: dispute.status };
    dispute.status     = 'resolved';
    dispute.resolution = resolution.trim();
    dispute.resolvedBy = req.user.id;
    dispute.resolvedAt = new Date();
    await dispute.save();

    stitcher.audit.logReq(req, {
      collectionName: 'disputes',
      documentId:     dispute._id,
      action:         'update',
      actor:          req.user.id,
      before,
      after:          { status: 'resolved' },
    });

    stitcher.events.emit(stitcher.EVENTS.DISPUTE_RESOLVED, {
      disputeId: dispute._id.toString(),
      bookingId: dispute.booking.toString(),
      resolverId: req.user.id,
    });

    res.json({ success: true, dispute });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/disputes/:id/dismiss — admin: dismiss dispute ──────────────────
router.post('/:id/dismiss', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { resolution } = req.body;

    const dispute = await Dispute.findById(req.params.id);
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    if (!['open', 'under_review'].includes(dispute.status)) {
      return res.status(400).json({ error: 'Dispute is already resolved or dismissed' });
    }

    const before       = { status: dispute.status };
    dispute.status     = 'dismissed';
    dispute.resolvedBy = req.user.id;
    dispute.resolvedAt = new Date();
    if (resolution) dispute.resolution = resolution.trim();
    await dispute.save();

    stitcher.audit.logReq(req, {
      collectionName: 'disputes',
      documentId:     dispute._id,
      action:         'update',
      actor:          req.user.id,
      before,
      after:          { status: 'dismissed' },
    });

    stitcher.events.emit(stitcher.EVENTS.DISPUTE_DISMISSED, {
      disputeId: dispute._id.toString(),
      bookingId: dispute.booking.toString(),
      actorId:   req.user.id,
    });

    res.json({ success: true, dispute });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
