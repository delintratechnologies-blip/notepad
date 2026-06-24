/**
 * AnalyticsEngine — event-sourced analytics over the analytics_events collection.
 *
 * Architecture:
 *   EventBus subscriber → AnalyticsEngine.track() → AnalyticsEvent (MongoDB)
 *   Admin endpoint      → AnalyticsEngine.projections → aggregation result
 *
 * Design:
 *   - track() is fire-and-forget (same pattern as AuditLogger) — never blocks routes.
 *   - Projections run live aggregations — no pre-computed rollups. Appropriate for
 *     M0 scale; revisit with materialized views when event volume exceeds ~500k/month.
 *   - All projections are tenant-scoped (tenantId param, defaults to 'castreach').
 *   - Payload stored as-is from EventBus — IDs only per EVENTS contract.
 */

const AnalyticsEvent = require('../../models/AnalyticsEvent');

function trailingMonthsStart(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.min(24, Math.max(1, parseInt(n, 10) || 6)));
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

class AnalyticsEngine {
  constructor() {
    this._trackCount  = 0;
    this._errorCount  = 0;
  }

  // ── Write path ──────────────────────────────────────────────────────────────

  /**
   * Record an event. Fire-and-forget — errors are logged, never thrown.
   *
   * @param {string} event    - Event name (from EVENTS constants)
   * @param {object} payload  - Event payload (IDs only per EVENTS contract)
   * @param {string} tenantId - Tenant identifier (default 'castreach')
   */
  track(event, payload = {}, tenantId = 'castreach') {
    this._trackCount++;
    AnalyticsEvent.create({ event, payload, tenantId }).catch((err) => {
      this._errorCount++;
      console.error(`[AnalyticsEngine] track failed (${event}):`, err.message);
    });
    return this;
  }

  // ── Stats ───────────────────────────────────────────────────────────────────

  stats() {
    return { trackCount: this._trackCount, errorCount: this._errorCount };
  }

  // ── Projections ─────────────────────────────────────────────────────────────

  /**
   * Booking funnel — created → confirmed → completed, plus cancellation count.
   * Gives a conversion rate overview without touching the bookings collection.
   *
   * @param {number} months - Trailing months to include (default 6)
   * @param {string} tenantId
   */
  async bookingFunnel(months = 6, tenantId = 'castreach') {
    const since  = trailingMonthsStart(months);
    const events = [
      'booking.created',
      'booking.confirmed',
      'booking.completed',
      'booking.cancelled',
      'booking.reviewed',
    ];

    const rows = await AnalyticsEvent.aggregate([
      { $match: { event: { $in: events }, tenantId, occurredAt: { $gte: since } } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ]);

    const byEvent = Object.fromEntries(rows.map((r) => [r._id, r.count]));

    const created   = byEvent['booking.created']   ?? 0;
    const confirmed = byEvent['booking.confirmed']  ?? 0;
    const completed = byEvent['booking.completed']  ?? 0;
    const cancelled = byEvent['booking.cancelled']  ?? 0;
    const reviewed  = byEvent['booking.reviewed']   ?? 0;

    return {
      created,
      confirmed,
      completed,
      cancelled,
      reviewed,
      confirmRate:  created   > 0 ? +(confirmed / created).toFixed(3)  : 0,
      completeRate: confirmed > 0 ? +(completed / confirmed).toFixed(3) : 0,
      reviewRate:   completed > 0 ? +(reviewed  / completed).toFixed(3) : 0,
      period:       { months, since },
    };
  }

  /**
   * Event volume by month — how many of each event type occurred per calendar month.
   *
   * @param {string[]} eventNames - Subset of EVENTS to include (default: all)
   * @param {number}   months     - Trailing months (default 6)
   * @param {string}   tenantId
   */
  async eventVolume(eventNames = null, months = 6, tenantId = 'castreach') {
    const since  = trailingMonthsStart(months);
    const match  = { tenantId, occurredAt: { $gte: since } };
    if (eventNames && eventNames.length > 0) match.event = { $in: eventNames };

    return AnalyticsEvent.aggregate([
      { $match: match },
      {
        $group: {
          _id:   {
            event: '$event',
            year:  { $year:  '$occurredAt' },
            month: { $month: '$occurredAt' },
          },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.event': 1 } },
    ]);
  }

  /**
   * Top events by volume over the given period.
   *
   * @param {number} limit  - Number of top events to return (default 10)
   * @param {number} months - Trailing months (default 6)
   * @param {string} tenantId
   */
  async topEvents(limit = 10, months = 6, tenantId = 'castreach') {
    const since = trailingMonthsStart(months);

    return AnalyticsEvent.aggregate([
      { $match: { tenantId, occurredAt: { $gte: since } } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
      { $sort:  { count: -1 } },
      { $limit: Math.min(50, Math.max(1, parseInt(limit, 10) || 10)) },
    ]);
  }

  /**
   * User activity — registrations and blocks over time.
   *
   * @param {number} months
   * @param {string} tenantId
   */
  async userActivity(months = 6, tenantId = 'castreach') {
    const since  = trailingMonthsStart(months);
    const events = ['user.registered', 'user.blocked', 'user.unblocked'];

    const rows = await AnalyticsEvent.aggregate([
      { $match: { event: { $in: events }, tenantId, occurredAt: { $gte: since } } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ]);

    const byEvent = Object.fromEntries(rows.map((r) => [r._id, r.count]));

    return {
      registered: byEvent['user.registered'] ?? 0,
      blocked:    byEvent['user.blocked']    ?? 0,
      unblocked:  byEvent['user.unblocked']  ?? 0,
      period:     { months, since },
    };
  }

  /**
   * Dispute rate — disputes raised vs bookings completed over the same period.
   *
   * @param {number} months
   * @param {string} tenantId
   */
  async disputeRate(months = 6, tenantId = 'castreach') {
    const since  = trailingMonthsStart(months);
    const events = ['booking.completed', 'dispute.raised', 'dispute.resolved', 'dispute.dismissed'];

    const rows = await AnalyticsEvent.aggregate([
      { $match: { event: { $in: events }, tenantId, occurredAt: { $gte: since } } },
      { $group: { _id: '$event', count: { $sum: 1 } } },
    ]);

    const byEvent   = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    const completed = byEvent['booking.completed']  ?? 0;
    const raised    = byEvent['dispute.raised']     ?? 0;
    const resolved  = byEvent['dispute.resolved']   ?? 0;
    const dismissed = byEvent['dispute.dismissed']  ?? 0;

    return {
      bookingsCompleted: completed,
      disputesRaised:    raised,
      disputesResolved:  resolved,
      disputesDismissed: dismissed,
      disputeRate:       completed > 0 ? +(raised / completed).toFixed(3) : 0,
      period:            { months, since },
    };
  }

  /**
   * Full dashboard summary — all projections in one call.
   *
   * @param {number} months
   * @param {string} tenantId
   */
  async dashboard(months = 6, tenantId = 'castreach') {
    const [funnel, activity, disputes, top] = await Promise.all([
      this.bookingFunnel(months, tenantId),
      this.userActivity(months, tenantId),
      this.disputeRate(months, tenantId),
      this.topEvents(10, months, tenantId),
    ]);
    return { funnel, activity, disputes, topEvents: top, generatedAt: new Date() };
  }
}

module.exports = AnalyticsEngine;
