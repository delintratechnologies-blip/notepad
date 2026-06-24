/**
 * Stitcher admin routes — status and registry inspection.
 * All endpoints require authentication + admin role.
 */
const router       = require('express').Router();
const verifyToken  = require('../middleware/verifyToken');
const requireAdmin = require('../middleware/requireAdmin');
const stitcher     = require('../stitcher');

// GET /api/stitcher/health
router.get('/health', verifyToken, requireAdmin, (_req, res) => {
  res.json(stitcher.healthCheck());
});

// GET /api/stitcher/migrations
// List all migrations with applied status.
router.get('/migrations', verifyToken, requireAdmin, async (_req, res) => {
  try {
    const status = await stitcher.migration.status();
    res.json({ success: true, migrations: status, total: stitcher.migration.totalCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/stitcher/migrations/run
// Run pending migrations. Body: { dryRun?: boolean, name?: string }
// dryRun: true — preview only, no writes.
// name:   run a specific migration by name.
router.post('/migrations/run', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { dryRun = false, name = null } = req.body;
    const results = await stitcher.migration.run({ dryRun, name });
    res.json({ success: true, results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /api/stitcher/migrations/rollback
// Roll back a specific migration. Body: { name: string }
router.post('/migrations/rollback', verifyToken, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await stitcher.migration.rollback(name);
    res.json({ success: true, result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// GET /api/stitcher/tenant
// Returns the active tenant context for this request.
router.get('/tenant', verifyToken, requireAdmin, (req, res) => {
  const tenantId = stitcher.tenant.getTenantId();
  res.json({
    success:      true,
    tenantId,
    isInContext:  stitcher.tenant.isInContext(),
    defaultTenant: stitcher.tenant.DEFAULT_TENANT,
  });
});

// GET /api/stitcher/analytics/dashboard
// Full analytics dashboard — all projections in one call.
router.get('/analytics/dashboard', verifyToken, requireAdmin, async (req, res) => {
  try {
    const months   = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));
    const tenantId = req.query.tenantId || 'castreach';
    const data     = await stitcher.analytics.dashboard(months, tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stitcher/analytics/funnel
router.get('/analytics/funnel', verifyToken, requireAdmin, async (req, res) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));
    const data   = await stitcher.analytics.bookingFunnel(months, req.query.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stitcher/analytics/volume
// ?months=6&events=booking.created,booking.confirmed (comma-separated, optional)
router.get('/analytics/volume', verifyToken, requireAdmin, async (req, res) => {
  try {
    const months     = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));
    const eventNames = req.query.events
      ? req.query.events.split(',').map((e) => e.trim()).filter(Boolean)
      : null;
    const data = await stitcher.analytics.eventVolume(eventNames, months, req.query.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/stitcher/analytics/disputes
router.get('/analytics/disputes', verifyToken, requireAdmin, async (req, res) => {
  try {
    const months = Math.min(24, Math.max(1, parseInt(req.query.months, 10) || 6));
    const data   = await stitcher.analytics.disputeRate(months, req.query.tenantId);
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
