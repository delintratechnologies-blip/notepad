const mongoose = require('mongoose');

// BUG-5: persist moderation reports (previously console.log only).
const reportSchema = new mongoose.Schema(
  {
    reporter:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reported:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reason:     { type: String, required: true, maxlength: 1000 },
    status: {
      type:    String,
      enum:    ['open', 'reviewed', 'resolved', 'dismissed'],
      default: 'open',
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    adminNotes: { type: String, maxlength: 2000 },
  },
  { timestamps: true }
);

reportSchema.index({ reported: 1, status: 1 });
reportSchema.index({ reporter: 1 });
reportSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Report', reportSchema);
