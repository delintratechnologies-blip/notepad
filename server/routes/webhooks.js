const router  = require('express').Router();
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Booking = require('../models/Booking');

// ── POST /api/webhooks/stripe ─────────────────────────────────────────────────
router.post('/stripe', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      // Manual-capture intents become capturable once the guest confirms the
      // card — this is when the escrow hold actually exists (BLK-2).
      case 'payment_intent.amount_capturable_updated': {
        const pi = event.data.object;
        await Booking.findOneAndUpdate(
          { stripePaymentIntentId: pi.id },
          { paymentStatus: 'held' }
        );
        break;
      }

      case 'payment_intent.payment_failed': {
        const pi = event.data.object;
        await Booking.findOneAndUpdate(
          { stripePaymentIntentId: pi.id },
          { paymentStatus: 'unpaid', status: 'cancelled' }
        );
        break;
      }

      // NOTE: Daily.co recording webhooks are handled by routes/webhooksDaily.js
      // (mounted at /api/webhooks/daily). They must not be routed here — a Daily
      // payload has no valid Stripe signature and would be rejected above.

      default:
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err.message);
    res.status(500).json({ error: 'Handler failed' });
  }
});

module.exports = router;
