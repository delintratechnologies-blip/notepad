/**
 * Tests for Step 6 — Disputes (updated per Q9/Q10 policy answers).
 *
 * Policy:
 *   - Disputes may ONLY be raised on completed bookings (not confirmed/pending).
 *   - A user may have at most 3 open (open|under_review) disputes at a time.
 *
 * Covers:
 *   - Raise dispute on completed booking
 *   - Raises on non-completed bookings rejected (400)
 *   - Rate limit: 4th open dispute returns 429
 *   - Party-only access (non-party rejected)
 *   - Duplicate dispute on same booking returns 409
 *   - Admin lifecycle: review → resolve / dismiss
 *   - GET /my — own disputes
 *   - GET / — admin list with status filter
 *   - GET /:id — party and admin access; third-party blocked
 *   - Status transition guards (can't review an already-resolved dispute)
 *   - Events: DISPUTE_RAISED, DISPUTE_RESOLVED, DISPUTE_DISMISSED emitted
 *   - Booking status updated to 'disputed' on raise
 *
 * NOTE: afterEach wipes all collections — each test creates its own data.
 */

const { request, app, makeUser, makeAdmin, makeHost } = require('./helpers');
const Booking  = require('../models/Booking');
const Dispute  = require('../models/Dispute');
const stitcher = require('../stitcher');
const EVENTS   = require('../stitcher/events/EVENTS');

const LONG_DESC = 'This is a detailed dispute description with more than twenty characters.';

async function makeCompletedBooking() {
  const host  = await makeHost();
  const guest = await makeUser({ role: 'guest' });
  const booking = await Booking.create({
    host:          host.user._id,
    guest:         guest.user._id,
    slotStart:     new Date(Date.now() - 7200000),
    slotEnd:       new Date(Date.now() - 3600000),
    status:        'completed',
    paymentStatus: 'released',
  });
  return { host, guest, booking };
}

async function makeConfirmedBooking() {
  const host  = await makeHost();
  const guest = await makeUser({ role: 'guest' });
  const booking = await Booking.create({
    host:      host.user._id,
    guest:     guest.user._id,
    slotStart: new Date(Date.now() + 3600000),
    slotEnd:   new Date(Date.now() + 7200000),
    status:    'confirmed',
  });
  return { host, guest, booking };
}

// ── Raise dispute ─────────────────────────────────────────────────────────────
describe('POST /api/disputes — raise dispute', () => {
  test('guest can raise dispute on completed booking', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'no_show', description: LONG_DESC });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.dispute.status).toBe('open');
    expect(res.body.dispute.reason).toBe('no_show');
  });

  test('host can raise dispute on completed booking', async () => {
    const { host, booking } = await makeCompletedBooking();
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ bookingId: booking._id, reason: 'payment_issue', description: LONG_DESC });

    expect(res.status).toBe(201);
    expect(res.body.dispute.raisedBy).toBe(host.user._id.toString());
  });

  test('cannot raise dispute on confirmed (non-completed) booking', async () => {
    const { guest, booking } = await makeConfirmedBooking();
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'other', description: LONG_DESC });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/completed/);
  });

  test('rate limit: 4th open dispute returns 429', async () => {
    const { guest } = await makeCompletedBooking();

    // Seed 3 open disputes directly — each needs a unique booking.
    const host3 = await makeHost();
    for (let i = 0; i < 3; i++) {
      const host = await makeHost();
      const bk   = await Booking.create({
        host:          host.user._id,
        guest:         guest.user._id,
        slotStart:     new Date(Date.now() - 7200000),
        slotEnd:       new Date(Date.now() - 3600000),
        status:        'completed',
        paymentStatus: 'released',
      });
      await Dispute.create({
        booking:     bk._id,
        raisedBy:    guest.user._id,
        againstUser: host.user._id,
        reason:      'other',
        description: LONG_DESC,
        status:      'open',
      });
    }

    // 4th attempt should be rate-limited.
    const bk4 = await Booking.create({
      host:          host3.user._id,
      guest:         guest.user._id,
      slotStart:     new Date(Date.now() - 7200000),
      slotEnd:       new Date(Date.now() - 3600000),
      status:        'completed',
      paymentStatus: 'released',
    });

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: bk4._id, reason: 'other', description: LONG_DESC });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/3 or more open disputes/);
  });

  test('non-party user gets 403', async () => {
    const { booking } = await makeCompletedBooking();
    const outsider    = await makeUser({ role: 'guest' });

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${outsider.token}`)
      .send({ bookingId: booking._id, reason: 'no_show', description: LONG_DESC });

    expect(res.status).toBe(403);
  });

  test('cannot dispute a pending booking', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const booking = await Booking.create({
      host:      host.user._id,
      guest:     guest.user._id,
      slotStart: new Date(Date.now() + 3600000),
      slotEnd:   new Date(Date.now() + 7200000),
      status:    'pending',
    });

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'other', description: LONG_DESC });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/completed/);
  });

  test('duplicate dispute on same booking returns 409', async () => {
    const { guest, booking } = await makeCompletedBooking();

    await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'no_show', description: LONG_DESC });

    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'other', description: LONG_DESC });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already exists/);
  });

  test('description too short returns 400', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'no_show', description: 'Too short' });

    expect(res.status).toBe(400);
  });

  test('missing fields return 400', async () => {
    const { guest } = await makeCompletedBooking();
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ reason: 'no_show' });

    expect(res.status).toBe(400);
  });

  test('booking status is set to disputed after raising', async () => {
    const { guest, booking } = await makeCompletedBooking();

    await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'no_show', description: LONG_DESC });

    const updated = await Booking.findById(booking._id);
    expect(updated.status).toBe('disputed');
  });

  test('DISPUTE_RAISED event is emitted with ID-only payload', async () => {
    const received = [];
    const unsub    = stitcher.events.on(EVENTS.DISPUTE_RAISED, (p) => received.push(p));

    const { guest, booking } = await makeCompletedBooking();
    await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'no_show', description: LONG_DESC });

    unsub();
    expect(received.length).toBeGreaterThanOrEqual(1);
    const payload = received[received.length - 1];
    expect(typeof payload.disputeId).toBe('string');
    expect(typeof payload.bookingId).toBe('string');
    expect(typeof payload.raisedById).toBe('string');
    expect(typeof payload.againstId).toBe('string');
  });
});

// ── GET /my ───────────────────────────────────────────────────────────────────
describe('GET /api/disputes/my', () => {
  test('returns own disputes only', async () => {
    const { guest, booking }  = await makeCompletedBooking();
    const { guest: other }    = await makeCompletedBooking();

    await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'no_show', description: LONG_DESC });

    const res = await request(app)
      .get('/api/disputes/my')
      .set('Authorization', `Bearer ${other.token}`);

    expect(res.status).toBe(200);
    expect(res.body.disputes).toHaveLength(0);
  });

  test('returns disputes raised by the user', async () => {
    const { guest, booking } = await makeCompletedBooking();

    await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'no_show', description: LONG_DESC });

    const res = await request(app)
      .get('/api/disputes/my')
      .set('Authorization', `Bearer ${guest.token}`);

    expect(res.status).toBe(200);
    expect(res.body.disputes).toHaveLength(1);
  });
});

// ── GET / (admin list) ────────────────────────────────────────────────────────
describe('GET /api/disputes — admin list', () => {
  test('non-admin gets 403', async () => {
    const { guest } = await makeCompletedBooking();
    const res = await request(app)
      .get('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`);
    expect(res.status).toBe(403);
  });

  test('admin can list all disputes', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();

    await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'no_show', description: LONG_DESC });

    const res = await request(app)
      .get('/api/disputes')
      .set('Authorization', `Bearer ${adminTok}`);

    expect(res.status).toBe(200);
    expect(res.body.disputes.length).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.total).toBe('number');
  });

  test('status filter works', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();

    await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: booking._id, reason: 'no_show', description: LONG_DESC });

    const openRes = await request(app)
      .get('/api/disputes?status=open')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(openRes.body.disputes.every((d) => d.status === 'open')).toBe(true);

    const resolvedRes = await request(app)
      .get('/api/disputes?status=resolved')
      .set('Authorization', `Bearer ${adminTok}`);
    expect(resolvedRes.body.disputes).toHaveLength(0);
  });
});

// ── GET /:id ──────────────────────────────────────────────────────────────────
describe('GET /api/disputes/:id', () => {
  test('raisedBy user can view their own dispute', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const created = await Dispute.create({
      booking:     booking._id,
      raisedBy:    guest.user._id,
      againstUser: booking.host,
      reason:      'no_show',
      description: LONG_DESC,
    });

    const res = await request(app)
      .get(`/api/disputes/${created._id}`)
      .set('Authorization', `Bearer ${guest.token}`);

    expect(res.status).toBe(200);
    expect(res.body.dispute._id).toBe(created._id.toString());
  });

  test('third-party user gets 403', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const outsider = await makeUser({ role: 'guest' });
    const created  = await Dispute.create({
      booking:     booking._id,
      raisedBy:    guest.user._id,
      againstUser: booking.host,
      reason:      'no_show',
      description: LONG_DESC,
    });

    const res = await request(app)
      .get(`/api/disputes/${created._id}`)
      .set('Authorization', `Bearer ${outsider.token}`);

    expect(res.status).toBe(403);
  });

  test('admin can view any dispute', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();
    const created = await Dispute.create({
      booking:     booking._id,
      raisedBy:    guest.user._id,
      againstUser: booking.host,
      reason:      'other',
      description: LONG_DESC,
    });

    const res = await request(app)
      .get(`/api/disputes/${created._id}`)
      .set('Authorization', `Bearer ${adminTok}`);

    expect(res.status).toBe(200);
  });
});

// ── Admin lifecycle ───────────────────────────────────────────────────────────
describe('Dispute admin lifecycle', () => {
  async function raiseDispute(guestToken, bookingId) {
    const res = await request(app)
      .post('/api/disputes')
      .set('Authorization', `Bearer ${guestToken}`)
      .send({ bookingId, reason: 'technical_issue', description: LONG_DESC });
    return res.body.dispute;
  }

  test('review: open → under_review', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();
    const dispute = await raiseDispute(guest.token, booking._id);

    const res = await request(app)
      .post(`/api/disputes/${dispute._id}/review`)
      .set('Authorization', `Bearer ${adminTok}`);

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('under_review');
  });

  test('review on non-open dispute returns 400', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();
    const dispute = await raiseDispute(guest.token, booking._id);

    // Move to under_review first.
    await request(app)
      .post(`/api/disputes/${dispute._id}/review`)
      .set('Authorization', `Bearer ${adminTok}`);

    // Try to review again.
    const res = await request(app)
      .post(`/api/disputes/${dispute._id}/review`)
      .set('Authorization', `Bearer ${adminTok}`);

    expect(res.status).toBe(400);
  });

  test('resolve: under_review → resolved', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();
    const dispute = await raiseDispute(guest.token, booking._id);

    await request(app)
      .post(`/api/disputes/${dispute._id}/review`)
      .set('Authorization', `Bearer ${adminTok}`);

    const res = await request(app)
      .post(`/api/disputes/${dispute._id}/resolve`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ resolution: 'Resolved after investigating the issue thoroughly.' });

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('resolved');
    expect(res.body.dispute.resolution).toMatch(/Resolved after/);
    expect(res.body.dispute.resolvedAt).toBeDefined();
  });

  test('resolve without resolution text returns 400', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();
    const dispute = await raiseDispute(guest.token, booking._id);

    const res = await request(app)
      .post(`/api/disputes/${dispute._id}/resolve`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({});

    expect(res.status).toBe(400);
  });

  test('can resolve directly from open state (skip review)', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();
    const dispute = await raiseDispute(guest.token, booking._id);

    const res = await request(app)
      .post(`/api/disputes/${dispute._id}/resolve`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ resolution: 'Resolved after clear evidence from both parties.' });

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('resolved');
  });

  test('dismiss: open → dismissed', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();
    const dispute = await raiseDispute(guest.token, booking._id);

    const res = await request(app)
      .post(`/api/disputes/${dispute._id}/dismiss`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ resolution: 'Dismissed — no evidence of wrongdoing.' });

    expect(res.status).toBe(200);
    expect(res.body.dispute.status).toBe('dismissed');
  });

  test('cannot resolve an already-dismissed dispute', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();
    const dispute = await raiseDispute(guest.token, booking._id);

    await request(app)
      .post(`/api/disputes/${dispute._id}/dismiss`)
      .set('Authorization', `Bearer ${adminTok}`);

    const res = await request(app)
      .post(`/api/disputes/${dispute._id}/resolve`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ resolution: 'Late resolution attempt after dismiss.' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/resolved or dismissed/);
  });

  test('DISPUTE_RESOLVED event emitted on resolve', async () => {
    const received = [];
    const unsub    = stitcher.events.on(EVENTS.DISPUTE_RESOLVED, (p) => received.push(p));

    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();
    const dispute = await raiseDispute(guest.token, booking._id);

    await request(app)
      .post(`/api/disputes/${dispute._id}/resolve`)
      .set('Authorization', `Bearer ${adminTok}`)
      .send({ resolution: 'Resolved in favour of guest after investigation.' });

    unsub();
    expect(received.length).toBeGreaterThanOrEqual(1);
    const payload = received[received.length - 1];
    expect(typeof payload.disputeId).toBe('string');
    expect(typeof payload.bookingId).toBe('string');
  });

  test('DISPUTE_DISMISSED event emitted on dismiss', async () => {
    const received = [];
    const unsub    = stitcher.events.on(EVENTS.DISPUTE_DISMISSED, (p) => received.push(p));

    const { guest, booking } = await makeCompletedBooking();
    const { token: adminTok } = await makeAdmin();
    const dispute = await raiseDispute(guest.token, booking._id);

    await request(app)
      .post(`/api/disputes/${dispute._id}/dismiss`)
      .set('Authorization', `Bearer ${adminTok}`);

    unsub();
    expect(received.length).toBeGreaterThanOrEqual(1);
    const payload = received[received.length - 1];
    expect(typeof payload.disputeId).toBe('string');
  });

  test('non-admin cannot access review/resolve/dismiss', async () => {
    const { guest, booking } = await makeCompletedBooking();
    const dispute = await raiseDispute(guest.token, booking._id);

    const [reviewRes, resolveRes, dismissRes] = await Promise.all([
      request(app)
        .post(`/api/disputes/${dispute._id}/review`)
        .set('Authorization', `Bearer ${guest.token}`),
      request(app)
        .post(`/api/disputes/${dispute._id}/resolve`)
        .set('Authorization', `Bearer ${guest.token}`)
        .send({ resolution: 'Attempting resolve as guest.' }),
      request(app)
        .post(`/api/disputes/${dispute._id}/dismiss`)
        .set('Authorization', `Bearer ${guest.token}`),
    ]);

    expect(reviewRes.status).toBe(403);
    expect(resolveRes.status).toBe(403);
    expect(dismissRes.status).toBe(403);
  });
});
