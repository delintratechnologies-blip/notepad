const mongoose = require('mongoose');

const migrationHistorySchema = new mongoose.Schema(
  {
    name:       { type: String, required: true, unique: true },
    durationMs: { type: Number, default: null },
    appliedBy:  { type: String, default: 'system' },
    notes:      { type: String, default: null },
  },
  { timestamps: true }
);

migrationHistorySchema.index({ createdAt: -1 });

module.exports = mongoose.model('MigrationHistory', migrationHistorySchema);
