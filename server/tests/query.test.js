/**
 * Tests for Step 5 — Unified Query Layer.
 *
 * Covers:
 *   - QueryBuilder construction and method chaining
 *   - JoinResolver: with() maps alias → Mongoose populate
 *   - find/findOne/findById/count/create/update/updateById/delete/deleteById/page
 *   - paginate() + page() pagination envelope
 *   - stitcher.query() factory behaviour (call count, throws on unknown collection)
 *   - Health endpoint reflects query as active
 *
 * NOTE: afterEach in setup.js wipes all collections. Each test that touches
 * the DB must create its own data — do NOT share data via beforeAll.
 */

const QueryBuilder = require('../stitcher/query/QueryBuilder');
const stitcher     = require('../stitcher');
const { request, app, makeUser, makeAdmin, makeHost } = require('./helpers');
const User         = require('../models/User');
const Booking      = require('../models/Booking');

// ── Unit: QueryBuilder construction ──────────────────────────────────────────
describe('QueryBuilder (unit — construction)', () => {
  test('stitcher.query() returns a QueryBuilder for a known collection', () => {
    const q = stitcher.query('users');
    expect(q).toBeInstanceOf(QueryBuilder);
  });

  test('stitcher.query() throws for an unknown collection', () => {
    expect(() => stitcher.query('nonexistent_collection')).toThrow(
      "Unknown collection 'nonexistent_collection'"
    );
  });

  test('returns a fresh builder each call — state does not leak between instances', () => {
    const q1 = stitcher.query('users').limit(5);
    const q2 = stitcher.query('users');
    expect(q1._limit).toBe(5);
    expect(q2._limit).toBeNull();
  });

  test('stitcher._queryCalls increments on every stitcher.query() call', () => {
    const before = stitcher._queryCalls;
    stitcher.query('users');
    stitcher.query('bookings');
    expect(stitcher._queryCalls).toBe(before + 2);
  });
});

// ── Unit: builder method chaining ─────────────────────────────────────────────
describe('QueryBuilder — builder methods', () => {
  test('limit() clamps to >= 1', () => {
    const q = stitcher.query('users');
    q.limit(-5);
    expect(q._limit).toBe(1);
  });

  test('skip() clamps to >= 0', () => {
    const q = stitcher.query('users');
    q.skip(-10);
    expect(q._skip).toBe(0);
  });

  test('paginate(2, 10) sets skip=10 limit=10', () => {
    const q = stitcher.query('users').paginate(2, 10);
    expect(q._limit).toBe(10);
    expect(q._skip).toBe(10);
  });

  test('paginate() clamps limit to 100', () => {
    const q = stitcher.query('users').paginate(1, 9999);
    expect(q._limit).toBe(100);
  });

  test('with() throws for undeclared alias', () => {
    const q = stitcher.query('users');
    expect(() => q.with('nonexistentAlias')).toThrow("No relationship 'nonexistentAlias'");
  });

  test('with() succeeds for a declared relationship alias', () => {
    const q = stitcher.query('bookings');
    expect(() => q.with('hostUser')).not.toThrow();
    expect(q._withs).toHaveLength(1);
    expect(q._withs[0].path).toBe('host');
  });

  test('multiple with() calls accumulate', () => {
    const q = stitcher.query('bookings')
      .with('hostUser', 'name avatar')
      .with('guestUser', 'name');
    expect(q._withs).toHaveLength(2);
    expect(q._withs[0].select).toBe('name avatar');
    expect(q._withs[1].select).toBe('name');
  });

  test('all builder methods return this for chaining', () => {
    const q = stitcher.query('bookings');
    expect(q.sort({ slotStart: -1 })).toBe(q);
    expect(q.limit(10)).toBe(q);
    expect(q.skip(0)).toBe(q);
    expect(q.select('host guest status')).toBe(q);
  });
});

// ── Integration: find / findOne / findById / count ─────────────────────────
describe('QueryBuilder — read operations', () => {
  test('find() returns an array', async () => {
    await makeUser({ role: 'guest', name: 'QB Guest' });
    const users = await stitcher.query('users').find({ role: 'guest' });
    expect(Array.isArray(users)).toBe(true);
    expect(users.length).toBeGreaterThanOrEqual(1);
  });

  test('find() respects limit()', async () => {
    await makeUser({ role: 'guest' });
    await makeUser({ role: 'guest' });
    await makeUser({ role: 'guest' });
    const users = await stitcher.query('users').limit(1).find({});
    expect(users).toHaveLength(1);
  });

  test('find() respects sort()', async () => {
    await makeUser({ role: 'guest', name: 'Alpha User' });
    await makeUser({ role: 'guest', name: 'Beta User' });
    const docs = await stitcher.query('users').sort({ createdAt: 1 }).limit(2).find({});
    expect(docs[0].createdAt <= docs[1].createdAt).toBe(true);
  });

  test('findOne() returns a single document', async () => {
    await makeUser({ role: 'guest' });
    const user = await stitcher.query('users').findOne({ role: 'guest' });
    expect(user).not.toBeNull();
    expect(user.role).toBe('guest');
  });

  test('findOne() returns null for no match', async () => {
    const result = await stitcher.query('users').findOne({ role: 'nonexistent_role_xyz' });
    expect(result).toBeNull();
  });

  test('findById() returns the correct document', async () => {
    const { user } = await makeUser({ role: 'guest' });
    const found = await stitcher.query('users').findById(user._id);
    expect(found).not.toBeNull();
    expect(found._id.toString()).toBe(user._id.toString());
  });

  test('findById() returns null for unknown id', async () => {
    const result = await stitcher.query('users').findById('507f1f77bcf86cd799439099');
    expect(result).toBeNull();
  });

  test('count() returns the number of matching documents', async () => {
    await makeUser({ role: 'guest' });
    await makeUser({ role: 'guest' });
    const n = await stitcher.query('users').count({ role: 'guest' });
    expect(typeof n).toBe('number');
    expect(n).toBeGreaterThanOrEqual(2);
  });

  test('select() restricts returned fields', async () => {
    await makeUser({ role: 'guest' });
    const user = await stitcher.query('users')
      .select('name role')
      .findOne({ role: 'guest' });
    expect(user).not.toBeNull();
    expect(user.name).toBeDefined();
    expect(user.email).toBeUndefined();
  });
});

// ── Integration: create / update / delete ────────────────────────────────────
describe('QueryBuilder — write operations', () => {
  test('create() inserts a document and returns it', async () => {
    const email = `qb-create-${Date.now()}@test.com`;
    const doc   = await stitcher.query('users').create({
      name:     'QB Create Test',
      email,
      password: 'password123',
      role:     'guest',
    });
    expect(doc._id).toBeDefined();
    expect(doc.email).toBe(email);
  });

  test('updateById() updates and returns the new document', async () => {
    const { user } = await makeUser({ role: 'guest', name: 'To Update' });
    const updated  = await stitcher.query('users').updateById(user._id, { name: 'Updated Name' });
    expect(updated.name).toBe('Updated Name');
    expect(updated._id.toString()).toBe(user._id.toString());
  });

  test('update() updates by filter and returns updated doc', async () => {
    const email = `qb-update-${Date.now()}@test.com`;
    await User.create({ name: 'Filter Update', email, password: 'pw', role: 'guest' });
    const updated = await stitcher.query('users').update({ email }, { name: 'Filter Updated' });
    expect(updated.name).toBe('Filter Updated');
  });

  test('updateById() returns null for unknown id', async () => {
    const result = await stitcher.query('users').updateById(
      '507f1f77bcf86cd799439099',
      { name: 'Ghost' }
    );
    expect(result).toBeNull();
  });

  test('deleteById() removes a document and returns it', async () => {
    const { user } = await makeUser({ role: 'guest', name: 'To Delete' });
    const deleted  = await stitcher.query('users').deleteById(user._id);
    expect(deleted._id.toString()).toBe(user._id.toString());
    const gone = await stitcher.query('users').findById(user._id);
    expect(gone).toBeNull();
  });

  test('delete() removes by filter', async () => {
    const email = `qb-delete-${Date.now()}@test.com`;
    await User.create({ name: 'Filter Delete', email, password: 'pw', role: 'guest' });
    const deleted = await stitcher.query('users').delete({ email });
    expect(deleted).not.toBeNull();
    expect(deleted.email).toBe(email);
  });
});

// ── Integration: paginate() + page() ─────────────────────────────────────────
describe('QueryBuilder — pagination', () => {
  test('page() returns { docs, total, page, limit, pages }', async () => {
    await makeUser({ role: 'guest' });
    await makeUser({ role: 'guest' });
    const result = await stitcher.query('users')
      .sort({ createdAt: -1 })
      .paginate(1, 5)
      .page({});

    expect(result).toHaveProperty('docs');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('page');
    expect(result).toHaveProperty('limit');
    expect(result).toHaveProperty('pages');
    expect(Array.isArray(result.docs)).toBe(true);
    expect(result.docs.length).toBeLessThanOrEqual(5);
    expect(result.limit).toBe(5);
    expect(result.page).toBe(1);
  });

  test('page 2 returns different docs than page 1', async () => {
    await makeUser({ role: 'guest', name: 'Pg Alpha' });
    await makeUser({ role: 'guest', name: 'Pg Beta' });

    const p1 = await stitcher.query('users').sort({ createdAt: 1 }).paginate(1, 1).page({});
    const p2 = await stitcher.query('users').sort({ createdAt: 1 }).paginate(2, 1).page({});

    expect(p1.docs).toHaveLength(1);
    expect(p2.docs).toHaveLength(1);
    expect(p1.docs[0]._id.toString()).not.toBe(p2.docs[0]._id.toString());
  });

  test('pages is Math.ceil(total / limit)', async () => {
    await makeUser({ role: 'guest' });
    await makeUser({ role: 'guest' });
    await makeUser({ role: 'guest' });
    const limit  = 2;
    const result = await stitcher.query('users').paginate(1, limit).page({});
    const total  = result.total;
    expect(result.pages).toBe(Math.ceil(total / limit));
  });
});

// ── Integration: with() — JoinResolver ───────────────────────────────────────
describe('QueryBuilder — JoinResolver (with)', () => {
  async function makeBooking() {
    const h = await makeHost();
    const g = await makeUser({ role: 'guest', name: 'Join Guest' });
    const booking = await Booking.create({
      host:      h.user._id,
      guest:     g.user._id,
      slotStart: new Date(Date.now() + 86400000),
      slotEnd:   new Date(Date.now() + 90000000),
      status:    'pending',
    });
    return { booking, host: h.user, guest: g.user };
  }

  test('with("hostUser") populates host field', async () => {
    const { booking } = await makeBooking();
    const doc = await stitcher.query('bookings')
      .with('hostUser', 'name role')
      .findById(booking._id);

    expect(doc).not.toBeNull();
    expect(typeof doc.host).toBe('object');
    expect(doc.host.name).toBeDefined();
    expect(doc.host.role).toBeDefined();
  });

  test('with("guestUser") populates guest field', async () => {
    const { booking } = await makeBooking();
    const doc = await stitcher.query('bookings')
      .with('guestUser', 'name')
      .findById(booking._id);

    expect(doc).not.toBeNull();
    expect(typeof doc.guest).toBe('object');
    expect(doc.guest.name).toBeDefined();
  });

  test('chaining two with() calls populates both sides', async () => {
    const { booking } = await makeBooking();
    const doc = await stitcher.query('bookings')
      .with('hostUser',  'name')
      .with('guestUser', 'name')
      .findById(booking._id);

    expect(typeof doc.host).toBe('object');
    expect(typeof doc.guest).toBe('object');
  });

  test('with() select restricts joined doc fields', async () => {
    const { booking } = await makeBooking();
    const doc = await stitcher.query('bookings')
      .with('hostUser', 'name')
      .findById(booking._id);

    expect(doc.host.name).toBeDefined();
    expect(doc.host.email).toBeUndefined();
  });
});

// ── Integration: health endpoint ──────────────────────────────────────────────
describe('GET /api/stitcher/health — query component', () => {
  test('query is active and queryCalls is reported', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.components.query).toBe('active');
    expect(typeof res.body.queryCalls).toBe('number');
  });
});
