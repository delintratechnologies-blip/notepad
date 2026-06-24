/**
 * requireAdmin — middleware that verifies the requesting user is an active admin.
 *
 * Unlike a pure JWT claim check, this re-reads the user record from the database
 * so a demoted or blocked admin loses access immediately rather than after their
 * 15-minute access token expires.
 *
 * Must be chained AFTER verifyToken (which attaches req.user).
 */
const User = require('../models/User');

module.exports = async (req, res, next) => {
  try {
    const actor = await User.findById(req.user.id).select('role isBlocked');
    if (!actor || actor.isBlocked || actor.role !== 'admin') {
      return res.status(403).json({ error: 'Admin only' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
