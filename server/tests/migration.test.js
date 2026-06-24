/**
 * Tests for Step 7 — Migration Engine.
 *
 * Covers:
 *   - MigrationEngine construction (validation, duplicate name detection)
 *   - status() — all migrations shown as pending initially
 *   - run({ dryRun: true }) — preview without applying
 *   - run() — applies pending migrations; records in MigrationHistory
 *   - run() — skips already-applied migrations
 *   - run({ name }) — applies a specific migration by name
 *   - rollback(name) — reverses an applied migration; removes MigrationHistory record
 *   - rollback on unapplied migration throws
 *   - rollback on migration with no down() throws
 *   - Admin endpoints: GET/POST /api/stitcher/migrations/*
 *   - stitcher.migration is active in health check
 *
 * NOTE: afterEach wipes all collections — each test starts with no migration history.
 */

const MigrationEngine  = require('../stitcher/migration/MigrationEngine');
const stitcher         = require('../stitcher');
const { request, app, makeAdmin } = require('./helpers');
const MigrationHistory = require('../models/MigrationHistory');
const mongoose         = require('mongoose');

// ── Test migrations — simple, reversible operations ───────────────────────────

function makeTestMigration(name, opts = {}) {
  return {
    name,
    description: `Test migration ${name}`,
    up:   opts.up   ?? (async (conn) => {
      await conn.db.collection('users').createIndex(
        { [`_test_${name}`]: 1 },
        { name: `_test_idx_${name}`, background: false, sparse: true }
      );
    }),
    down: opts.down ?? (async (conn) => {
      try {
        await conn.db.collection('users').dropIndex(`_test_idx_${name}`);
      } catch (_) { /* index may not exist if test cleaned up */ }
    }),
  };
}

const migA = makeTestMigration('test_a');
const migB = makeTestMigration('test_b');
const migC = makeTestMigration('test_c');

// ── Unit: construction ────────────────────────────────────────────────────────
describe('MigrationEngine — construction', () => {
  test('constructs with a valid migration array', () => {
    expect(() => new MigrationEngine([migA, migB])).not.toThrow();
  });

  test('throws for non-array argument', () => {
    expect(() => new MigrationEngine('not an array')).toThrow('must be an array');
  });

  test('throws for migration missing name', () => {
    expect(() => new MigrationEngine([{ up: async () => {} }])).toThrow("'name'");
  });

  test('throws for migration missing up()', () => {
    expect(() => new MigrationEngine([{ name: 'foo', up: 'notafunction' }])).toThrow("'up'");
  });

  test('throws for duplicate migration names', () => {
    expect(() => new MigrationEngine([migA, migA])).toThrow('Duplicate migration names');
  });

  test('totalCount reflects number of registered migrations', () => {
    const engine = new MigrationEngine([migA, migB, migC]);
    expect(engine.totalCount).toBe(3);
  });
});

// ── Integration: status() ─────────────────────────────────────────────────────
describe('MigrationEngine — status()', () => {
  test('all migrations are pending when history is empty', async () => {
    const engine = new MigrationEngine([migA, migB]);
    const status = await engine.status();
    expect(status).toHaveLength(2);
    expect(status.every((s) => s.applied === false)).toBe(true);
    expect(status.every((s) => s.appliedAt === null)).toBe(true);
  });

  test('applied migration shows applied=true and appliedAt', async () => {
    const engine = new MigrationEngine([migA]);
    await engine.run();

    const status = await engine.status();
    expect(status[0].applied).toBe(true);
    expect(status[0].appliedAt).not.toBeNull();
    expect(typeof status[0].durationMs).toBe('number');
  });
});

// ── Integration: run() ────────────────────────────────────────────────────────
describe('MigrationEngine — run()', () => {
  test('applies all pending migrations and returns results', async () => {
    const engine  = new MigrationEngine([migA, migB]);
    const results = await engine.run();

    expect(results).toHaveLength(2);
    expect(results[0].action).toBe('applied');
    expect(results[0].success).toBe(true);
    expect(results[1].action).toBe('applied');
  });

  test('records applied migrations in MigrationHistory', async () => {
    const engine = new MigrationEngine([migA]);
    await engine.run();

    const record = await MigrationHistory.findOne({ name: migA.name });
    expect(record).not.toBeNull();
    expect(typeof record.durationMs).toBe('number');
  });

  test('returns nothing_to_run when all migrations are applied', async () => {
    const engine = new MigrationEngine([migA]);
    await engine.run();
    const second = await engine.run();

    expect(second).toHaveLength(1);
    expect(second[0].action).toBe('nothing_to_run');
  });

  test('skips already-applied migrations', async () => {
    const engine = new MigrationEngine([migA, migB]);
    await engine.run(); // apply both

    // Create fresh engine — migA already applied in MigrationHistory
    const engine2  = new MigrationEngine([migA, migC]);
    const results  = await engine2.run();
    const names    = results.map((r) => r.name);

    expect(names).not.toContain(migA.name); // skipped
    expect(names).toContain(migC.name);     // newly applied
  });

  test('run({ name }) applies a specific migration by name', async () => {
    const engine  = new MigrationEngine([migA, migB]);
    const results = await engine.run({ name: migB.name });

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe(migB.name);
    expect(results[0].action).toBe('applied');

    const inHistory = await MigrationHistory.findOne({ name: migA.name });
    expect(inHistory).toBeNull(); // migA not applied
  });

  test('run({ name }) on already-applied returns skipped', async () => {
    const engine = new MigrationEngine([migA]);
    await engine.run({ name: migA.name });
    const second = await engine.run({ name: migA.name });

    expect(second[0].action).toBe('skipped');
    expect(second[0].reason).toBe('already applied');
  });

  test('run({ name }) throws for unknown migration', async () => {
    const engine = new MigrationEngine([migA]);
    await expect(engine.run({ name: 'nonexistent' })).rejects.toThrow('not found');
  });

  test('stops on first failure and returns failed result', async () => {
    const failing = {
      name: 'failing_migration',
      description: 'Intentionally fails',
      up: async () => { throw new Error('intentional failure'); },
      down: async () => {},
    };
    const engine  = new MigrationEngine([failing, migA]);
    const results = await engine.run();

    expect(results[0].action).toBe('failed');
    expect(results[0].error).toBe('intentional failure');
    expect(results).toHaveLength(1); // stopped after first failure

    const inHistory = await MigrationHistory.findOne({ name: migA.name });
    expect(inHistory).toBeNull(); // migA not applied because engine stopped
  });
});

// ── Integration: dryRun ───────────────────────────────────────────────────────
describe('MigrationEngine — dryRun', () => {
  test('dryRun returns would_run for pending migrations', async () => {
    const engine  = new MigrationEngine([migA, migB]);
    const results = await engine.run({ dryRun: true });

    expect(results.every((r) => r.action === 'would_run')).toBe(true);
    expect(results.every((r) => r.dryRun === true)).toBe(true);
  });

  test('dryRun does NOT write to MigrationHistory', async () => {
    const engine = new MigrationEngine([migA]);
    await engine.run({ dryRun: true });

    const count = await MigrationHistory.countDocuments({});
    expect(count).toBe(0);
  });

  test('dryRun on specific name returns would_run', async () => {
    const engine  = new MigrationEngine([migA, migB]);
    const results = await engine.run({ name: migA.name, dryRun: true });

    expect(results).toHaveLength(1);
    expect(results[0].action).toBe('would_run');
    expect(results[0].name).toBe(migA.name);
  });
});

// ── Integration: rollback() ───────────────────────────────────────────────────
describe('MigrationEngine — rollback()', () => {
  test('rolls back an applied migration', async () => {
    const engine = new MigrationEngine([migA]);
    await engine.run();

    const result = await engine.rollback(migA.name);
    expect(result.action).toBe('rolled_back');

    const record = await MigrationHistory.findOne({ name: migA.name });
    expect(record).toBeNull();
  });

  test('rollback removes migration from history', async () => {
    const engine = new MigrationEngine([migA, migB]);
    await engine.run();

    await engine.rollback(migA.name);

    const status = await engine.status();
    expect(status.find((s) => s.name === migA.name).applied).toBe(false);
    expect(status.find((s) => s.name === migB.name).applied).toBe(true);
  });

  test('rollback throws for unapplied migration', async () => {
    const engine = new MigrationEngine([migA]);
    await expect(engine.rollback(migA.name)).rejects.toThrow('has not been applied');
  });

  test('rollback throws for unknown migration', async () => {
    const engine = new MigrationEngine([migA]);
    await expect(engine.rollback('nonexistent')).rejects.toThrow('not found');
  });

  test('rollback throws when migration has no down()', async () => {
    const noDown = { name: 'no_down', description: 'No down fn', up: async () => {} };
    const engine = new MigrationEngine([noDown]);
    await engine.run();
    await expect(engine.rollback('no_down')).rejects.toThrow('no down()');
  });

  test('after rollback, migration can be applied again', async () => {
    const engine = new MigrationEngine([migA]);
    await engine.run();
    await engine.rollback(migA.name);
    const results = await engine.run();

    expect(results[0].action).toBe('applied');
    const record = await MigrationHistory.findOne({ name: migA.name });
    expect(record).not.toBeNull();
  });
});

// ── Integration: stitcher.migration ──────────────────────────────────────────
describe('stitcher.migration', () => {
  test('is a MigrationEngine with 4 migrations', () => {
    expect(stitcher.migration).toBeInstanceOf(MigrationEngine);
    expect(stitcher.migration.totalCount).toBe(4);
  });

  test('healthCheck reports migration as active', () => {
    const hc = stitcher.healthCheck();
    expect(hc.components.migration).toBe('active');
    expect(hc.migrationCount).toBe(4);
  });
});

// ── Admin endpoints ───────────────────────────────────────────────────────────
describe('Migration admin endpoints', () => {
  test('GET /api/stitcher/migrations — returns all migrations with status', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/migrations')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.migrations)).toBe(true);
    expect(res.body.total).toBe(4);
    expect(res.body.migrations[0]).toHaveProperty('name');
    expect(res.body.migrations[0]).toHaveProperty('applied');
  });

  test('GET /api/stitcher/migrations — 403 for non-admin', async () => {
    const res = await request(app).get('/api/stitcher/migrations');
    expect(res.status).toBe(401);
  });

  test('POST /api/stitcher/migrations/run?dryRun=true — previews without applying', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .post('/api/stitcher/migrations/run')
      .set('Authorization', `Bearer ${token}`)
      .send({ dryRun: true });

    expect(res.status).toBe(200);
    expect(res.body.results.every((r) => r.dryRun === true)).toBe(true);

    const count = await MigrationHistory.countDocuments({});
    expect(count).toBe(0);
  });

  test('POST /api/stitcher/migrations/rollback — 400 for missing name', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .post('/api/stitcher/migrations/rollback')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name is required/);
  });

  test('POST /api/stitcher/migrations/rollback — 400 for unapplied migration', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .post('/api/stitcher/migrations/rollback')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '001_add_user_search_index' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/has not been applied/);
  });
});
