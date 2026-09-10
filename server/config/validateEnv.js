const { z } = require('zod');

/**
 * Environment configuration is split into two tiers:
 *
 *   BOOT-CRITICAL   — the API cannot serve ANY request without these. Missing →
 *                     validateEnv() throws and the process refuses to start.
 *
 *   FEATURE-SCOPED  — only needed when a specific integration is exercised.
 *                     Missing → the server still boots; the owning feature's
 *                     routes return 503 (see requireFeatureEnv). Everything
 *                     unrelated (/api/health, /api/auth/*, bookings, …) works.
 *
 * MONGODB_URI is boot-critical in every environment except NODE_ENV=test, where
 * the suite spins up an in-memory replica set instead of using a real URI.
 */
const bootSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),

    MONGODB_URI: z.string().min(1).optional(),

    // Authentication is core — no degraded mode.
    JWT_SECRET: z.string().min(1),
    JWT_REFRESH_SECRET: z.string().min(1),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    CLIENT_URL: z.string().url(),
    PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(1500),

    // ── Feature-scoped: optional here, enforced per-route by requireFeatureEnv ──
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    DAILY_API_KEY: z.string().optional(),
    DAILY_WEBHOOK_SECRET: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    SUPABASE_URL: z.union([z.string().url(), z.literal('')]).optional(),
    SUPABASE_SERVICE_KEY: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== 'test' && !data.MONGODB_URI) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MONGODB_URI'],
        message: 'Required',
      });
    }
  });

// Feature → the env vars it needs. Used both to warn at boot and to 503 per-route.
const FEATURES = {
  stripe:        { label: 'Stripe payments',             vars: ['STRIPE_SECRET_KEY'] },
  stripeWebhook: { label: 'Stripe webhook verification', vars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
  daily:         { label: 'Daily.co recording rooms',    vars: ['DAILY_API_KEY'] },
  anthropic:     { label: 'Anthropic AI assistance',     vars: ['ANTHROPIC_API_KEY'] },
};

function missingFeatureVars(feature, env = process.env) {
  const f = FEATURES[feature];
  if (!f) throw new Error(`Unknown feature: ${feature}`);
  return f.vars.filter((v) => !env[v]);
}

/**
 * Call at the top of a feature route/handler. Throws a 503-tagged error listing
 * exactly what to set if the integration isn't configured — never silently
 * degrades and never bypasses signature verification.
 */
function requireFeatureEnv(feature) {
  const missing = missingFeatureVars(feature);
  if (missing.length) {
    const err = new Error(
      `${FEATURES[feature].label} is not configured on this server (set ${missing.join(', ')}).`
    );
    err.status = 503;
    err.code = 'FEATURE_NOT_CONFIGURED';
    throw err;
  }
}

/**
 * Validate process.env for boot. Throws a single human-readable error listing
 * every missing/invalid BOOT-CRITICAL variable. Feature-scoped gaps only log a
 * warning so the server still starts.
 */
function validateEnv(env = process.env) {
  const result = bootSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Environment validation failed — these are required for the server to boot:\n${details}\n\n` +
        `See server/.env.example.`
    );
  }

  const disabled = Object.keys(FEATURES)
    .map((key) => ({ key, missing: missingFeatureVars(key, result.data) }))
    .filter((f) => f.missing.length);

  if (disabled.length && result.data.NODE_ENV !== 'test') {
    console.warn(
      '[env] Server booting OK. Disabled until configured:\n' +
        disabled
          .map((f) => `  - ${FEATURES[f.key].label} (missing ${f.missing.join(', ')})`)
          .join('\n')
    );
  }

  return result.data;
}

module.exports = { validateEnv, requireFeatureEnv, missingFeatureVars, FEATURES, bootSchema };
