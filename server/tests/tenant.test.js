/**
 * Tests for Step 9 — Tenant Layer.
 *
 * Covers:
 *   TenantContext (unit):
 *     - run() establishes a context accessible via getTenantId()
 *     - getTenantId() returns 'castreach' outside a context (default)
 *     - isInContext() returns true/false correctly
 *     - Nested contexts: innermost run() wins for its own chain
 *     - DEFAULT_TENANT constant is 'castreach'
 *     - Falsy tenantId coerces to DEFAULT_TENANT
 *
 *   JWT (integration):
 *     - Access token after register contains tenantId claim
 *     - Access token after login contains tenantId claim
 *     - Access token after refresh contains tenantId claim
 *     - New users have tenantId: 'castreach' on the User document
 *
 *   verifyToken middleware (integration):
 *     - Authenticated route runs inside the correct tenant context
 *     - GET /api/stitcher/tenant returns correct tenantId for admin
 *     - GET /api/stitcher/tenant returns 401 without token
 *
 *   Stitcher (integration):
 *     - stitcher.tenant is TenantContext after initialize()
 *     - healthCheck reports tenantLayer: 'active'
 *     - health endpoint includes tenantLayer: 'active'
 *
 *   Analytics + Tenant (integration):
 *     - analytics events carry tenantId from TenantContext, not hardcoded
 *
 *   Migration 004 (unit):
 *     - up() sets tenantId on documents where it is absent
 *     - up() is idempotent (skips documents that already have tenantId)
 *     - down() removes the field
 *
 * NOTE: afterEach wipes all collections — each test creates its own data.
 */

const jwt           = require('jsonwebtoken');
const TenantContext = require('../stitcher/tenant/TenantContext');
const AnalyticsEvent = require('../models/AnalyticsEvent');
const User           = require('../models/User');
const stitcher       = require('../stitcher');
const { request, app, makeUser, makeAdmin, makeHost } = require('./helpers');

const settle = () => new Promise((r) => setTimeout(r, 60));

// ── Unit: TenantContext ───────────────────────────────────────────────────────
describe('TenantContext (unit)', () => {
  test('DEFAULT_TENANT is castreach', () => {
    expect(TenantContext.DEFAULT_TENANT).toBe('castreach');
  });

  test('getTenantId() returns castreach outside a context', () => {
    expect(TenantContext.getTenantId()).toBe('castreach');
  });

  test('isInContext() returns false outside a context', () => {
    expect(TenantContext.isInContext()).toBe(false);
  });

  test('run() + getTenantId() return the provided tenantId inside the context', async () => {
    let captured;
    await TenantContext.run('acme', () => {
      captured = TenantContext.getTenantId();
    });
    expect(captured).toBe('acme');
  });

  test('isInContext() returns true inside run()', async () => {
    let inCtx;
    await TenantContext.run('acme', () => {
      inCtx = TenantContext.isInContext();
    });
    expect(inCtx).toBe(true);
  });

  test('context is gone after run() completes', async () => {
    await TenantContext.run('acme', () => {});
    expect(TenantContext.isInContext()).toBe(false);
    expect(TenantContext.getTenantId()).toBe('castreach');
  });

  test('nested run() — inner context is active for its own chain', async () => {
    const captured = [];
    await TenantContext.run('outer', () => {
      captured.push(TenantContext.getTenantId()); // 'outer'
      TenantContext.run('inner', () => {
        captured.push(TenantContext.getTenantId()); // 'inner'
      });
      captured.push(TenantContext.getTenantId()); // 'outer' again (outer chain unaffected)
    });
    expect(captured).toEqual(['outer', 'inner', 'outer']);
  });

  test('falsy tenantId coerces to DEFAULT_TENANT', async () => {
    let captured;
    await TenantContext.run('', () => {
      captured = TenantContext.getTenantId();
    });
    expect(captured).toBe('castreach');
  });

  test('async work inside run() inherits the context', async () => {
    let captured;
    await TenantContext.run('async-tenant', async () => {
      await new Promise((r) => setTimeout(r, 5));
      captured = TenantContext.getTenantId();
    });
    expect(captured).toBe('async-tenant');
  });
});

// ── User model: tenantId field ────────────────────────────────────────────────
describe('User model — tenantId field', () => {
  test('new user has tenantId: castreach by default', async () => {
    const user = await User.create({
      name: 'Tenant User',
      email: 'tenant@example.com',
      password: 'Test@1234',
      role: 'guest',
    });
    expect(user.tenantId).toBe('castreach');
  });

  test('tenantId is stored and retrievable', async () => {
    const user = await User.create({
      name: 'Tenant Host',
      email: 'tenanthost@example.com',
      password: 'Test@1234',
      role: 'host',
      tenantId: 'future_tenant',
    });
    const found = await User.findById(user._id);
    expect(found.tenantId).toBe('future_tenant');
  });
});

// ── JWT: tenantId in access token ─────────────────────────────────────────────
describe('JWT — tenantId claim', () => {
  test('register: access token contains tenantId', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'JWT User', email: 'jwttest@example.com', password: 'Test@1234', role: 'guest' });

    expect(res.status).toBe(201);
    const decoded = jwt.decode(res.body.token);
    expect(decoded.tenantId).toBe('castreach');
  });

  test('login: access token contains tenantId', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Login JWT', email: 'loginjwt@example.com', password: 'Test@1234', role: 'guest' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'loginjwt@example.com', password: 'Test@1234' });

    expect(res.status).toBe(200);
    const decoded = jwt.decode(res.body.token);
    expect(decoded.tenantId).toBe('castreach');
  });

  test('refresh: rotated access token still contains tenantId', async () => {
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Refresh JWT', email: 'refreshjwt@example.com', password: 'Test@1234', role: 'guest' });

    const cookies = regRes.headers['set-cookie'];
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', cookies);

    expect(res.status).toBe(200);
    const decoded = jwt.decode(res.body.token);
    expect(decoded.tenantId).toBe('castreach');
  });
});

// ── verifyToken: tenant context established ────────────────────────────────────
describe('verifyToken — tenant context', () => {
  test('GET /api/stitcher/tenant — 200 with castreach for admin', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/tenant')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.tenantId).toBe('castreach');
    expect(res.body.isInContext).toBe(true);
    expect(res.body.defaultTenant).toBe('castreach');
  });

  test('GET /api/stitcher/tenant — 401 without token', async () => {
    const res = await request(app).get('/api/stitcher/tenant');
    expect(res.status).toBe(401);
  });

  test('GET /api/stitcher/tenant — 403 for non-admin', async () => {
    const { token } = await makeUser({ role: 'guest' });
    const res = await request(app)
      .get('/api/stitcher/tenant')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

// ── Stitcher integration ──────────────────────────────────────────────────────
describe('stitcher.tenant', () => {
  test('stitcher.tenant is TenantContext', () => {
    expect(stitcher.tenant).toBe(TenantContext);
  });

  test('healthCheck reports tenantLayer: active', () => {
    const hc = stitcher.healthCheck();
    expect(hc.components.tenantLayer).toBe('active');
  });

  test('health endpoint shows tenantLayer: active', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.components.tenantLayer).toBe('active');
  });
});

// ── Analytics + Tenant context ────────────────────────────────────────────────
describe('Analytics — tenantId from TenantContext', () => {
  test('analytics events carry tenantId from the active context', async () => {
    const { token } = await makeUser({ role: 'guest' });

    // makeUser triggers USER_REGISTERED inside the test infrastructure.
    // That event is tracked with TenantContext.getTenantId().
    // Since the request runs through verifyToken → TenantContext.run('castreach'),
    // the analytics event should carry 'castreach'.
    await settle();

    const doc = await AnalyticsEvent.findOne({ event: 'user.registered' });
    expect(doc).not.toBeNull();
    expect(doc.tenantId).toBe('castreach');
  });

  test('analytics.track() outside request context uses castreach default', async () => {
    const engine = require('../stitcher/analytics/AnalyticsEngine');
    const eng = new engine();
    eng.track('test.event', { id: '1' }); // no TenantContext.run() wrapping
    await settle();

    const doc = await AnalyticsEvent.findOne({ event: 'test.event' });
    expect(doc.tenantId).toBe('castreach');
  });
});

// ── Migration 004 ─────────────────────────────────────────────────────────────
describe('Migration 004 — backfill_user_tenant_id', () => {
  const migration = require('../stitcher/migration/migrations/004_backfill_user_tenant_id');
  const mongoose  = require('mongoose');

  test('up() sets tenantId on users where field is absent', async () => {
    const conn = mongoose.connection;
    await conn.db.collection('users').insertOne({
      name:     'Legacy User',
      email:    'legacy@example.com',
      password: 'hashed',
      role:     'guest',
    });

    await migration.up(conn);

    const doc = await conn.db.collection('users').findOne({ email: 'legacy@example.com' });
    expect(doc.tenantId).toBe('castreach');
  });

  test('up() does not overwrite existing tenantId values', async () => {
    const conn = mongoose.connection;
    await conn.db.collection('users').insertOne({
      name:     'Existing Tenant User',
      email:    'existing@example.com',
      password: 'hashed',
      role:     'guest',
      tenantId: 'other_tenant',
    });

    await migration.up(conn);

    const doc = await conn.db.collection('users').findOne({ email: 'existing@example.com' });
    expect(doc.tenantId).toBe('other_tenant');
  });

  test('down() removes tenantId where value is castreach', async () => {
    const conn = mongoose.connection;
    await conn.db.collection('users').insertOne({
      name:     'Down User',
      email:    'down@example.com',
      password: 'hashed',
      role:     'guest',
      tenantId: 'castreach',
    });

    await migration.down(conn);

    const doc = await conn.db.collection('users').findOne({ email: 'down@example.com' });
    expect(doc.tenantId).toBeUndefined();
  });
});
