/**
 * Migration 001 — Add text search index to the users collection.
 *
 * up:   Create a text index on { name, email } so case-insensitive name/email
 *       search (via $text) works without a collection scan.
 * down: Drop the same index.
 *
 * Safe to run on a live collection — createIndex is non-blocking in MongoDB 4+.
 */

module.exports = {
  name:        '001_add_user_search_index',
  description: 'Text index on users { name, email } for full-text search.',

  async up(conn) {
    // Atlas M0 Free Tier allows 3 text indexes per cluster across all databases.
    // Count existing text indexes to avoid exceeding the limit.
    const existingIndexes = await conn.db.collection('users').indexes();
    const hasTextIndex = existingIndexes.some((idx) => idx.name === 'users_text_search');
    if (hasTextIndex) return; // already applied — idempotent

    const textIndexCount = existingIndexes.filter((idx) =>
      Object.values(idx.key || {}).includes('text')
    ).length;

    if (textIndexCount >= 3) {
      throw new Error(
        'Atlas M0 text index limit (3) reached on users collection. ' +
        'Drop an existing text index before running this migration.'
      );
    }

    await conn.db.collection('users').createIndex(
      { name: 'text', email: 'text' },
      { name: 'users_text_search', background: true }
    );
  },

  async down(conn) {
    await conn.db.collection('users').dropIndex('users_text_search');
  },
};
