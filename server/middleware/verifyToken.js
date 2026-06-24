const jwt           = require('jsonwebtoken');
const TenantContext = require('../stitcher/tenant/TenantContext');

/**
 * Verifies the Bearer JWT from the Authorization header.
 * On success:
 *   - Attaches decoded payload to req.user
 *   - Runs the remainder of the request inside a TenantContext so any
 *     downstream code (analytics, audit, AI) can call getTenantId() without
 *     needing the tenantId passed as an argument.
 */
module.exports = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    TenantContext.run(req.user.tenantId || 'castreach', next);
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
};
