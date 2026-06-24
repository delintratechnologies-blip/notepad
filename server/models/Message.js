const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    booking:   { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    sender:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
    content:   { type: String, required: true, maxlength: 2000 },
    isRead:    { type: Boolean, default: false },
    attachmentUrl: { type: String },
  },
  { timestamps: true }
);

messageSchema.index({ booking: 1, createdAt: 1 });

module.exports = mongoose.model('Message', messageSchema);
