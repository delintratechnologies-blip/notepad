/**
 * Migration 004 — Backfill tenantId on existing User documents.
 *
 * Step 9 added a tenantId field to the User model (default: 'castreach').
 * Mongoose returns the default for documents that don't have the field stored,
 * but the field is absent from the raw documents. This migration writes it
 * explicitly so queries against { tenantId: 'castreach' } hit the index.
 *
 * up:   Set tenantId = 'castreach' on all users where the field is absent.
 * down: Unset tenantId on all users (only those set by this migration — see NOTE).
 *
 * NOTE: down() is lossy for any users whose tenantId was legitimately set by
 * another process before this migration ran. Down is intended only for dev rollback.
 */

module.exports = {
  name:        '004_backfill_user_tenant_id',
  description: 'Write tenantId: "castreach" to existing users that predate Step 9.',

  async up(conn) {
    await conn.db
      .collection('users')
      .updateMany({ tenantId: { $exists: false } }, { $set: { tenantId: 'castreach' } });
  },

  async down(conn) {
    await conn.db
      .collection('users')
      .updateMany({ tenantId: 'castreach' }, { $unset: { tenantId: '' } });
  },
};
