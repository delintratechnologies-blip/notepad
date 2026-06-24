/**
 * Tests for Step 6 — Admin Reports.
 *
 * Covers:
 *   - GET /api/reports/overview — KPI summary
 *   - GET /api/reports/bookings — booking stats by status + month
 *   - GET /api/reports/revenue  — revenue breakdown
 *   - GET /api/reports/disputes — dispute stats
 *   - Auth guard: non-admin gets 403 on all routes
 *   - Response shape validation
 *
 * NOTE: afterEach wipes all collections — each test creates its own data.
 */

const { request, app, makeUser, makeAdmin, makeHost } = require('./helpers');
const Booking = require('../models/Booking');
const Dispute = require('../models/Dispute');

const LONG_DESC = 'This is a sufficiently long dispute description for testing purposes.';

// ── Auth guard ────────────────────────────────────────────────────────────────
describe('Reports — auth guard', () => {
  const REPORT_ENDPOINTS = ['/overview', '/bookings', '/revenue', '/disputes'];

  test.each(REPORT_ENDPOINTS)(
    'GET /api/reports%s returns 403 for non-admin',
    async (path) => {
      const { token } = await makeUser({ role: 'guest' });
      const res = await request(app)
        .get(`/api/reports${path}`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    }
  );

  test.each(REPORT_ENDPOINTS)(
    'GET /api/reports%s returns 401 without token',
    async (path) => {
      const res = await request(app).get(`/api/reports${path}`);
      expect(res.status).toBe(401);
    }
  );
});

// ── GET /api/reports/overview ─────────────────────────────────────────────────
describe('GET /api/reports/overview', () => {
  test('returns expected shape with numeric fields', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/reports/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const { data } = res.body;
    expect(typeof data.users.total).toBe('number');
    expect(typeof data.users.hosts).toBe('number');
    expect(typeof data.users.guests).toBe('number');
    expect(typeof data.bookings.total).toBe('number');
    expect(typeof data.bookings.completed).toBe('number');
    expect(typeof data.revenueCents).toBe('number');
    expect(typeof data.openDisputes).toBe('number');
  });

  test('user counts reflect created users', async () => {
    const { token } = await makeAdmin();
    await makeHost();
    await makeUser({ role: 'guest' });
    await makeUser({ role: 'guest' });

    const res = await request(app)
      .get('/api/reports/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.users.total).toBeGreaterThanOrEqual(3);  // admin + host + 2 guests
    expect(res.body.data.users.hosts).toBeGreaterThanOrEqual(1);
    expect(res.body.data.users.guests).toBeGreaterThanOrEqual(2);
  });

  test('revenue reflects released payments only', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const { token } = await makeAdmin();

    await Booking.create({
      host:          host.user._id,
      guest:         guest.user._id,
      slotStart:     new Date(Date.now() - 7200000),
      slotEnd:       new Date(Date.now() - 3600000),
      status:        'completed',
      amountCents:   5000,
      paymentStatus: 'released',
    });
    await Booking.create({
      host:          host.user._id,
      guest:         guest.user._id,
      slotStart:     new Date(Date.now() + 3600000),
      slotEnd:       new Date(Date.now() + 7200000),
      status:        'pending',
      amountCents:   3000,
      paymentStatus: 'held',
    });

    const res = await request(app)
      .get('/api/reports/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.revenueCents).toBe(5000);  // only released
  });

  test('openDisputes counts open and under_review', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const { token } = await makeAdmin();

    const booking = await Booking.create({
      host:      host.user._id,
      guest:     guest.user._id,
      slotStart: new Date(Date.now() - 7200000),
      slotEnd:   new Date(Date.now() - 3600000),
      status:    'completed',
    });

    await Dispute.create({
      booking:     booking._id,
      raisedBy:    guest.user._id,
      againstUser: host.user._id,
      reason:      'no_show',
      description: LONG_DESC,
      status:      'open',
    });

    const res = await request(app)
      .get('/api/reports/overview')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.data.openDisputes).toBeGreaterThanOrEqual(1);
  });
});

// ── GET /api/reports/bookings ─────────────────────────────────────────────────
describe('GET /api/reports/bookings', () => {
  test('returns byStatus and byMonth arrays', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/reports/bookings')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.byStatus)).toBe(true);
    expect(Array.isArray(res.body.data.byMonth)).toBe(true);
  });

  test('byStatus reflects actual booking statuses', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const { token } = await makeAdmin();

    await Booking.create({
      host:      host.user._id,
      guest:     guest.user._id,
      slotStart: new Date(Date.now() - 7200000),
      slotEnd:   new Date(Date.now() - 3600000),
      status:    'completed',
    });

    const res = await request(app)
      .get('/api/reports/bookings')
      .set('Authorization', `Bearer ${token}`);

    const completedBucket = res.body.data.byStatus.find((b) => b._id === 'completed');
    expect(completedBucket).toBeDefined();
    expect(completedBucket.count).toBeGreaterThanOrEqual(1);
  });
});

// ── GET /api/reports/revenue ──────────────────────────────────────────────────
describe('GET /api/reports/revenue', () => {
  test('returns byMonth and topHosts arrays', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/reports/revenue')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.byMonth)).toBe(true);
    expect(Array.isArray(res.body.data.topHosts)).toBe(true);
  });

  test('byMonth includes current month revenue for released bookings', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const { token } = await makeAdmin();

    await Booking.create({
      host:          host.user._id,
      guest:         guest.user._id,
      slotStart:     new Date(Date.now() - 7200000),
      slotEnd:       new Date(Date.now() - 3600000),
      status:        'completed',
      amountCents:   7500,
      paymentStatus: 'released',
    });

    const res = await request(app)
      .get('/api/reports/revenue')
      .set('Authorization', `Bearer ${token}`);

    const totalRevenue = res.body.data.byMonth.reduce((sum, m) => sum + m.totalCents, 0);
    expect(totalRevenue).toBeGreaterThanOrEqual(7500);
  });
});

// ── GET /api/reports/disputes ─────────────────────────────────────────────────
describe('GET /api/reports/disputes', () => {
  test('returns byStatus, byReason, byMonth', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/reports/disputes')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.byStatus)).toBe(true);
    expect(Array.isArray(res.body.data.byReason)).toBe(true);
    expect(Array.isArray(res.body.data.byMonth)).toBe(true);
  });

  test('byReason reflects filed disputes', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const { token } = await makeAdmin();

    const booking = await Booking.create({
      host:      host.user._id,
      guest:     guest.user._id,
      slotStart: new Date(Date.now() - 7200000),
      slotEnd:   new Date(Date.now() - 3600000),
      status:    'completed',
    });
    await Dispute.create({
      booking:     booking._id,
      raisedBy:    guest.user._id,
      againstUser: host.user._id,
      reason:      'technical_issue',
      description: LONG_DESC,
    });

    const res = await request(app)
      .get('/api/reports/disputes')
      .set('Authorization', `Bearer ${token}`);

    const techBucket = res.body.data.byReason.find((b) => b._id === 'technical_issue');
    expect(techBucket).toBeDefined();
    expect(techBucket.count).toBeGreaterThanOrEqual(1);
  });
});
