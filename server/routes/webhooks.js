const router  = require('express').Router();
const stripe  = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Booking = require('../models/Booking');
const ProcessedWebhookEvent = require('../models/ProcessedWebhookEvent');

/** Apply the side effects of a verified Stripe event. */
async function applyStripeEvent(event) {
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
}

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

  // Idempotency: claim the event id before doing any work. The unique index on
  // eventId means exactly one delivery gets past this point — whether the
  // duplicate is a Stripe retry (seconds to days later) or a truly concurrent
  // redelivery. Everyone else returns 200 without touching a handler, because
  // Stripe expects a 2xx to stop retrying.
  try {
    await ProcessedWebhookEvent.create({ eventId: event.id, type: event.type });
  } catch (err) {
    if (err && err.code === 11000) {
      return res.status(200).json({ received: true, duplicate: true });
    }
    console.error('Webhook idempotency write failed:', err.message);
    return res.status(500).json({ error: 'Handler failed' });
  }

  // Process. On failure, release the claim so Stripe's retry reprocesses
  // cleanly instead of the event being permanently recorded as done.
  try {
    await applyStripeEvent(event);
    return res.status(200).json({ received: true });
  } catch (err) {
    await ProcessedWebhookEvent.deleteOne({ eventId: event.id }).catch(() => {});
    console.error('Webhook handler error:', err.message);
    return res.status(500).json({ error: 'Handler failed' });
  }
});

module.exports = router;
