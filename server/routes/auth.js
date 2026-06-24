const router = require('express').Router();
const jwt    = require('jsonwebtoken');
const User   = require('../models/User');
const { validate, RegisterSchema, LoginSchema } = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const verifyToken = require('../middleware/verifyToken');
const stitcher    = require('../stitcher');

const signAccess = (id, role, tenantId = 'castreach') =>
  jwt.sign({ id, role, tenantId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '15m',
  });
const signRefresh  = (id) => jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });

const COOKIE_OPTS = {
  httpOnly: true,
  secure:   process.env.NODE_ENV === 'production',
  sameSite: 'strict',
  maxAge:   7 * 24 * 60 * 60 * 1000,  // 7 days
};

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', authLimiter, validate(RegisterSchema), async (req, res) => {
  try {
    const { email, password, name, role } = req.body;
    if (await User.findOne({ email })) {
      return res.status(409).json({ error: 'Email already in use' });
    }
    const user = await User.create({ email, password, name, role });
    const access  = signAccess(user._id, user.role, user.tenantId);
    const refresh = signRefresh(user._id);
    user.refreshToken = refresh;
    await user.save();

    stitcher.audit.logReq(req, {
      collectionName: 'users',
      documentId:     user._id,
      action:         'create',
      actor:          user._id,
      actorRole:      user.role,
      after: { role: user.role, isOnboarded: false, isBlocked: false },
    });

    stitcher.events.emit(stitcher.EVENTS.USER_REGISTERED, {
      userId: user._id.toString(),
      role:   user.role,
    });

    res.cookie('refreshToken', refresh, COOKIE_OPTS);
    res.status(201).json({ token: access, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', authLimiter, validate(LoginSchema), async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email }).select('+password');
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    if (user.isBlocked) return res.status(403).json({ error: 'Account suspended' });

    const access  = signAccess(user._id, user.role, user.tenantId);
    const refresh = signRefresh(user._id);
    user.refreshToken = refresh;
    await user.save();
    res.cookie('refreshToken', refresh, COOKIE_OPTS);
    res.json({ token: access, user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const token = req.cookies?.refreshToken;
  if (!token) return res.status(401).json({ error: 'No refresh token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id).select('+refreshToken');
    if (!user || user.refreshToken !== token) {
      return res.status(403).json({ error: 'Token reuse detected' });
    }
    const newAccess  = signAccess(user._id, user.role, user.tenantId);
    const newRefresh = signRefresh(user._id);
    user.refreshToken = newRefresh;
    await user.save();
    res.cookie('refreshToken', newRefresh, COOKIE_OPTS);
    res.json({ token: newAccess });
  } catch {
    res.status(403).json({ error: 'Invalid refresh token' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', verifyToken, async (req, res) => {
  await User.findByIdAndUpdate(req.user.id, { refreshToken: '' });
  res.clearCookie('refreshToken');
  res.json({ message: 'Logged out' });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', verifyToken, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;
