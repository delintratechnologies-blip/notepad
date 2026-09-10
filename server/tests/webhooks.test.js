// Stub the Stripe SDK: constructEvent returns the parsed raw body (no real
// signature check). A body containing "__bad_sig__" triggers the failure path.
jest.mock('stripe', () => jest.fn(() => ({
  webhooks: {
    constructEvent: (raw) => {
      const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      if (text.includes('__bad_sig__')) {
        throw new Error('No signatures found matching the expected signature for payload');
      }
      return JSON.parse(text);
    },
  },
})));

const { request, app } = require('./helpers');
const Booking  = require('../models/Booking');
const User     = require('../models/User');
const ProcessedWebhookEvent = require('../models/ProcessedWebhookEvent');

const post = (payload) =>
  request(app)
    .post('/api/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', 't=1,v1=test')
    .send(typeof payload === 'string' ? payload : JSON.stringify(payload));

const capturable = (id, piId) => ({
  id,
  type: 'payment_intent.amount_capturable_updated',
  data: { object: { id: piId } },
});

async function bookingWithIntent(paymentIntentId, over = {}) {
  const uniq  = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
  const host  = await User.create({ email: `h${uniq}@t.com`, password: 'password123', name: 'H', role: 'host' });
  const guest = await User.create({ email: `g${uniq}@t.com`, password: 'password123', name: 'G', role: 'guest' });
  return Booking.create({
    host: host._id,
    guest: guest._id,
    slotStart: new Date(Date.now() + 864e5),
    slotEnd:   new Date(Date.now() + 864e5 + 36e5),
    amountCents: 5000,
    currency: 'usd',
    stripePaymentIntentId: paymentIntentId,
    paymentStatus: 'unpaid',
    ...over,
  });
}

beforeAll(async () => {
  // Guarantee the unique index exists before the concurrency test hammers it.
  await ProcessedWebhookEvent.init();
});

describe('Stripe webhook idempotency (F2)', () => {
  test('first delivery processes the event', async () => {
    const booking = await bookingWithIntent('pi_first');

    const res = await post(capturable('evt_first', 'pi_first'));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });
    expect((await Booking.findById(booking._id)).paymentStatus).toBe('held');
    expect(await ProcessedWebhookEvent.countDocuments({ eventId: 'evt_first' })).toBe(1);
  });

  test('duplicate delivery is skipped — 200, no re-processing', async () => {
    const booking = await bookingWithIntent('pi_dup');
    expect((await post(capturable('evt_dup', 'pi_dup'))).status).toBe(200);

    // Move to a state the handler would overwrite if it ran a second time.
    await Booking.findByIdAndUpdate(booking._id, { paymentStatus: 'released' });

    const second = await post(capturable('evt_dup', 'pi_dup'));

    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    expect((await Booking.findById(booking._id)).paymentStatus).toBe('released');
    expect(await ProcessedWebhookEvent.countDocuments({ eventId: 'evt_dup' })).toBe(1);
  });

  test('concurrent duplicate deliveries process exactly once', async () => {
    const booking = await bookingWithIntent('pi_race');
    const spy = jest.spyOn(Booking, 'findOneAndUpdate');

    const results = await Promise.all(
      Array.from({ length: 5 }, () => post(capturable('evt_race', 'pi_race')))
    );

    for (const r of results) expect(r.status).toBe(200);
    expect(await ProcessedWebhookEvent.countDocuments({ eventId: 'evt_race' })).toBe(1);
    expect((await Booking.findById(booking._id)).paymentStatus).toBe('held');
    // The side effect ran for exactly one of the five deliveries.
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  }, 15000);

  test('unhandled event type is still recorded and acknowledged', async () => {
    const first = await post({ id: 'evt_other', type: 'charge.updated', data: { object: {} } });
    expect(first.status).toBe(200);
    expect(await ProcessedWebhookEvent.countDocuments({ eventId: 'evt_other' })).toBe(1);

    const second = await post({ id: 'evt_other', type: 'charge.updated', data: { object: {} } });
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
  });

  test('invalid signature is rejected with 400 and not recorded', async () => {
    const res = await post({
      id: 'evt_badsig',
      type: 'payment_intent.amount_capturable_updated',
      data: { object: { id: 'pi_x' } },
      __bad_sig__: true,
    });

    expect(res.status).toBe(400);
    expect(await ProcessedWebhookEvent.countDocuments({ eventId: 'evt_badsig' })).toBe(0);
  });

  test('raw body reaches the handler as a Buffer (express.json is scoped away)', async () => {
    // A regression guard for the app.js body-parser fix: if the global JSON
    // parser ran, constructEvent would receive an object and throw → 400.
    const booking = await bookingWithIntent('pi_raw');
    const res = await post(capturable('evt_raw', 'pi_raw'));
    expect(res.status).toBe(200);
    expect((await Booking.findById(booking._id)).paymentStatus).toBe('held');
  });
});
