/**
 * AiMemory — long-term reusable context about a user.
 *
 * Memories persist across sessions and are injected into AI prompts to
 * personalise responses (preferred topics, communication style, past feedback).
 *
 * Keyed by { userId, key } — upsert pattern to avoid duplicates.
 * Optional expiresAt for time-boxed context (null = permanent).
 */
const mongoose = require('mongoose');

const aiMemorySchema = new mongoose.Schema(
  {
    userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    tenantId:   { type: String, default: 'castreach', index: true },
    type:       {
      type:    String,
      enum:    ['preference', 'expertise', 'history', 'feedback', 'context'],
      default: 'context',
    },
    key:        { type: String, required: true, trim: true, maxlength: 100 },
    value:      { type: mongoose.Schema.Types.Mixed, required: true },
    confidence: { type: Number, default: 1.0, min: 0, max: 1 },
    source:     {
      type:    String,
      enum:    ['user_stated', 'inferred', 'system'],
      default: 'user_stated',
    },
    expiresAt:  { type: Date, default: null },
  },
  { timestamps: true }
);

// Each user has at most one memory per key.
aiMemorySchema.index({ userId: 1, key: 1 }, { unique: true });

// Lookup all memories for a user, newest first.
aiMemorySchema.index({ userId: 1, type: 1, updatedAt: -1 });

// TTL — only fires for documents where expiresAt is not null.
aiMemorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

module.exports = mongoose.model('AiMemory', aiMemorySchema);
