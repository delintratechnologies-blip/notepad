const router  = require('express').Router();
const crypto  = require('crypto');
const Booking = require('../models/Booking');
const { completeBooking } = require('../services/bookingLifecycle');

/**
 * POST /api/webhooks/daily
 *
 * Daily.co recording webhook. Previously this logic lived inside the Stripe
 * webhook handler, behind a Stripe signature check it could never pass, so it
 * was unreachable (BLK-1). It now has its own route, mounted with a raw body
 * parser so the HMAC signature can be verified when DAILY_WEBHOOK_SECRET is set.
 */
router.post('/', (req, res) => {
  // req.body is a Buffer (raw parser). Verify signature if a secret is configured.
  const secret = process.env.DAILY_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers['x-webhook-signature'] || '';
    const expected  = crypto.createHmac('sha256', secret).update(req.body).digest('hex');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(400).json({ error: 'Invalid signature' });
    }
  }

  let event;
  try {
    event = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid payload' });
  }

  // Acknowledge immediately; process asynchronously so retries aren't triggered
  // by slow downstream calls (Stripe capture, DB writes).
  res.json({ received: true });

  (async () => {
    try {
      const type = event.type || event.event;
      if (type !== 'recording.completed' && type !== 'recording.ready-to-download') return;

      const payload  = event.payload || event.data?.object || event;
      const roomName = payload.room_name || payload.roomName || payload.room;
      if (!roomName) return;

      // SEC-2: escape regex metacharacters and anchor the match to the end of
      // the URL so `$regex: roomName` cannot be weaponised for ReDoS.
      const safeRoom = roomName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // BUG-1: select +stripePaymentIntentId so completeBooking() can release escrow.
      const booking = await Booking.findOne({ dailyRoomUrl: { $regex: `${safeRoom}$` } })
        .select('+stripePaymentIntentId')
        .populate('host', 'stripeAccountId');
      if (!booking) return;

      const downloadLink = payload.download_link || payload.s3_url || payload.url;
      if (downloadLink) booking.recordingUrl = downloadLink;

      await completeBooking(booking);
    } catch (err) {
      console.error('Daily webhook handler error:', err.message);
    }
  })();
});

module.exports = router;
