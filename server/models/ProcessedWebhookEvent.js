const mongoose = require('mongoose');

// Stripe retries a failing webhook for up to ~72 hours. Keeping processed-event
// records well beyond that window preserves idempotency and aids debugging;
// after it, MongoDB's TTL monitor reaps them so the collection stays bounded.
const RETENTION_SECONDS = 30 * 24 * 60 * 60; // 30 days

const processedWebhookEventSchema = new mongoose.Schema(
  {
    // Stripe event id (evt_...). Unique index is the idempotency guard —
    // concurrent deliveries of the same event collide here and only one wins.
    eventId: { type: String, required: true, unique: true },
    type:    { type: String },
  },
  { timestamps: true }
);

processedWebhookEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: RETENTION_SECONDS });

module.exports = mongoose.model('ProcessedWebhookEvent', processedWebhookEventSchema);
