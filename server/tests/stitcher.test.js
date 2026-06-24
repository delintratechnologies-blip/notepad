const { request, app, makeAdmin, makeUser } = require('./helpers');
const stitcher = require('../stitcher');

// ── Unit: CollectionRegistry ──────────────────────────────────────────────────
describe('CollectionRegistry (unit)', () => {
  const CollectionRegistry = require('../stitcher/registry/CollectionRegistry');

  test('register and retrieve a collection', () => {
    const reg   = new CollectionRegistry();
    const fakeModel = { find: () => {} };
    reg.register('things', fakeModel, { version: 2, owner: 'test', tags: ['core'] });

    const { model, meta } = reg.get('things');
    expect(model).toBe(fakeModel);
    expect(meta.version).toBe(2);
    expect(meta.owner).toBe('test');
    expect(meta.tags).toEqual(['core']);
    expect(meta.sensitiveFields).toEqual([]);
  });

  test('throws when registering the same name twice', () => {
    const reg       = new CollectionRegistry();
    const fakeModel = { find: () => {} };
    reg.register('dup', fakeModel);
    expect(() => reg.register('dup', fakeModel)).toThrow("'dup' is already registered");
  });

  test('throws when model is not a Mongoose-shaped object', () => {
    const reg = new CollectionRegistry();
    expect(() => reg.register('bad', {})).toThrow('must be a Mongoose Model');
  });

  test('has() returns false for unknown collections', () => {
    const reg = new CollectionRegistry();
    expect(reg.has('nonexistent')).toBe(false);
  });

  test('names() returns all registered names', () => {
    const reg       = new CollectionRegistry();
    const fakeModel = { find: () => {} };
    reg.register('a', fakeModel);
    reg.register('b', fakeModel);
    expect(reg.names().sort()).toEqual(['a', 'b']);
  });
});

// ── Unit: SchemaRegistry ──────────────────────────────────────────────────────
describe('SchemaRegistry (unit)', () => {
  const SchemaRegistry = require('../stitcher/registry/SchemaRegistry');
  const User           = require('../models/User');
  const Booking        = require('../models/Booking');

  test('introspects User schema — password marked sensitive (select:false)', () => {
    const sr = new SchemaRegistry();
    sr.introspect('users', User, ['password', 'refreshToken', 'stripeAccountId']);

    const fields   = sr.get('users');
    expect(fields).not.toBeNull();
    expect(fields['password']).toBeDefined();
    expect(fields['password'].sensitive).toBe(true);
    expect(fields['password'].selected).toBe(false);
  });

  test('introspects Booking schema — stripePaymentIntentId marked sensitive', () => {
    const sr = new SchemaRegistry();
    sr.introspect('bookings', Booking, ['stripePaymentIntentId']);

    const sensitive = sr.getSensitiveFields('bookings');
    expect(sensitive).toContain('stripePaymentIntentId');
  });

  test('getSensitiveFields returns [] for unknown collection', () => {
    const sr = new SchemaRegistry();
    expect(sr.getSensitiveFields('nobody')).toEqual([]);
  });

  test('get() returns null for un-introspected collection', () => {
    const sr = new SchemaRegistry();
    expect(sr.get('missing')).toBeNull();
  });

  test('non-sensitive fields are not in sensitive list', () => {
    const sr = new SchemaRegistry();
    sr.introspect('users', User, ['password', 'refreshToken', 'stripeAccountId']);

    const sensitive = sr.getSensitiveFields('users');
    expect(sensitive).not.toContain('name');
    expect(sensitive).not.toContain('role');
  });

  test('__v is excluded from introspected fields', () => {
    const sr = new SchemaRegistry();
    sr.introspect('users', User, []);
    const fields = sr.get('users');
    expect(Object.keys(fields)).not.toContain('__v');
  });
});

// ── Unit: RelationshipRegistry ────────────────────────────────────────────────
describe('RelationshipRegistry (unit)', () => {
  const RelationshipRegistry = require('../stitcher/registry/RelationshipRegistry');

  test('declare and retrieve relationships for a collection', () => {
    const rr = new RelationshipRegistry();
    rr.declare([
      { from: 'messages', field: 'booking',  to: 'bookings', as: 'parentBooking', type: 'belongsTo' },
      { from: 'messages', field: 'sender',   to: 'users',    as: 'senderUser',    type: 'belongsTo' },
    ]);
    const rels = rr.forCollection('messages');
    expect(rels).toHaveLength(2);
    expect(rels[0].as).toBe('parentBooking');
  });

  test('count() reflects declared relationships', () => {
    const rr = new RelationshipRegistry();
    rr.declare([{ from: 'a', field: 'b', to: 'c', as: 'cAlias', type: 'belongsTo' }]);
    expect(rr.count()).toBe(1);
  });

  test('throws for missing required field', () => {
    const rr = new RelationshipRegistry();
    expect(() =>
      rr.declare([{ from: 'a', field: 'b', to: 'c' }])  // missing type
    ).toThrow("missing 'type'");
  });

  test('throws for invalid relationship type', () => {
    const rr = new RelationshipRegistry();
    expect(() =>
      rr.declare([{ from: 'a', field: 'b', to: 'c', type: 'manyToMany' }])
    ).toThrow("Invalid type 'manyToMany'");
  });

  test('find() locates a relationship by collection + alias', () => {
    const rr = new RelationshipRegistry();
    rr.declare([{ from: 'bookings', field: 'host', to: 'users', as: 'hostUser', type: 'belongsTo' }]);
    const rel = rr.find('bookings', 'hostUser');
    expect(rel).not.toBeNull();
    expect(rel.to).toBe('users');
  });

  test('validateAgainst() throws for unknown collections', () => {
    const CollectionRegistry = require('../stitcher/registry/CollectionRegistry');
    const rr  = new RelationshipRegistry();
    const reg = new CollectionRegistry();
    const fakeModel = { find: () => {} };
    reg.register('users', fakeModel);

    rr.declare([
      { from: 'users', field: 'ownerId', to: 'missing_collection', as: 'owner', type: 'belongsTo' },
    ]);
    expect(() => rr.validateAgainst(reg)).toThrow("unregistered collection 'missing_collection'");
  });
});

// ── Unit: utils ───────────────────────────────────────────────────────────────
describe('Stitcher utils (unit)', () => {
  const { escapeRegex, isValidObjectId, omitKeys, shallowDiff } = require('../stitcher/utils');

  test('escapeRegex escapes regex metacharacters', () => {
    expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
  });

  test('isValidObjectId validates 24-char hex strings', () => {
    expect(isValidObjectId('507f1f77bcf86cd799439011')).toBe(true);
    expect(isValidObjectId('short')).toBe(false);
    expect(isValidObjectId('')).toBe(false);
  });

  test('omitKeys returns a new object without the specified keys', () => {
    const obj    = { a: 1, b: 2, c: 3 };
    const result = omitKeys(obj, ['b']);
    expect(result).toEqual({ a: 1, c: 3 });
    expect(obj).toEqual({ a: 1, b: 2, c: 3 }); // original unchanged
  });

  test('shallowDiff identifies changed fields', () => {
    const before = { status: 'pending', amount: 100 };
    const after  = { status: 'confirmed', amount: 100 };
    const diff   = shallowDiff(before, after);
    expect(diff).toHaveProperty('status');
    expect(diff.status.before).toBe('pending');
    expect(diff.status.after).toBe('confirmed');
    expect(diff).not.toHaveProperty('amount');
  });
});

// ── Unit: DataStitcher singleton ──────────────────────────────────────────────
describe('DataStitcher singleton (unit)', () => {
  test('is initialized (app.js calls initialize() at require time)', () => {
    expect(stitcher._ready).toBe(true);
  });

  test('has all expected collections registered', () => {
    const names = stitcher.collections.names();
    expect(names).toContain('users');
    expect(names).toContain('bookings');
    expect(names).toContain('messages');
    expect(names).toContain('notifications');
    expect(names).toContain('availabilities');
    expect(names).toContain('reports');
    expect(names).toContain('disputes');              // Step 6
    expect(names).toContain('migrationhistories');    // Step 7
    expect(names).toContain('analyticsevents');       // Step 8
    expect(names).toContain('aisessions');            // Step 10
    expect(names).toContain('aimemories');            // Step 10
    expect(names).toContain('auditlogs');             // Step 3
  });

  test('has exactly 12 declared relationships', () => {
    expect(stitcher.relationships.count()).toBe(12);
  });

  test('relationships reference only registered collections', () => {
    // This would have thrown during initialize() if any ref was wrong.
    // This test documents the invariant explicitly.
    const names = new Set(stitcher.collections.names());
    for (const rel of stitcher.relationships.all()) {
      expect(names.has(rel.from)).toBe(true);
      expect(names.has(rel.to)).toBe(true);
    }
  });

  test('healthCheck() returns ok status', () => {
    const hc = stitcher.healthCheck();
    expect(hc.status).toBe('ok');
    expect(hc.totals.collections).toBeGreaterThanOrEqual(6);
    expect(hc.totals.relationships).toBeGreaterThanOrEqual(8);
  });

  test('initialize() is idempotent', () => {
    const before = stitcher._startedAt;
    stitcher.initialize();
    expect(stitcher._startedAt).toBe(before);
  });
});

// ── Integration: GET /api/stitcher/health ────────────────────────────────────
describe('GET /api/stitcher/health', () => {
  test('unauthenticated → 401', async () => {
    const res = await request(app).get('/api/stitcher/health');
    expect(res.status).toBe(401);
  });

  test('authenticated non-admin (guest) → 403', async () => {
    const { token } = await makeUser({ role: 'guest' });
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('authenticated non-admin (host) → 403', async () => {
    const { token } = await makeUser({ role: 'host' });
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  test('admin → 200 with full health report', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.tenant).toBe('castreach');
  });

  test('health report includes all 6 registered collections', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    const names = res.body.collections.map((c) => c.name);
    expect(names).toContain('users');
    expect(names).toContain('bookings');
    expect(names).toContain('messages');
    expect(names).toContain('notifications');
    expect(names).toContain('availabilities');
    expect(names).toContain('reports');
  });

  test('health report lists at least 8 relationships', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.relationships.length).toBeGreaterThanOrEqual(8);
    expect(res.body.totals.relationships).toBeGreaterThanOrEqual(8);
  });

  test('sensitive fields are named in health report (not their values)', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    const usersEntry = res.body.collections.find((c) => c.name === 'users');
    expect(usersEntry.sensitiveFields).toContain('password');
    expect(usersEntry.sensitiveFields).toContain('refreshToken');
    expect(usersEntry.sensitiveFields).toContain('stripeAccountId');
  });

  test('bookings.stripePaymentIntentId is in sensitive list', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    const bookingsEntry = res.body.collections.find((c) => c.name === 'bookings');
    expect(bookingsEntry.sensitiveFields).toContain('stripePaymentIntentId');
  });

  test('component status shows active and pending components', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.body.components.collections).toBe('active');
    expect(res.body.components.schema).toBe('active');
    expect(res.body.components.relationships).toBe('active');
    expect(res.body.components.audit).toBe('active');           // Step 3 complete
    expect(res.body.components.events).toBe('active');          // Step 4 complete
    expect(res.body.components.query).toBe('active');            // Step 5 done
    expect(res.body.components.migration).toBe('active');        // Step 7 done
    expect(res.body.components.analytics).toBe('active');        // Step 8 done
    expect(res.body.components.tenantLayer).toBe('active');      // Step 9 done
    expect(res.body.components.ai).toBe('active');               // Step 10 done
    expect(typeof res.body.migrationCount).toBe('number');
    expect(res.body.analyticsStats).toHaveProperty('trackCount');
  });
});
