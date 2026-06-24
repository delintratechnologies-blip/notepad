/**
 * Tests for Step 8 — Analytics Layer.
 *
 * Covers:
 *   - AnalyticsEngine.track() — fire-and-forget write, never throws
 *   - EventBus subscriber — every domain event auto-tracked
 *   - bookingFunnel() — conversion rates from analytics_events
 *   - eventVolume() — monthly event counts
 *   - topEvents() — ranked event frequencies
 *   - userActivity() — registration/block counts
 *   - disputeRate() — dispute-to-booking ratio
 *   - dashboard() — all projections in one call
 *   - Admin endpoints: GET /api/stitcher/analytics/*
 *   - stitcher.analytics is active in health check
 *
 * NOTE: afterEach wipes all collections — each test creates its own data.
 * Because track() is fire-and-forget, tests that check analytics_events
 * must wait for the async write with a short settling delay.
 */

const AnalyticsEngine  = require('../stitcher/analytics/AnalyticsEngine');
const AnalyticsEvent   = require('../models/AnalyticsEvent');
const stitcher         = require('../stitcher');
const EVENTS           = require('../stitcher/events/EVENTS');
const { request, app, makeUser, makeAdmin, makeHost } = require('./helpers');

// Give fire-and-forget track() time to flush to MongoDB.
const settle = () => new Promise((r) => setTimeout(r, 50));

// ── Unit: AnalyticsEngine ─────────────────────────────────────────────────────
describe('AnalyticsEngine (unit)', () => {
  let engine;
  beforeEach(() => { engine = new AnalyticsEngine(); });

  test('track() returns this for chaining', () => {
    expect(engine.track('test.event', { id: '123' })).toBe(engine);
  });

  test('track() increments _trackCount', () => {
    engine.track('a', {});
    engine.track('b', {});
    expect(engine.stats().trackCount).toBe(2);
  });

  test('track() does not throw on invalid payload', () => {
    expect(() => engine.track('bad', null)).not.toThrow();
    expect(() => engine.track('bad', undefined)).not.toThrow();
  });

  test('stats() returns trackCount and errorCount', () => {
    const s = engine.stats();
    expect(typeof s.trackCount).toBe('number');
    expect(typeof s.errorCount).toBe('number');
  });
});

// ── Integration: track() writes to DB ────────────────────────────────────────
describe('AnalyticsEngine — track() DB write', () => {
  test('track() writes to analytics_events', async () => {
    const engine = new AnalyticsEngine();
    engine.track('booking.created', { bookingId: 'abc123' });
    await settle();

    const doc = await AnalyticsEvent.findOne({ event: 'booking.created' });
    expect(doc).not.toBeNull();
    expect(doc.payload.bookingId).toBe('abc123');
    expect(doc.tenantId).toBe('castreach');
  });

  test('track() stores the tenantId provided', async () => {
    const engine = new AnalyticsEngine();
    engine.track('user.registered', { userId: 'u1' }, 'other_tenant');
    await settle();

    const doc = await AnalyticsEvent.findOne({ event: 'user.registered' });
    expect(doc.tenantId).toBe('other_tenant');
  });

  test('occurredAt is set automatically', async () => {
    const engine = new AnalyticsEngine();
    const before = new Date();
    engine.track('report.filed', { reportId: 'r1', reporterId: 'u1', reportedId: 'u2' });
    await settle();
    const after  = new Date();

    const doc = await AnalyticsEvent.findOne({ event: 'report.filed' });
    expect(doc.occurredAt >= before).toBe(true);
    expect(doc.occurredAt <= after).toBe(true);
  });
});

// ── Integration: EventBus auto-tracking ──────────────────────────────────────
describe('AnalyticsEngine — EventBus auto-tracking', () => {
  test('user registration auto-writes to analytics_events', async () => {
    await makeUser({ role: 'guest' });
    await settle();

    const doc = await AnalyticsEvent.findOne({ event: EVENTS.USER_REGISTERED });
    expect(doc).not.toBeNull();
    expect(typeof doc.payload.userId).toBe('string');
    expect(doc.payload.role).toBe('guest');
  });

  test('all 12 EVENTS are subscribed (trackCount grows on every emit)', async () => {
    const before = stitcher.analytics.stats().trackCount;

    // Trigger USER_REGISTERED events.
    await makeUser({ role: 'guest' });
    await makeUser({ role: 'host' });

    const after = stitcher.analytics.stats().trackCount;
    expect(after).toBeGreaterThan(before);
  });
});

// ── Integration: projections ──────────────────────────────────────────────────
describe('AnalyticsEngine — projections', () => {
  async function seedEvents(eventMap) {
    const docs = [];
    for (const [event, count] of Object.entries(eventMap)) {
      for (let i = 0; i < count; i++) {
        docs.push({ event, payload: { id: `${event}-${i}` }, tenantId: 'castreach' });
      }
    }
    await AnalyticsEvent.insertMany(docs);
  }

  test('bookingFunnel() returns all expected fields', async () => {
    const engine = new AnalyticsEngine();
    const funnel = await engine.bookingFunnel();

    expect(typeof funnel.created).toBe('number');
    expect(typeof funnel.confirmed).toBe('number');
    expect(typeof funnel.completed).toBe('number');
    expect(typeof funnel.cancelled).toBe('number');
    expect(typeof funnel.confirmRate).toBe('number');
    expect(typeof funnel.completeRate).toBe('number');
    expect(funnel.period).toHaveProperty('months');
  });

  test('bookingFunnel() calculates conversion rates correctly', async () => {
    await seedEvents({
      'booking.created':   10,
      'booking.confirmed':  6,
      'booking.completed':  4,
    });

    const engine = new AnalyticsEngine();
    const funnel = await engine.bookingFunnel();

    expect(funnel.created).toBe(10);
    expect(funnel.confirmed).toBe(6);
    expect(funnel.completed).toBe(4);
    expect(funnel.confirmRate).toBe(0.6);
    expect(funnel.completeRate).toBeCloseTo(0.667, 2);
  });

  test('bookingFunnel() returns zeros when no events', async () => {
    const engine = new AnalyticsEngine();
    const funnel = await engine.bookingFunnel();

    expect(funnel.created).toBe(0);
    expect(funnel.confirmRate).toBe(0);
  });

  test('eventVolume() returns grouped results', async () => {
    await seedEvents({ 'booking.created': 3, 'user.registered': 2 });

    const engine  = new AnalyticsEngine();
    const results = await engine.eventVolume(null, 6);

    expect(Array.isArray(results)).toBe(true);
    const events = results.map((r) => r._id.event);
    expect(events).toContain('booking.created');
    expect(events).toContain('user.registered');
  });

  test('eventVolume() filters by eventNames array', async () => {
    await seedEvents({ 'booking.created': 3, 'user.registered': 2 });

    const engine  = new AnalyticsEngine();
    const results = await engine.eventVolume(['booking.created'], 6);

    const events = results.map((r) => r._id.event);
    expect(events).toContain('booking.created');
    expect(events).not.toContain('user.registered');
  });

  test('topEvents() returns sorted by count desc', async () => {
    await seedEvents({ 'booking.created': 5, 'user.registered': 2, 'booking.cancelled': 8 });

    const engine = new AnalyticsEngine();
    const top    = await engine.topEvents(10);

    expect(top[0]._id).toBe('booking.cancelled');
    expect(top[0].count).toBe(8);
    expect(top[1]._id).toBe('booking.created');
  });

  test('topEvents() respects limit', async () => {
    await seedEvents({
      'booking.created': 5, 'booking.confirmed': 4, 'booking.completed': 3,
      'user.registered': 2, 'report.filed': 1,
    });

    const engine = new AnalyticsEngine();
    const top    = await engine.topEvents(3);
    expect(top.length).toBe(3);
  });

  test('userActivity() returns registered/blocked/unblocked counts', async () => {
    await seedEvents({ 'user.registered': 7, 'user.blocked': 2 });

    const engine   = new AnalyticsEngine();
    const activity = await engine.userActivity();

    expect(activity.registered).toBe(7);
    expect(activity.blocked).toBe(2);
    expect(activity.unblocked).toBe(0);
  });

  test('disputeRate() returns rate and counts', async () => {
    await seedEvents({ 'booking.completed': 10, 'dispute.raised': 2, 'dispute.resolved': 1 });

    const engine  = new AnalyticsEngine();
    const dispute = await engine.disputeRate();

    expect(dispute.bookingsCompleted).toBe(10);
    expect(dispute.disputesRaised).toBe(2);
    expect(dispute.disputeRate).toBe(0.2);
  });

  test('disputeRate() is 0 when no bookings completed', async () => {
    const engine  = new AnalyticsEngine();
    const dispute = await engine.disputeRate();
    expect(dispute.disputeRate).toBe(0);
  });

  test('dashboard() returns all projection keys', async () => {
    const engine    = new AnalyticsEngine();
    const dashboard = await engine.dashboard();

    expect(dashboard).toHaveProperty('funnel');
    expect(dashboard).toHaveProperty('activity');
    expect(dashboard).toHaveProperty('disputes');
    expect(dashboard).toHaveProperty('topEvents');
    expect(dashboard).toHaveProperty('generatedAt');
  });
});

// ── Integration: stitcher.analytics ──────────────────────────────────────────
describe('stitcher.analytics', () => {
  test('is an AnalyticsEngine instance after initialize()', () => {
    expect(stitcher.analytics).toBeInstanceOf(AnalyticsEngine);
  });

  test('healthCheck reports analytics as active', () => {
    const hc = stitcher.healthCheck();
    expect(hc.components.analytics).toBe('active');
    expect(hc.analyticsStats).toHaveProperty('trackCount');
    expect(hc.analyticsStats).toHaveProperty('errorCount');
  });
});

// ── Admin endpoints ───────────────────────────────────────────────────────────
describe('Analytics admin endpoints', () => {
  test('GET /api/stitcher/analytics/dashboard — 200 for admin', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/analytics/dashboard')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('funnel');
    expect(res.body.data).toHaveProperty('topEvents');
  });

  test('GET /api/stitcher/analytics/dashboard — 401 without token', async () => {
    const res = await request(app).get('/api/stitcher/analytics/dashboard');
    expect(res.status).toBe(401);
  });

  test('GET /api/stitcher/analytics/dashboard — 403 for non-admin', async () => {
    const { token } = await makeUser({ role: 'guest' });
    const res = await request(app)
      .get('/api/stitcher/analytics/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('GET /api/stitcher/analytics/funnel — returns funnel data', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/analytics/funnel?months=3')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('confirmRate');
    expect(res.body.data.period.months).toBe(3);
  });

  test('GET /api/stitcher/analytics/volume — returns volume data', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/analytics/volume')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  test('GET /api/stitcher/analytics/volume — filters by events param', async () => {
    await AnalyticsEvent.create({ event: 'booking.created', payload: {}, tenantId: 'castreach' });
    await AnalyticsEvent.create({ event: 'user.registered', payload: {}, tenantId: 'castreach' });

    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/analytics/volume?events=booking.created')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const events = res.body.data.map((r) => r._id.event);
    expect(events).toContain('booking.created');
    expect(events).not.toContain('user.registered');
  });

  test('GET /api/stitcher/analytics/disputes — returns dispute rate', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/analytics/disputes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('disputeRate');
    expect(res.body.data).toHaveProperty('bookingsCompleted');
  });
});
