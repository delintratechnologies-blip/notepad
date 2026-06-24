/**
 * Migration 002 — Compound index on bookings { status, slotStart }.
 *
 * up:   Create compound index so queries filtering by status and sorting by
 *       slotStart (e.g. "confirmed bookings this week") are index-backed.
 * down: Drop the same index.
 *
 * The index name is explicit to make rollback safe regardless of MongoDB
 * version-specific auto-naming conventions.
 */

module.exports = {
  name:        '002_add_booking_status_date_index',
  description: 'Compound index on bookings { status: 1, slotStart: 1 } for efficient status + date queries.',

  async up(conn) {
    await conn.db.collection('bookings').createIndex(
      { status: 1, slotStart: 1 },
      { name: 'bookings_status_slotStart', background: true }
    );
  },

  async down(conn) {
    await conn.db.collection('bookings').dropIndex('bookings_status_slotStart');
  },
};
