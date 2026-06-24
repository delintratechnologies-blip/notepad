/**
 * AiSession — ephemeral conversation between a user and the AI.
 *
 * One session = one task context (show_prep, match, suggest, etc.).
 * Sessions expire after 24 hours via a TTL index.
 * Messages are stored inline (conversation is short-lived).
 */
const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    role:    { type: String, enum: ['user', 'assistant', 'system'], required: true },
    content: { type: String, required: true, maxlength: 8000 },
  },
  { _id: false, timestamps: { createdAt: 'at', updatedAt: false } }
);

const aiSessionSchema = new mongoose.Schema(
  {
    userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tenantId:  { type: String, default: 'castreach', index: true },
    context:   {
      type:    String,
      enum:    ['suggest', 'match', 'show_prep', 'bio_polish', 'general'],
      default: 'general',
    },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', default: null },
    messages:  { type: [messageSchema], default: [] },
    status:    { type: String, enum: ['active', 'closed'], default: 'active', index: true },
    metadata:  { type: mongoose.Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, default: () => new Date(Date.now() + 24 * 60 * 60 * 1000) },
  },
  { timestamps: true }
);

// TTL — MongoDB auto-deletes sessions 24h after creation.
aiSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Active session lookup by user.
aiSessionSchema.index({ userId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('AiSession', aiSessionSchema);
