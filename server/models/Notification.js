const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: {
      type: String,
      enum: ['booking_request', 'booking_confirmed', 'booking_cancelled',
             'message', 'review', 'badge', 'profile_view', 'match'],
      required: true,
    },
    title:   { type: String, required: true },
    body:    { type: String },
    link:    { type: String },          // relative URL e.g. /bookings/123
    isRead:  { type: Boolean, default: false },
    meta:    { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, isRead: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
