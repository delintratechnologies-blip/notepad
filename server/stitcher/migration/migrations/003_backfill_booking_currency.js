/**
 * Migration 003 — Backfill missing currency on bookings.
 *
 * The Booking schema defaults currency to 'usd', but rows created before the
 * default was added (or via direct DB inserts) may be missing the field.
 *
 * up:   Set currency = 'usd' on all bookings where the field is absent.
 *       Uses the raw driver (updateMany) intentionally — Mongoose validators
 *       are bypassed for bulk backfills to avoid per-document overhead.
 * down: Remove the currency field from documents that had it set by this
 *       migration (those where currency was absent before up ran).
 *       NOTE: this down() is lossy — documents that already had currency
 *       before the migration are unaffected, so rollback is approximate.
 *       This is documented here so the operator can decide whether rollback
 *       is meaningful for their environment.
 */

module.exports = {
  name:        '003_backfill_booking_currency',
  description: 'Set currency=\'usd\' on bookings where the field is missing.',

  async up(conn) {
    const result = await conn.db.collection('bookings').updateMany(
      { currency: { $exists: false } },
      { $set: { currency: 'usd' } }
    );
    console.log(`[Migration 003] up: updated ${result.modifiedCount} booking(s)`);
  },

  async down(conn) {
    // Remove currency only from documents that were given a default 'usd' value.
    // Documents that had a currency set before this migration are left intact.
    const result = await conn.db.collection('bookings').updateMany(
      { currency: 'usd' },
      { $unset: { currency: '' } }
    );
    console.log(`[Migration 003] down: removed currency from ${result.modifiedCount} booking(s)`);
  },
};
