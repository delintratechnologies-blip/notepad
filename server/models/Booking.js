const mongoose = require('mongoose');

const bookingSchema = new mongoose.Schema(
  {
    host:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    guest:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    slotStart: { type: Date, required: true },
    slotEnd:   { type: Date, required: true },
    topics:    [{ type: String }],
    message:   { type: String, maxlength: 500 },
    status: {
      type: String,
      enum: ['pending', 'confirmed', 'cancelled', 'completed', 'disputed'],
      default: 'pending',
    },
    // Stripe escrow
    stripePaymentIntentId: { type: String, select: false },
    amountCents:           { type: Number, default: 0 },    // amount in cents
    currency:              { type: String, default: 'usd' },
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'held', 'released', 'refunded'],
      default: 'unpaid',
    },
    // Recording
    dailyRoomUrl:   { type: String },
    recordingUrl:   { type: String },
    recordingReady: { type: Boolean, default: false },
    // BUG-4: timestamp set when host first responds (confirm or cancel).
    // Used to compute avgResponseTime and responseRate on User.
    respondedAt: { type: Date },
    // Review
    hostReview:  {
      rating:  { type: Number, min: 1, max: 5 },
      comment: { type: String, maxlength: 500 },
    },
    guestReview: {
      rating:  { type: Number, min: 1, max: 5 },
      comment: { type: String, maxlength: 500 },
    },
  },
  { timestamps: true }
);

// Overlap detection indexes
bookingSchema.index({ host: 1, slotStart: 1, slotEnd: 1 });
bookingSchema.index({ guest: 1, slotStart: 1 });

// BUG-7: unique partial index prevents two active bookings for the same host
// starting at the identical time, even under concurrent writes. The transaction
// in routes/bookings.js catches overlapping ranges; this catches exact-same-slot
// races that snapshot isolation alone cannot prevent.
bookingSchema.index(
  { host: 1, slotStart: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ['pending', 'confirmed'] } },
    name: 'unique_active_slot_per_host',
  }
);

module.exports = mongoose.model('Booking', bookingSchema);
