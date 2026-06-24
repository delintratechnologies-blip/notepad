const mongoose = require('mongoose');

const availabilitySchema = new mongoose.Schema(
  {
    user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    start: { type: Date, required: true },
    end:   { type: Date, required: true },
    isBooked: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Index for fast overlap queries
availabilitySchema.index({ user: 1, start: 1, end: 1 });

module.exports = mongoose.model('Availability', availabilitySchema);
