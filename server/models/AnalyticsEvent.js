const mongoose = require('mongoose');

/**
 * AnalyticsEvent — immutable record of every domain event.
 *
 * Written by AnalyticsEngine.track() via an EventBus subscriber.
 * Append-only — no updates or deletes on this collection.
 * Payload contains IDs only (enforced by the EVENTS payload contract).
 */
const analyticsEventSchema = new mongoose.Schema(
  {
    event:    { type: String, required: true, index: true },
    payload:  { type: mongoose.Schema.Types.Mixed, default: {} },
    tenantId: { type: String, default: 'castreach', index: true },
  },
  {
    timestamps: { createdAt: 'occurredAt', updatedAt: false },
  }
);

// Primary query pattern: event + time window.
analyticsEventSchema.index({ event: 1, occurredAt: -1 });
// Tenant-scoped time-series queries.
analyticsEventSchema.index({ tenantId: 1, occurredAt: -1 });
// Auto-prune events older than 90 days to cap storage on Atlas M0.
analyticsEventSchema.index({ occurredAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

module.exports = mongoose.model('AnalyticsEvent', analyticsEventSchema);
