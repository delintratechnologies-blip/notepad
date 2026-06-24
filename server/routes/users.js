const router      = require('express').Router();
const User        = require('../models/User');
const verifyToken = require('../middleware/verifyToken');
const { upload, verifyMimeBytes } = require('../middleware/upload');

// Public projection — never expose email/PII when listing or viewing others (BLK-5).
const PUBLIC_FIELDS = '-__v -email';

// ── GET /api/users?role=host&q=search ─────────────────────────────────────────
router.get('/', verifyToken, async (req, res) => {
  try {
    const { role, q } = req.query;
    const page  = Math.max(1, parseInt(req.query.page, 10)  || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

    const filter = { isBlocked: false };
    if (role) filter.role = role;
    if (q)    filter.$text = { $search: q };

    const users = await User.find(filter)
      .select(PUBLIC_FIELDS)
      .sort({ avgRating: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    res.json({ users });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/users/recommendations — AI-matched candidates ───────────────────
router.get('/recommendations', verifyToken, async (req, res) => {
  try {
    const { getRecommendations } = require('../services/matchmaking');
    const recommendations = await getRecommendations(req.user.id, 5);
    res.json({ recommendations });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/users/:id ────────────────────────────────────────────────────────
router.get('/:id', verifyToken, async (req, res) => {
  try {
    // A user viewing their own profile keeps their email; others get the public view.
    const projection = req.params.id === req.user.id ? '-__v' : PUBLIC_FIELDS;
    const user = await User.findById(req.params.id).select(projection);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/users/me — update own profile ──────────────────────────────────
router.patch('/me', verifyToken, async (req, res) => {
  try {
    const ALLOWED = ['name', 'bio', 'expertise', 'podcastName', 'podcastUrl', 'socialLinks', 'isOnboarded', 'sessionRateCents'];
    const updates = {};
    ALLOWED.forEach((k) => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const user = await User.findByIdAndUpdate(req.user.id, updates, { new: true, runValidators: true });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/users/me/avatar ─────────────────────────────────────────────────
router.post('/me/avatar', verifyToken, upload.single('avatar'), verifyMimeBytes, async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    // In production: upload req.file.buffer to Supabase Storage / S3 and get URL
    // Here we return a placeholder
    const avatarUrl = `https://storage.example.com/avatars/${req.user.id}-${Date.now()}`;
    const user = await User.findByIdAndUpdate(req.user.id, { avatar: avatarUrl }, { new: true });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
