const router       = require('express').Router();
const User         = require('../models/User');
const Report       = require('../models/Report');
const verifyToken  = require('../middleware/verifyToken');
const requireAdmin = require('../middleware/requireAdmin');
const { validate, ReportSchema } = require('../middleware/validate');
const stitcher     = require('../stitcher');

// ── POST /api/moderation/report — report a user ───────────────────────────────
// BUG-5: persist to the Report collection (was console.log() only — data lost on restart).
router.post('/report', verifyToken, validate(ReportSchema), async (req, res) => {
  try {
    const { reportedId, reason } = req.body;

    const reported = await User.findById(reportedId);
    if (!reported) return res.status(404).json({ error: 'User not found' });
    if (reportedId === req.user.id) return res.status(400).json({ error: 'Cannot report yourself' });

    const report = await Report.create({
      reporter: req.user.id,
      reported: reportedId,
      reason,
    });

    stitcher.audit.logReq(req, {
      collectionName: 'reports',
      documentId:     report._id,
      action:         'create',
      actor:          req.user.id,
      actorRole:      req.user.role,
      after: { reporter: req.user.id, reported: reportedId, status: 'open' },
    });

    stitcher.events.emit(stitcher.EVENTS.REPORT_FILED, {
      reportId:   report._id.toString(),
      reporterId: req.user.id,
      reportedId,
    });

    res.json({ message: 'Report received. Our team will review it.', reportId: report._id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/moderation/reports — admin: list reports by status ───────────────
router.get('/reports', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { status = 'open' } = req.query;
    const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = {};
    if (status !== 'all') filter.status = status;

    const [reports, total] = await Promise.all([
      Report.find(filter)
        .populate('reporter', 'name')
        .populate('reported', 'name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit),
      Report.countDocuments(filter),
    ]);

    res.json({ reports, pagination: { total, page, limit, pages: Math.ceil(total / limit) } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/moderation/block/:userId — admin block ─────────────────────────
router.post('/block/:userId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { isBlocked: true },
      { new: true }
    ).select('-email -password -refreshToken -stripeAccountId');  // SEC-5: no PII in response
    if (!user) return res.status(404).json({ error: 'User not found' });

    stitcher.audit.logReq(req, {
      collectionName: 'users',
      documentId:     user._id,
      action:         'update',
      actor:          req.user.id,
      actorRole:      req.user.role,
      before: { isBlocked: false },
      after:  { isBlocked: true },
    });

    stitcher.events.emit(stitcher.EVENTS.USER_BLOCKED, {
      userId:  user._id.toString(),
      actorId: req.user.id,
    });

    res.json({ message: 'User blocked', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/moderation/unblock/:userId — admin unblock ─────────────────────
router.post('/unblock/:userId', verifyToken, requireAdmin, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.userId,
      { isBlocked: false },
      { new: true }
    ).select('-email -password -refreshToken -stripeAccountId');  // SEC-5: no PII in response
    if (!user) return res.status(404).json({ error: 'User not found' });

    stitcher.audit.logReq(req, {
      collectionName: 'users',
      documentId:     user._id,
      action:         'update',
      actor:          req.user.id,
      actorRole:      req.user.role,
      before: { isBlocked: true },
      after:  { isBlocked: false },
    });

    stitcher.events.emit(stitcher.EVENTS.USER_UNBLOCKED, {
      userId:  user._id.toString(),
      actorId: req.user.id,
    });

    res.json({ message: 'User unblocked', user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
