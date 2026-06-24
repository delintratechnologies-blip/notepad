const rateLimit = require('express-rate-limit');

// Disable rate limiting in the test environment so the suite isn't throttled.
const skip = () => process.env.NODE_ENV === 'test';

/** Global limiter — 100 requests per 15 minutes */
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: 'Too many requests, please try again later.' },
});

/** Strict auth limiter — 10 attempts per 15 minutes */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip,
  message: { error: 'Too many login attempts, please try again later.' },
});

module.exports = { globalLimiter, authLimiter };
