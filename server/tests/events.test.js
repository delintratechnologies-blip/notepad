const EventBus = require('../stitcher/events/EventBus');
const EVENTS   = require('../stitcher/events/EVENTS');
const stitcher = require('../stitcher');
const { request, app, makeUser, makeAdmin, makeHost } = require('./helpers');

// ── Unit: EventBus ────────────────────────────────────────────────────────────
describe('EventBus (unit)', () => {
  let bus;

  beforeEach(() => { bus = new EventBus(); });

  test('on() + emit() — handler receives payload', () => {
    const received = [];
    bus.on('test.event', (payload) => received.push(payload));
    bus.emit('test.event', { id: '123' });
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe('123');
  });

  test('emit() passes eventName as second argument to handler', () => {
    const calls = [];
    bus.on('test.named', (payload, eventName) => calls.push(eventName));
    bus.emit('test.named', { id: 'x' });
    expect(calls[0]).toBe('test.named');
  });

  test('multiple handlers on the same event — all called', () => {
    const log = [];
    bus.on('multi', () => log.push('a'));
    bus.on('multi', () => log.push('b'));
    bus.emit('multi', {});
    expect(log.sort()).toEqual(['a', 'b']);
  });

  test('one handler throwing does not prevent others from running', () => {
    const log = [];
    bus.on('fault', () => { throw new Error('boom'); });
    bus.on('fault', () => log.push('safe'));
    expect(() => bus.emit('fault', {})).not.toThrow();
    expect(log).toContain('safe');
    expect(bus.stats().errorCount).toBe(1);
  });

  test('off() removes a specific handler', () => {
    const log = [];
    const handler = () => log.push('called');
    bus.on('off.test', handler);
    bus.off('off.test', handler);
    bus.emit('off.test', {});
    expect(log).toHaveLength(0);
  });

  test('on() returns an unsubscribe function', () => {
    const log = [];
    const unsub = bus.on('unsub.test', () => log.push('x'));
    unsub();
    bus.emit('unsub.test', {});
    expect(log).toHaveLength(0);
  });

  test('emit() on event with no subscribers is a noop', () => {
    expect(() => bus.emit('no.subscribers', { id: '1' })).not.toThrow();
  });

  test('emitCount increments on every emit()', () => {
    bus.emit('c1', {});
    bus.emit('c2', {});
    bus.emit('c1', {});
    expect(bus.stats().emitCount).toBe(3);
  });

  test('listenerCount() reflects subscriptions', () => {
    expect(bus.listenerCount('x.event')).toBe(0);
    const unsub = bus.on('x.event', () => {});
    expect(bus.listenerCount('x.event')).toBe(1);
    unsub();
    expect(bus.listenerCount('x.event')).toBe(0);
  });

  test('registeredEvents() lists events with active subscribers', () => {
    const unsub = bus.on('active.event', () => {});
    expect(bus.registeredEvents()).toContain('active.event');
    unsub();
    expect(bus.registeredEvents()).not.toContain('active.event');
  });

  test('on() throws for non-string event name', () => {
    expect(() => bus.on(null, () => {})).toThrow('non-empty string');
  });

  test('on() throws for non-function handler', () => {
    expect(() => bus.on('valid.event', 'notafunction')).toThrow('must be a function');
  });

  test('emit() throws for non-string event name', () => {
    expect(() => bus.emit(42, {})).toThrow('non-empty string');
  });

  test('async handler rejection is caught — does not become unhandled promise', async () => {
    bus.on('async.fail', async () => { throw new Error('async boom'); });
    expect(() => bus.emit('async.fail', {})).not.toThrow();
    // Give the microtask queue time to settle so the catch runs.
    await new Promise((r) => setImmediate(r));
    expect(bus.stats().errorCount).toBe(1);
  });

  test('async handler success — payload received correctly', async () => {
    const log = [];
    bus.on('async.ok', async (payload) => {
      await Promise.resolve();
      log.push(payload.id);
    });
    bus.emit('async.ok', { id: 'async-id' });
    await new Promise((r) => setImmediate(r));
    expect(log[0]).toBe('async-id');
  });
});

// ── Unit: EVENTS constants ────────────────────────────────────────────────────
describe('EVENTS constants (unit)', () => {
  test('all expected event names are defined', () => {
    expect(EVENTS.USER_REGISTERED).toBe('user.registered');
    expect(EVENTS.BOOKING_CREATED).toBe('booking.created');
    expect(EVENTS.BOOKING_CONFIRMED).toBe('booking.confirmed');
    expect(EVENTS.BOOKING_CANCELLED).toBe('booking.cancelled');
    expect(EVENTS.BOOKING_COMPLETED).toBe('booking.completed');
    expect(EVENTS.BOOKING_REVIEWED).toBe('booking.reviewed');
    expect(EVENTS.REPORT_FILED).toBe('report.filed');
    expect(EVENTS.USER_BLOCKED).toBe('user.blocked');
    expect(EVENTS.USER_UNBLOCKED).toBe('user.unblocked');
  });

  test('EVENTS object is frozen — mutations are silently ignored', () => {
    const before = Object.keys(EVENTS).length;
    try { EVENTS.NEW_KEY = 'test'; } catch (_) { /* strict-mode environments throw */ }
    expect(Object.keys(EVENTS)).toHaveLength(before);
    expect(EVENTS.NEW_KEY).toBeUndefined();
  });

  test('has 12 event types', () => {
    expect(Object.keys(EVENTS)).toHaveLength(12);
  });
});

// ── Unit: DataStitcher.events ─────────────────────────────────────────────────
describe('DataStitcher.events (unit)', () => {
  test('stitcher.events is an EventBus instance after initialize()', () => {
    expect(stitcher.events).toBeInstanceOf(EventBus);
  });

  test('stitcher.EVENTS matches the EVENTS module', () => {
    expect(stitcher.EVENTS).toBe(EVENTS);
  });

  test('stitcher.events.stats() returns expected shape', () => {
    const stats = stitcher.events.stats();
    expect(stats).toHaveProperty('emitCount');
    expect(stats).toHaveProperty('errorCount');
    expect(Array.isArray(stats.events)).toBe(true);
  });
});

// ── Integration: events emitted by routes ────────────────────────────────────
describe('EventBus — route integration', () => {
  test('user registration emits USER_REGISTERED with userId and role', async () => {
    const received = [];
    const unsub = stitcher.events.on(EVENTS.USER_REGISTERED, (p) => received.push(p));

    await makeUser({ role: 'guest', name: 'EventTestGuest' });

    unsub();
    expect(received.length).toBeGreaterThanOrEqual(1);
    const payload = received[received.length - 1];
    expect(payload).toHaveProperty('userId');
    expect(payload.role).toBe('guest');
    // Payload must be IDs only — no full objects.
    expect(typeof payload.userId).toBe('string');
  });

  test('host registration emits USER_REGISTERED with role=host', async () => {
    const received = [];
    const unsub = stitcher.events.on(EVENTS.USER_REGISTERED, (p) => received.push(p));

    await makeUser({ role: 'host', name: 'EventTestHost' });

    unsub();
    const payload = received[received.length - 1];
    expect(payload.role).toBe('host');
  });

  test('block emits USER_BLOCKED with userId and actorId', async () => {
    const received = [];
    const unsub = stitcher.events.on(EVENTS.USER_BLOCKED, (p) => received.push(p));

    const { user: target } = await makeUser({ role: 'guest' });
    const { token }        = await makeAdmin();

    await request(app)
      .post(`/api/moderation/block/${target._id}`)
      .set('Authorization', `Bearer ${token}`);

    unsub();
    expect(received.length).toBeGreaterThanOrEqual(1);
    const payload = received[received.length - 1];
    expect(payload.userId).toBe(target._id.toString());
    expect(typeof payload.actorId).toBe('string');
  });

  test('unblock emits USER_UNBLOCKED', async () => {
    const received = [];
    const unsub = stitcher.events.on(EVENTS.USER_UNBLOCKED, (p) => received.push(p));

    const { user: target } = await makeUser({ role: 'guest' });
    const { token }        = await makeAdmin();

    await request(app)
      .post(`/api/moderation/block/${target._id}`)
      .set('Authorization', `Bearer ${token}`);
    await request(app)
      .post(`/api/moderation/unblock/${target._id}`)
      .set('Authorization', `Bearer ${token}`);

    unsub();
    expect(received.length).toBeGreaterThanOrEqual(1);
    expect(received[received.length - 1].userId).toBe(target._id.toString());
  });

  test('report filing emits REPORT_FILED with IDs only', async () => {
    const received = [];
    const unsub = stitcher.events.on(EVENTS.REPORT_FILED, (p) => received.push(p));

    const reporter             = await makeUser({ role: 'guest' });
    const { user: reportedUser } = await makeUser({ role: 'host' });

    await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reportedId: reportedUser._id, reason: 'Spam and harassing messages repeatedly' });

    unsub();
    expect(received.length).toBeGreaterThanOrEqual(1);
    const payload = received[received.length - 1];
    expect(typeof payload.reportId).toBe('string');
    expect(typeof payload.reporterId).toBe('string');
    expect(typeof payload.reportedId).toBe('string');
    // Payloads must be IDs, not full documents.
    expect(payload.reportedId).toBe(reportedUser._id.toString());
  });

  test('health endpoint shows events as active with stats', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.components.events).toBe('active');
    expect(res.body.eventBus).toHaveProperty('emitCount');
    expect(res.body.totals.eventTypes).toBe(12);
  });
});
