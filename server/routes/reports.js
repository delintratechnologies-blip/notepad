/**
 * Admin Reports — platform-level aggregate analytics.
 *
 * All routes require admin authentication (verifyToken + requireAdmin).
 *
 * Endpoints:
 *   GET /api/reports/overview   — platform KPIs (users, bookings, revenue, disputes)
 *   GET /api/reports/bookings   — booking counts by status and month
 *   GET /api/reports/revenue    — revenue breakdown by month
 *   GET /api/reports/disputes   — dispute stats by status and reason
 *
 * Query params common to all:
 *   months  — how many trailing months to include (default 6, max 24)
 */

const router       = require('express').Router();
const Booking      = require('../models/Booking');
const User         = require('../models/User');
const Dispute      = require('../models/Dispute');
const verifyToken  = require('../middleware/verifyToken');
const requireAdmin = require('../middleware/requireAdmin');

function trailingMonthsStart(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - Math.min(24, Math.max(1, parseInt(n, 10) || 6)));
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── GET /api/reports/overview ─────────────────────────────────────────────────
router.get('/overview', verifyToken, requireAdmin, async (req, res) => {
  try {
    const [
      totalUsers,
      totalHosts,
      totalGuests,
      totalBookings,
      completedBookings,
      revenueAgg,
      openDisputes,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ role: 'host' }),
      User.countDocuments({ role: 'guest' }),
      Booking.countDocuments({}),
      Booking.countDocuments({ status: 'completed' }),
      Booking.aggregate([
        { $match: { paymentStatus: 'released' } },
        { $group: { _id: null, totalCents: { $sum: '$amountCents' } } },
      ]),
      Dispute.countDocuments({ status: { $in: ['open', 'under_review'] } }),
    ]);

    res.json({
      success: true,
      data: {
        users: { total: totalUsers, hosts: totalHosts, guests: totalGuests },
        bookings: { total: totalBookings, completed: completedBookings },
        revenueCents: revenueAgg[0]?.totalCents ?? 0,
        openDisputes,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/bookings ─────────────────────────────────────────────────
router.get('/bookings', verifyToken, requireAdmin, async (req, res) => {
  try {
    const since = trailingMonthsStart(req.query.months);

    const [byStatus, byMonth] = await Promise.all([
      Booking.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort:  { count: -1 } },
      ]),
      Booking.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id:   { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ]);

    res.json({ success: true, data: { byStatus, byMonth } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/revenue ──────────────────────────────────────────────────
router.get('/revenue', verifyToken, requireAdmin, async (req, res) => {
  try {
    const since = trailingMonthsStart(req.query.months);

    const [byMonth, topHosts] = await Promise.all([
      Booking.aggregate([
        { $match: { paymentStatus: 'released', createdAt: { $gte: since } } },
        {
          $group: {
            _id:        { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            totalCents: { $sum: '$amountCents' },
            count:      { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
      Booking.aggregate([
        { $match: { paymentStatus: 'released' } },
        { $group: { _id: '$host', totalCents: { $sum: '$amountCents' }, sessions: { $sum: 1 } } },
        { $sort:  { totalCents: -1 } },
        { $limit: 10 },
        {
          $lookup: {
            from:         'users',
            localField:   '_id',
            foreignField: '_id',
            as:           'hostDoc',
          },
        },
        { $unwind: '$hostDoc' },
        {
          $project: {
            _id:        0,
            hostId:     '$_id',
            name:       '$hostDoc.name',
            totalCents: 1,
            sessions:   1,
          },
        },
      ]),
    ]);

    res.json({ success: true, data: { byMonth, topHosts } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/reports/disputes ─────────────────────────────────────────────────
router.get('/disputes', verifyToken, requireAdmin, async (req, res) => {
  try {
    const since = trailingMonthsStart(req.query.months);

    const [byStatus, byReason, byMonth] = await Promise.all([
      Dispute.aggregate([
        { $group: { _id: '$status', count: { $sum: 1 } } },
        { $sort:  { count: -1 } },
      ]),
      Dispute.aggregate([
        { $group: { _id: '$reason', count: { $sum: 1 } } },
        { $sort:  { count: -1 } },
      ]),
      Dispute.aggregate([
        { $match: { createdAt: { $gte: since } } },
        {
          $group: {
            _id:   { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } },
            count: { $sum: 1 },
          },
        },
        { $sort: { '_id.year': 1, '_id.month': 1 } },
      ]),
    ]);

    res.json({ success: true, data: { byStatus, byReason, byMonth } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
