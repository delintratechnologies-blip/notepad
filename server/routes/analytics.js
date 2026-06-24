const router      = require('express').Router();
const Booking     = require('../models/Booking');
const User        = require('../models/User');
const verifyToken = require('../middleware/verifyToken');

// ── GET /api/analytics/me — personal insights ────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const now    = new Date();
    const month  = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalBookings, completedBookings, thisMonthBookings, user] = await Promise.all([
      Booking.countDocuments({ $or: [{ host: userId }, { guest: userId }] }),
      Booking.countDocuments({ $or: [{ host: userId }, { guest: userId }], status: 'completed' }),
      Booking.countDocuments({ $or: [{ host: userId }, { guest: userId }], createdAt: { $gte: month } }),
      User.findById(userId),
    ]);

    // Topic frequency from completed bookings
    const completedDocs = await Booking.find({
      $or: [{ host: userId }, { guest: userId }],
      status: 'completed',
    }).select('topics');

    const topicCount = {};
    completedDocs.forEach(({ topics }) =>
      topics?.forEach((t) => { topicCount[t] = (topicCount[t] || 0) + 1; })
    );
    const topTopics = Object.entries(topicCount)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([topic, count]) => ({ topic, count }));

    // Monthly booking trend (last 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyTrend = await Booking.aggregate([
      {
        $match: {
          $or: [{ host: userId }, { guest: userId }],
          createdAt: { $gte: sixMonthsAgo },
        },
      },
      {
        $group: {
          _id:   { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    res.json({
      totalBookings,
      completedBookings,
      thisMonthBookings,
      avgRating:    user.avgRating,
      totalReviews: user.totalReviews,
      responseRate: user.responseRate,
      badges:       user.badges,
      topTopics,
      monthlyTrend,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
