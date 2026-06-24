const router      = require('express').Router();
const Message     = require('../models/Message');
const Booking     = require('../models/Booking');
const verifyToken = require('../middleware/verifyToken');
const { validate, MessageSchema } = require('../middleware/validate');
const { notify } = require('../services/notifications');

// ── GET /api/messages/:bookingId ──────────────────────────────────────────────
router.get('/:bookingId', verifyToken, async (req, res) => {
  try {
    const booking = await Booking.findById(req.params.bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const isParticipant = [booking.host, booking.guest]
      .some((id) => id.toString() === req.user.id);
    if (!isParticipant) return res.status(403).json({ error: 'Forbidden' });

    const messages = await Message.find({ booking: req.params.bookingId })
      .populate('sender', 'name avatar')
      .sort({ createdAt: 1 });

    // Mark unread messages as read
    await Message.updateMany(
      { booking: req.params.bookingId, sender: { $ne: req.user.id }, isRead: false },
      { isRead: true }
    );

    res.json({ messages });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/messages — send message ─────────────────────────────────────────
router.post('/', verifyToken, validate(MessageSchema), async (req, res) => {
  try {
    const { bookingId, content } = req.body;
    const booking = await Booking.findById(bookingId);
    if (!booking) return res.status(404).json({ error: 'Booking not found' });

    const isParticipant = [booking.host, booking.guest]
      .some((id) => id.toString() === req.user.id);
    if (!isParticipant) return res.status(403).json({ error: 'Forbidden' });

    const message = await Message.create({
      booking: bookingId,
      sender:  req.user.id,
      content,
    });

    const recipientId = booking.host.toString() === req.user.id
      ? booking.guest.toString()
      : booking.host.toString();

    await notify(recipientId, {
      type:  'message',
      title: 'New message',
      body:  content.slice(0, 60),
      link:  `/bookings/${bookingId}`,
    });

    const populated = await message.populate('sender', 'name avatar');
    res.status(201).json({ message: populated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
