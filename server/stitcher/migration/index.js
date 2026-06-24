// Step 7 — MigrationEngine (active)
const MigrationEngine = require('./MigrationEngine');

const migrations = [
  require('./migrations/001_add_user_search_index'),
  require('./migrations/002_add_booking_status_date_index'),
  require('./migrations/003_backfill_booking_currency'),
  require('./migrations/004_backfill_user_tenant_id'),   // Step 9
];

module.exports = { MigrationEngine, migrations };
