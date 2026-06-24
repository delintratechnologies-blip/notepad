const { request, app, makeUser, makeAdmin, makeHost } = require('./helpers');
const AuditLog   = require('../models/AuditLog');
const AuditLogger = require('../stitcher/audit/AuditLogger');
const SchemaRegistry = require('../stitcher/registry/SchemaRegistry');
const User       = require('../models/User');
const stitcher   = require('../stitcher');

// Helper — wait briefly for fire-and-forget audit writes to settle.
const settle = () => new Promise((r) => setTimeout(r, 80));

// ── Unit: AuditLogger ─────────────────────────────────────────────────────────
describe('AuditLogger (unit)', () => {
  test('redacts select:false fields from after snapshot', async () => {
    const sr = new SchemaRegistry();
    sr.introspect('users', User, ['password', 'refreshToken', 'stripeAccountId']);

    const logger = new AuditLogger(sr);
    logger.log({
      collectionName: 'users',
      documentId:     '507f1f77bcf86cd799439011',
      action:         'create',
      after: {
        name:       'Alice',
        email:      'alice@example.com',
        password:   'should-be-redacted',
        refreshToken: 'also-redacted',
        role:       'guest',
      },
    });

    await settle();

    const record = await AuditLog.findOne({ collectionName: 'users' }).sort({ createdAt: -1 });
    expect(record).not.toBeNull();
    expect(record.after).not.toHaveProperty('password');
    expect(record.after).not.toHaveProperty('refreshToken');
    expect(record.after.role).toBe('guest');
  });

  test('redacts declared sensitiveFields from before/after', async () => {
    const sr = new SchemaRegistry();
    const Booking = require('../models/Booking');
    sr.introspect('bookings', Booking, ['stripePaymentIntentId']);

    const logger = new AuditLogger(sr);
    logger.log({
      collectionName: 'bookings',
      documentId:     '507f1f77bcf86cd799439022',
      action:         'update',
      before: { status: 'pending', stripePaymentIntentId: 'pi_secret' },
      after:  { status: 'confirmed', stripePaymentIntentId: 'pi_secret' },
    });

    await settle();

    const record = await AuditLog.findOne({
      collectionName: 'bookings',
      'after.status': 'confirmed',
    }).sort({ createdAt: -1 });

    expect(record).not.toBeNull();
    expect(record.before).not.toHaveProperty('stripePaymentIntentId');
    expect(record.after).not.toHaveProperty('stripePaymentIntentId');
  });

  test('computes diff between before and after', async () => {
    const sr = new SchemaRegistry();
    sr.introspect('users', User, []);

    const logger = new AuditLogger(sr);
    logger.log({
      collectionName: 'users',
      documentId:     '507f1f77bcf86cd799439033',
      action:         'update',
      before: { isBlocked: false, role: 'guest' },
      after:  { isBlocked: true,  role: 'guest' },
    });

    await settle();

    const record = await AuditLog.findOne({
      collectionName: 'users',
      'after.isBlocked': true,
    }).sort({ createdAt: -1 });

    expect(record).not.toBeNull();
    expect(record.diff).toHaveProperty('isBlocked');
    expect(record.diff.isBlocked.before).toBe(false);
    expect(record.diff.isBlocked.after).toBe(true);
    expect(record.diff).not.toHaveProperty('role'); // unchanged — not in diff
  });

  test('before=null on create — diff is null', async () => {
    const sr = new SchemaRegistry();
    sr.introspect('users', User, []);

    const logger = new AuditLogger(sr);
    logger.log({
      collectionName: 'users',
      documentId:     '507f1f77bcf86cd799439044',
      action:         'create',
      before:         null,
      after:          { role: 'host' },
    });

    await settle();

    const record = await AuditLog.findOne({
      collectionName: 'users',
      'after.role':   'host',
    }).sort({ createdAt: -1 });

    expect(record).not.toBeNull();
    expect(record.before).toBeNull();
    expect(record.diff).toBeNull();
  });

  test('never throws when model write fails — fire and forget', () => {
    const sr = new SchemaRegistry();
    sr.introspect('users', User, []);
    const logger = new AuditLogger(sr);

    // Should not throw even if documentId is invalid type.
    expect(() =>
      logger.log({
        collectionName: 'users',
        documentId:     'not-an-oid',
        action:         'create',
        after:          { role: 'guest' },
      })
    ).not.toThrow();
  });

  test('stores actor, actorRole, tenantId', async () => {
    const sr = new SchemaRegistry();
    sr.introspect('reports', require('../models/Report'), []);

    const actorId = '507f1f77bcf86cd799439055';
    const logger  = new AuditLogger(sr);

    logger.log({
      collectionName: 'reports',
      documentId:     '507f1f77bcf86cd799439066',
      action:         'create',
      actor:          actorId,
      actorRole:      'guest',
      tenantId:       'castreach',
      after:          { status: 'open' },
    });

    await settle();

    const record = await AuditLog.findOne({
      collectionName: 'reports',
      'after.status': 'open',
    }).sort({ createdAt: -1 });

    expect(record).not.toBeNull();
    expect(record.actor.toString()).toBe(actorId);
    expect(record.actorRole).toBe('guest');
    expect(record.tenantId).toBe('castreach');
  });
});

// ── Integration: audit records created by routes ──────────────────────────────
describe('Audit trail — route integration', () => {
  test('user registration creates an audit record', async () => {
    const countBefore = await AuditLog.countDocuments({ collectionName: 'users', action: 'create' });

    await makeUser({ role: 'guest', name: 'AuditTestUser' });
    await settle();

    const countAfter = await AuditLog.countDocuments({ collectionName: 'users', action: 'create' });
    expect(countAfter).toBeGreaterThan(countBefore);
  });

  test('registration audit record contains role, not password', async () => {
    await makeUser({ role: 'host', name: 'AuditHostUser' });
    await settle();

    const record = await AuditLog.findOne({
      collectionName:  'users',
      action:          'create',
      'after.role':    'host',
    }).sort({ createdAt: -1 });

    expect(record).not.toBeNull();
    expect(record.after.role).toBe('host');
    expect(record.after).not.toHaveProperty('password');
    expect(record.after).not.toHaveProperty('refreshToken');
  });

  test('blocking a user creates an audit record for the users collection', async () => {
    const { user: targetUser } = await makeUser({ role: 'guest' });
    const { token }            = await makeAdmin();

    await request(app)
      .post(`/api/moderation/block/${targetUser._id}`)
      .set('Authorization', `Bearer ${token}`);

    await settle();

    const record = await AuditLog.findOne({
      collectionName:    'users',
      action:            'update',
      'after.isBlocked': true,
    }).sort({ createdAt: -1 });

    expect(record).not.toBeNull();
    expect(record.diff).toHaveProperty('isBlocked');
    expect(record.diff.isBlocked.before).toBe(false);
    expect(record.diff.isBlocked.after).toBe(true);
  });

  test('unblocking creates audit record showing isBlocked false', async () => {
    const { user: targetUser } = await makeUser({ role: 'guest' });
    const { token }            = await makeAdmin();

    // Block first
    await request(app)
      .post(`/api/moderation/block/${targetUser._id}`)
      .set('Authorization', `Bearer ${token}`);
    // Then unblock
    await request(app)
      .post(`/api/moderation/unblock/${targetUser._id}`)
      .set('Authorization', `Bearer ${token}`);

    await settle();

    const record = await AuditLog.findOne({
      collectionName:    'users',
      action:            'update',
      'after.isBlocked': false,
      'before.isBlocked': true,
    }).sort({ createdAt: -1 });

    expect(record).not.toBeNull();
  });

  test('filing a report creates an audit record in reports collection', async () => {
    const reporter     = await makeUser({ role: 'guest' });
    const { user: reportedUser } = await makeUser({ role: 'host' });

    await request(app)
      .post('/api/moderation/report')
      .set('Authorization', `Bearer ${reporter.token}`)
      .send({ reportedId: reportedUser._id, reason: 'Spam and harassment content in bio' });

    await settle();

    const record = await AuditLog.findOne({
      collectionName: 'reports',
      action:         'create',
    }).sort({ createdAt: -1 });

    expect(record).not.toBeNull();
    expect(record.after.status).toBe('open');
    expect(record.after.reported.toString()).toBe(reportedUser._id.toString());
  });

  test('stitcher.audit is active after initialization', () => {
    expect(stitcher.audit).not.toBeNull();
    expect(typeof stitcher.audit.log).toBe('function');
    expect(typeof stitcher.audit.logReq).toBe('function');
  });

  test('health endpoint shows audit as active', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.components.audit).toBe('active');
  });

  test('auditlogs collection is registered in stitcher', () => {
    expect(stitcher.collections.has('auditlogs')).toBe(true);
    const { meta } = stitcher.collections.get('auditlogs');
    expect(meta.owner).toBe('stitcher');
    expect(meta.tags).toContain('compliance');
  });
});
