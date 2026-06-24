// Mock external integrations so booking flows don't hit Daily.co or Stripe.
jest.mock('../services/daily', () => ({
  createDailyRoom: jest.fn(async () => ({ roomUrl: 'https://daily.co/test-room' })),
}));
jest.mock('../services/stripe', () => ({
  createEscrowIntent:      jest.fn(async () => ({ clientSecret: 'cs_test', paymentIntentId: 'pi_test' })),
  releaseEscrow:           jest.fn(async () => ({})),
  refundPayment:           jest.fn(async () => ({})),
  createConnectOnboarding: jest.fn(async () => ({ accountLink: 'https://connect.test' })),
}));

const { request, app, makeUser, makeHost } = require('./helpers');
const User    = require('../models/User');
const Booking = require('../models/Booking');
const { refundPayment } = require('../services/stripe');

const future = (hoursFromNow) => new Date(Date.now() + hoursFromNow * 3600 * 1000).toISOString();

async function book(guest, hostId, over = {}) {
  return request(app)
    .post('/api/bookings')
    .set('Authorization', `Bearer ${guest.token}`)
    .send({ hostId, slotStart: future(24), slotEnd: future(25), topics: ['AI'], ...over });
}

// ── Booking creation — validation & pricing ──────────────────────────────────
describe('Booking creation — validation & pricing (BLK-2, EDGE-2/3/4)', () => {
  test('rejects booking yourself', async () => {
    const host = await makeHost();
    const res  = await book(host, host.user._id);
    expect(res.status).toBe(400);
  });

  test('rejects booking a non-host', async () => {
    const guest  = await makeUser({ role: 'guest' });
    const guest2 = await makeUser({ role: 'guest' });
    const res    = await book(guest, guest2.user._id);
    expect(res.status).toBe(400);
  });

  test('rejects a slot in the past', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const res   = await book(guest, host.user._id, { slotStart: future(-2), slotEnd: future(-1) });
    expect(res.status).toBe(400);
  });

  test('rejects slotEnd <= slotStart', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const res   = await book(guest, host.user._id, { slotStart: future(25), slotEnd: future(24) });
    expect(res.status).toBe(400);
  });

  test('snapshots amountCents from the host rate', async () => {
    const host  = await makeHost(5000); // $50
    const guest = await makeUser({ role: 'guest' });
    const res   = await book(guest, host.user._id);
    expect(res.status).toBe(201);
    expect(res.body.booking.amountCents).toBe(5000);
  });

  test('rejects an overlapping slot (BUG-7: race condition guard)', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const first = await book(guest, host.user._id);
    expect(first.status).toBe(201);
    const overlap = await book(guest, host.user._id);
    expect(overlap.status).toBe(409);
  });

  test('concurrent identical requests — only one booking created (BUG-7)', async () => {
    // Explicit 15s timeout: replica-set transactions are slower than standalone.
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    // Pre-compute slot so both concurrent requests use the exact same slotStart.
    // The unique partial index on {host, slotStart} fires at the storage layer,
    // which snapshot-isolation transactions alone cannot prevent.
    const slot  = { slotStart: future(24), slotEnd: future(25) };

    const [r1, r2] = await Promise.all([
      book(guest, host.user._id, slot),
      book(guest, host.user._id, slot),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toContain(201);   // one created
    expect(statuses).toContain(409);   // one rejected

    const count = await Booking.countDocuments({ host: host.user._id });
    expect(count).toBe(1);
  }, 15000);
});

// ── Booking lifecycle ─────────────────────────────────────────────────────────
describe('Booking lifecycle — confirm -> complete -> review -> rating (BLK-1, BLK-4)', () => {
  test('full free-session loop updates host rating', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });

    const created = await book(guest, host.user._id);
    expect(created.status).toBe(201);
    const id = created.body.booking._id;

    const confirmed = await request(app)
      .patch(`/api/bookings/${id}/confirm`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.booking.status).toBe('confirmed');
    expect(confirmed.body.booking.dailyRoomUrl).toBeTruthy();

    const completed = await request(app)
      .patch(`/api/bookings/${id}/complete`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(completed.status).toBe(200);
    expect(completed.body.booking.status).toBe('completed');

    const reviewed = await request(app)
      .post(`/api/bookings/${id}/review`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ rating: 5, comment: 'Great host' });
    expect(reviewed.status).toBe(200);

    // BLK-4: rating aggregated back to User
    const hostDoc = await User.findById(host.user._id);
    expect(hostDoc.avgRating).toBe(5);
    expect(hostDoc.totalReviews).toBe(1);
  });

  test('confirm sets respondedAt and host response metrics (BUG-4)', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const created = await book(guest, host.user._id);
    const id = created.body.booking._id;

    await request(app)
      .patch(`/api/bookings/${id}/confirm`)
      .set('Authorization', `Bearer ${host.token}`);

    // Give async recompute time to settle
    await new Promise((r) => setTimeout(r, 200));

    const hostDoc = await User.findById(host.user._id);
    expect(hostDoc.responseRate).toBeGreaterThan(0);
    expect(hostDoc.avgResponseTime).toBeGreaterThanOrEqual(0);
  });

  test('cannot complete a booking that is not confirmed', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const created = await book(guest, host.user._id);
    const res = await request(app)
      .patch(`/api/bookings/${created.body.booking._id}/complete`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(res.status).toBe(400);
  });

  test('review is rejected with an invalid rating (VAL-1)', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const created = await book(guest, host.user._id);
    const id = created.body.booking._id;
    await request(app).patch(`/api/bookings/${id}/confirm`).set('Authorization', `Bearer ${host.token}`);
    await request(app).patch(`/api/bookings/${id}/complete`).set('Authorization', `Bearer ${guest.token}`);

    const res = await request(app)
      .post(`/api/bookings/${id}/review`)
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ rating: 9 });
    expect(res.status).toBe(422);
  });
});

// ── Payments & recording gate ─────────────────────────────────────────────────
describe('Payments & recording gate (BLK-2)', () => {
  test('paid session blocks the recording room until payment is held (402)', async () => {
    const host  = await makeHost(5000);
    const guest = await makeUser({ role: 'guest' });
    const created = await book(guest, host.user._id);
    const id = created.body.booking._id;
    await request(app).patch(`/api/bookings/${id}/confirm`).set('Authorization', `Bearer ${host.token}`);

    const res = await request(app)
      .post('/api/recordings/room')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: id });
    expect(res.status).toBe(402);
  });

  test('payment intent is rejected for a free session', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const created = await book(guest, host.user._id);
    const id = created.body.booking._id;
    await request(app).patch(`/api/bookings/${id}/confirm`).set('Authorization', `Bearer ${host.token}`);

    const res = await request(app)
      .post('/api/payments/intent')
      .set('Authorization', `Bearer ${guest.token}`)
      .send({ bookingId: id });
    expect(res.status).toBe(400);
  });
});

// ── Cancel + refund ───────────────────────────────────────────────────────────
describe('Cancellation & refund (BUG-6)', () => {
  test('cancelling a free booking sets status to cancelled', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const created = await book(guest, host.user._id);
    const id = created.body.booking._id;

    const res = await request(app)
      .patch(`/api/bookings/${id}/cancel`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('cancelled');
    // No refund call for free sessions
    expect(refundPayment).not.toHaveBeenCalled();
  });

  test('cancelling a held paid booking triggers a refund (BUG-6)', async () => {
    const host  = await makeHost(5000);
    const guest = await makeUser({ role: 'guest' });
    const created = await book(guest, host.user._id);
    const id = created.body.booking._id;

    // Simulate payment held (set directly — webhook would normally do this)
    await Booking.findByIdAndUpdate(id, {
      paymentStatus:          'held',
      stripePaymentIntentId:  'pi_held_test',
    });

    const res = await request(app)
      .patch(`/api/bookings/${id}/cancel`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(res.status).toBe(200);
    expect(res.body.booking.status).toBe('cancelled');
    expect(refundPayment).toHaveBeenCalledWith('pi_held_test');
  });

  test('cannot cancel a completed booking', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    const created = await book(guest, host.user._id);
    const id = created.body.booking._id;
    await request(app).patch(`/api/bookings/${id}/confirm`).set('Authorization', `Bearer ${host.token}`);
    await request(app).patch(`/api/bookings/${id}/complete`).set('Authorization', `Bearer ${guest.token}`);

    const res = await request(app)
      .patch(`/api/bookings/${id}/cancel`)
      .set('Authorization', `Bearer ${guest.token}`);
    expect(res.status).toBe(400);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────
describe('Booking list pagination (BUG-8)', () => {
  test('GET /api/bookings returns pagination metadata', async () => {
    const host  = await makeHost();
    const guest = await makeUser({ role: 'guest' });
    await book(guest, host.user._id, { slotStart: future(24), slotEnd: future(25) });

    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', `Bearer ${guest.token}`);
    expect(res.status).toBe(200);
    expect(res.body.bookings).toBeInstanceOf(Array);
    expect(res.body.pagination).toMatchObject({
      total: expect.any(Number),
      page:  1,
      limit: 20,
    });
  });
});
