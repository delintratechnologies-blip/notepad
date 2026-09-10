const { validateEnv } = require('./config/validateEnv');
validateEnv();

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { globalLimiter }  = require('./middleware/rateLimit');
const tenantMiddleware   = require('./middleware/tenantMiddleware');
const stitcher = require('./stitcher');

/**
 * Builds the Express app (middleware + routes + error handler) WITHOUT
 * connecting to MongoDB or calling listen(). Imported by index.js for the real
 * server and by the test suite (which manages its own in-memory database).
 */

// Initialize the Stitcher registries before any route handler runs.
// Idempotent — safe to call here even when app.js is required by tests.
stitcher.initialize();

const app = express();

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet());
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.CLIENT_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body / cookie parsing ─────────────────────────────────────────────────────
// Webhook routes need the untouched raw body for signature verification and
// attach their own express.raw() parser below — skip JSON parsing for them, or
// it consumes the stream first and express.raw() becomes a no-op.
app.use((req, res, next) => {
  if (req.path === '/api/webhooks' || req.path.startsWith('/api/webhooks/')) return next();
  return express.json({ limit: '10kb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ── Request logging ───────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
app.use(globalLimiter);

// ── Tenant context — Step 9 ───────────────────────────────────────────────────
// Establishes 'castreach' context for unauthenticated routes.
// verifyToken overrides with the JWT-claim tenantId for authenticated routes.
app.use(tenantMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',         require('./routes/auth'));
app.use('/api/users',        require('./routes/users'));
app.use('/api/bookings',     require('./routes/bookings'));
app.use('/api/messages',     require('./routes/messages'));
app.use('/api/payments',     require('./routes/payments'));
app.use('/api/availability', require('./routes/availability'));
app.use('/api/ai',           require('./routes/ai'));
app.use('/api/moderation',   require('./routes/moderation'));
app.use('/api/disputes',     require('./routes/disputes'));
app.use('/api/reports',      require('./routes/reports'));
app.use('/api/recordings',   require('./routes/recordings'));
app.use('/api/stitcher',     require('./routes/stitcher'));
app.use('/api/analytics',    require('./routes/analytics'));
app.use('/api/notifications',require('./routes/notifications'));

// Webhooks — raw body needed for signature verification. The Daily.co route is
// registered first so its more specific path matches before the Stripe mount.
app.use('/api/webhooks/daily', express.raw({ type: 'application/json' }), require('./routes/webhooksDaily'));
app.use('/api/webhooks',       express.raw({ type: 'application/json' }), require('./routes/webhooks'));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

// ── Global error handler ──────────────────────────────────────────────────────
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[ERROR] ${req.method} ${req.path} → ${status}: ${err.message}`);
  if (status === 500) console.error(err.stack);
  res.status(status).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
});

module.exports = app;
