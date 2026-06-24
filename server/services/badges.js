const User    = require('../models/User');
const Booking = require('../models/Booking');
const Message = require('../models/Message');

const BADGE_RULES = [
  {
    id:    'top_rated',
    label: 'Top Rated',
    check: async (userId, user) =>
      user.avgRating >= 4.8 && user.totalReviews >= 10,
  },
  {
    id:    'fast_responder',
    label: 'Fast Responder',
    check: async (userId, user) =>
      user.avgResponseTime > 0 && user.avgResponseTime <= 120,  // ≤2 hours
  },
  {
    id:    'most_booked',
    label: 'Most Booked',
    check: async (userId) => {
      const month = new Date();
      month.setDate(1);
      month.setHours(0, 0, 0, 0);
      const count = await Booking.countDocuments({
        $or:       [{ host: userId }, { guest: userId }],
        status:    'completed',
        updatedAt: { $gte: month },
      });
      return count >= 5;
    },
  },
  {
    id:    'verified_host',
    label: 'Verified Host',
    check: async (userId, user) =>
      user.role === 'host' && !!user.stripeAccountId && user.totalReviews >= 5,
  },
];

/**
 * Re-evaluate and update badge list for a user.
 * Call after: a review is submitted, booking completes, or on a nightly cron.
 */
async function triggerBadgeCheck(userId) {
  const user = await User.findById(userId).select('+stripeAccountId');
  if (!user) return;

  const earned = [];
  for (const rule of BADGE_RULES) {
    try {
      if (await rule.check(userId, user)) earned.push(rule.id);
    } catch (e) {
      console.error(`Badge check error for ${rule.id}:`, e.message);
    }
  }

  if (JSON.stringify(earned.sort()) !== JSON.stringify((user.badges || []).sort())) {
    user.badges = earned;
    await user.save();
    console.log(`Badges updated for ${userId}:`, earned);
  }

  return earned;
}

module.exports = { triggerBadgeCheck, BADGE_RULES };
