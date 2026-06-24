const mongoose = require('mongoose');
const User    = require('../models/User');
const Booking = require('../models/Booking');

/**
 * Recompute a user's avgRating + totalReviews from every review they have RECEIVED.
 *
 * Review storage (see routes/bookings.js):
 *   - When the guest reviews the host, it is stored on booking.hostReview.
 *   - When the host reviews the guest, it is stored on booking.guestReview.
 * So a user's received reviews are:
 *   - hostReview  on bookings where they are the host
 *   - guestReview on bookings where they are the guest
 *
 * Call after a review is submitted (BLK-4).
 */
async function recomputeUserRating(userId) {
  const oid = new mongoose.Types.ObjectId(userId);

  const [result] = await Booking.aggregate([
    { $match: { $or: [{ host: oid }, { guest: oid }] } },
    {
      $project: {
        rating: {
          $cond: [
            { $eq: ['$host', oid] },
            '$hostReview.rating',
            '$guestReview.rating',
          ],
        },
      },
    },
    { $match: { rating: { $ne: null } } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);

  const avgRating    = result ? Math.round(result.avg * 100) / 100 : 0;
  const totalReviews = result ? result.count : 0;

  await User.findByIdAndUpdate(userId, { avgRating, totalReviews });

  return { avgRating, totalReviews };
}

/**
 * Recompute responseRate and avgResponseTime for a host (BUG-4).
 *
 * responseRate  = fraction of received booking requests where host responded
 *                 (confirmed or cancelled), expressed as 0–1.
 * avgResponseTime = mean minutes from booking.createdAt to booking.respondedAt,
 *                   across all bookings where the host responded.
 *
 * Call after a host confirms or cancels a booking.
 */
async function recomputeHostResponseMetrics(hostId) {
  const oid = new mongoose.Types.ObjectId(hostId);

  const [totalReceived, [result]] = await Promise.all([
    Booking.countDocuments({ host: oid }),
    Booking.aggregate([
      { $match: { host: oid, respondedAt: { $exists: true, $ne: null } } },
      {
        $project: {
          responseMinutes: {
            $divide: [
              { $subtract: ['$respondedAt', '$createdAt'] },
              60000,
            ],
          },
        },
      },
      {
        $group: {
          _id:          null,
          avg:          { $avg: '$responseMinutes' },
          respondedCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const respondedCount  = result?.respondedCount ?? 0;
  const responseRate    = totalReceived > 0 ? Math.round((respondedCount / totalReceived) * 100) / 100 : 0;
  const avgResponseTime = result ? Math.round(result.avg) : 0;

  await User.findByIdAndUpdate(hostId, { responseRate, avgResponseTime });
  return { responseRate, avgResponseTime };
}

module.exports = { recomputeUserRating, recomputeHostResponseMetrics };
