/**
 * MigrationEngine — version-tracked, dry-run-capable schema/data migration runner.
 *
 * Design constraints:
 *   - Migrations are declared explicitly — no filesystem glob. Order is determined
 *     by position in the array passed to the constructor.
 *   - MigrationHistory is the sole source of truth for which migrations are applied.
 *   - The engine does NOT run migrations automatically at startup. Call run() explicitly.
 *   - dryRun mode logs what would happen with zero DB side-effects (no MigrationHistory write).
 *   - Stopping on first failure prevents partial state in dependent migrations.
 *
 * Migration shape:
 *   {
 *     name:        string  — unique slug, kebab-case (e.g. '001_add_user_search_index')
 *     description: string  — human-readable summary
 *     up(conn):    async function(mongoose.connection) — apply migration
 *     down(conn):  async function(mongoose.connection) — revert migration (optional)
 *   }
 *
 * Usage:
 *   const engine = new MigrationEngine([migration001, migration002, ...]);
 *   await engine.run({ dryRun: true });             // preview pending
 *   await engine.run();                              // apply all pending
 *   await engine.run({ name: '001_add_user_search_index' }); // run one
 *   await engine.rollback('001_add_user_search_index');       // undo one
 *   const status = await engine.status();           // list all with applied state
 */

const mongoose         = require('mongoose');
const MigrationHistory = require('../../models/MigrationHistory');

class MigrationEngine {
  /**
   * @param {Array<{name, description, up, down}>} migrations - ordered list
   */
  constructor(migrations = []) {
    if (!Array.isArray(migrations)) {
      throw new TypeError('[MigrationEngine] migrations must be an array');
    }
    for (const m of migrations) {
      if (!m.name || typeof m.up !== 'function') {
        throw new TypeError(
          `[MigrationEngine] Each migration must have 'name' (string) and 'up' (function). ` +
          `Got: ${JSON.stringify({ name: m.name, up: typeof m.up })}`
        );
      }
    }
    // Detect duplicate names at construction time.
    const names = migrations.map((m) => m.name);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    if (dupes.length > 0) {
      throw new Error(`[MigrationEngine] Duplicate migration names: ${dupes.join(', ')}`);
    }

    this._migrations = migrations;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Total number of registered migrations. */
  get totalCount() {
    return this._migrations.length;
  }

  /**
   * Returns the status of every migration — applied or pending.
   * @returns {Promise<Array<{name, description, applied, appliedAt, durationMs}>>}
   */
  async status() {
    const records  = await MigrationHistory.find({}).sort({ createdAt: 1 });
    const applied  = new Map(records.map((r) => [r.name, r]));

    return this._migrations.map((m) => ({
      name:        m.name,
      description: m.description || '',
      applied:     applied.has(m.name),
      appliedAt:   applied.get(m.name)?.createdAt ?? null,
      durationMs:  applied.get(m.name)?.durationMs ?? null,
    }));
  }

  /**
   * Run pending migrations.
   *
   * @param {object}  [opts]
   * @param {boolean} [opts.dryRun=false] — preview only, no writes
   * @param {string}  [opts.name]         — run a specific migration by name only
   * @returns {Promise<Array<RunResult>>}
   */
  async run(opts = {}) {
    const { dryRun = false, name = null } = opts;

    let targets;

    if (name) {
      const m = this._migrations.find((m) => m.name === name);
      if (!m) throw new Error(`[MigrationEngine] Migration not found: '${name}'`);

      if (!dryRun) {
        const exists = await MigrationHistory.exists({ name });
        if (exists) {
          return [{ name, action: 'skipped', reason: 'already applied' }];
        }
      }
      targets = [m];
    } else {
      const records      = await MigrationHistory.find({}).select('name');
      const appliedNames = new Set(records.map((r) => r.name));
      targets = this._migrations.filter((m) => !appliedNames.has(m.name));
    }

    if (targets.length === 0) {
      return [{ action: 'nothing_to_run', pendingCount: 0 }];
    }

    const results = [];

    for (const migration of targets) {
      if (dryRun) {
        results.push({
          name:        migration.name,
          description: migration.description || '',
          action:      'would_run',
          dryRun:      true,
        });
        continue;
      }

      const startMs = Date.now();
      try {
        await migration.up(mongoose.connection);
        const durationMs = Date.now() - startMs;
        await MigrationHistory.create({ name: migration.name, durationMs });
        results.push({
          name:        migration.name,
          action:      'applied',
          durationMs,
          success:     true,
        });
      } catch (err) {
        results.push({
          name:    migration.name,
          action:  'failed',
          error:   err.message,
          success: false,
        });
        break; // stop on first failure — partial state in chained migrations is dangerous
      }
    }

    return results;
  }

  /**
   * Roll back a specific migration by name.
   * Requires the migration to have a `down()` function.
   *
   * @param {string} name — migration name
   * @returns {Promise<{name, action, durationMs}>}
   */
  async rollback(name) {
    const migration = this._migrations.find((m) => m.name === name);
    if (!migration) throw new Error(`[MigrationEngine] Migration not found: '${name}'`);
    if (typeof migration.down !== 'function') {
      throw new Error(
        `[MigrationEngine] Migration '${name}' has no down() function — cannot roll back`
      );
    }

    const record = await MigrationHistory.findOne({ name });
    if (!record) {
      throw new Error(`[MigrationEngine] Migration '${name}' has not been applied`);
    }

    const startMs = Date.now();
    await migration.down(mongoose.connection);
    const durationMs = Date.now() - startMs;
    await MigrationHistory.deleteOne({ name });

    return { name, action: 'rolled_back', durationMs };
  }
}

module.exports = MigrationEngine;
