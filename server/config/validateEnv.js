const { z } = require('zod');

// Mirrors server/.env.example. MONGODB_URI is exempt in NODE_ENV=test because
// the test suite connects to an in-memory replica set instead of a real URI.
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),

    MONGODB_URI: z.string().min(1).optional(),

    JWT_SECRET: z.string().min(1, 'JWT_SECRET is required'),
    JWT_REFRESH_SECRET: z.string().min(1, 'JWT_REFRESH_SECRET is required'),
    JWT_EXPIRES_IN: z.string().default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),

    CLIENT_URL: z.string().url('CLIENT_URL must be a valid URL'),

    STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
    STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET is required'),
    PLATFORM_FEE_BPS: z.coerce.number().int().min(0).max(10000).default(1500),

    DAILY_API_KEY: z.string().min(1, 'DAILY_API_KEY is required'),
    // Optional per .env.example — only needed to verify Daily webhook signatures.
    DAILY_WEBHOOK_SECRET: z.string().optional(),

    ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),

    // Optional per .env.example — file uploads fall back to local storage without it.
    SUPABASE_URL: z.union([z.string().url(), z.literal('')]).optional(),
    SUPABASE_SERVICE_KEY: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.NODE_ENV !== 'test' && !data.MONGODB_URI) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['MONGODB_URI'],
        message: 'MONGODB_URI is required',
      });
    }
  });

/**
 * Validates process.env against the schema above and throws a single,
 * human-readable error listing every missing/invalid variable if it fails.
 * Called at the top of app.js so misconfiguration fails fast on startup
 * instead of surfacing later as an opaque 500.
 */
function validateEnv(env = process.env) {
  const result = envSchema.safeParse(env);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Environment validation failed. Fix the following and restart:\n${details}\n\n` +
        `See server/.env.example for the full list of required variables.`
    );
  }

  return result.data;
}

module.exports = { validateEnv, envSchema };
