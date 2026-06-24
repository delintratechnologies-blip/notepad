/**
 * Default subscribers — registered at Stitcher startup.
 *
 * Registration order:
 *   1. devLogger       — console logs every event in development
 *   2. analyticsWriter — records every event to analytics_events (Step 8, always-on)
 *
 * Future:
 *   Step 9: tenantSubscriber — propagates tenant context
 *   Step 10: aiMemorySubscriber — updates AI session memories
 *
 * @param {EventBus}        events    - The initialized EventBus instance.
 * @param {string}          env       - process.env.NODE_ENV
 * @param {AnalyticsEngine} analytics - The initialized AnalyticsEngine (Step 8)
 */
const EVENTS        = require('../EVENTS');
const TenantContext = require('../../tenant/TenantContext');

module.exports = function registerDefaultSubscribers(events, env = 'development', analytics = null) {

  // ── 1. Dev logger ───────────────────────────────────────────────────────────
  if (env === 'development') {
    for (const eventName of Object.values(EVENTS)) {
      events.on(eventName, (payload) => {
        console.log(`[Event] ${eventName}`, JSON.stringify(payload));
      });
    }
  }

  // ── 2. Analytics writer — active in all environments ───────────────────────
  // Records every domain event to analytics_events. Fire-and-forget inside
  // AnalyticsEngine.track() — no event handler can throw from here.
  if (analytics) {
    for (const eventName of Object.values(EVENTS)) {
      events.on(eventName, (payload) => {
        analytics.track(eventName, payload, TenantContext.getTenantId());
      });
    }
  }

  // ── Future subscribers ──────────────────────────────────────────────────────
  // Step 9: tenantSubscriber(events)
  // Step 10: aiMemorySubscriber(events, ai)
};
