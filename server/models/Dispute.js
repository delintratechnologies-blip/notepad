const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema(
  {
    booking: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'Booking',
      required: true,
    },
    raisedBy: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    againstUser: {
      type:     mongoose.Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },
    reason: {
      type:     String,
      enum:     ['no_show', 'technical_issue', 'content_violation', 'payment_issue', 'other'],
      required: true,
    },
    description: {
      type:      String,
      required:  true,
      minlength: 20,
      maxlength: 1000,
    },
    status: {
      type:    String,
      enum:    ['open', 'under_review', 'resolved', 'dismissed'],
      default: 'open',
    },
    resolution: {
      type:      String,
      maxlength: 1000,
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref:  'User',
    },
    resolvedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// One active dispute per booking (prevents duplicate filing).
disputeSchema.index({ booking: 1 }, { unique: true });

disputeSchema.index({ raisedBy: 1, createdAt: -1 });
disputeSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('Dispute', disputeSchema);
