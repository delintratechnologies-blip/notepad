const { validateEnv, requireFeatureEnv, missingFeatureVars } = require('../config/validateEnv');

// A complete boot-critical environment; each test tweaks a copy.
const BOOT_OK = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb://localhost/x',
  JWT_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  CLIENT_URL: 'https://app.example.com',
};

describe('validateEnv — boot-critical tier', () => {
  test('passes with boot vars present and ALL feature vars absent', () => {
    const data = validateEnv({ ...BOOT_OK });
    expect(data.JWT_SECRET).toBe(BOOT_OK.JWT_SECRET);
    expect(data.STRIPE_SECRET_KEY).toBeUndefined();
    expect(data.ANTHROPIC_API_KEY).toBeUndefined();
  });

  test.each(['JWT_SECRET', 'JWT_REFRESH_SECRET', 'CLIENT_URL'])(
    'throws when boot-critical %s is missing',
    (key) => {
      const env = { ...BOOT_OK };
      delete env[key];
      expect(() => validateEnv(env)).toThrow(new RegExp(key));
    }
  );

  test('throws when MONGODB_URI is missing outside test env', () => {
    const env = { ...BOOT_OK };
    delete env.MONGODB_URI;
    expect(() => validateEnv(env)).toThrow(/MONGODB_URI/);
  });

  test('MONGODB_URI is not required when NODE_ENV=test', () => {
    const env = { ...BOOT_OK, NODE_ENV: 'test' };
    delete env.MONGODB_URI;
    expect(() => validateEnv(env)).not.toThrow();
  });

  test('feature vars missing never blocks boot', () => {
    expect(() => validateEnv({ ...BOOT_OK })).not.toThrow();
  });
});

describe('requireFeatureEnv — feature tier', () => {
  const KEYS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'DAILY_API_KEY', 'ANTHROPIC_API_KEY'];
  let saved;
  beforeEach(() => { saved = {}; KEYS.forEach((k) => { saved[k] = process.env[k]; }); });
  afterEach(() => {
    KEYS.forEach((k) => {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    });
  });

  test('no-ops when the feature is configured', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(() => requireFeatureEnv('stripe')).not.toThrow();
  });

  test('throws a 503-tagged error naming the missing var', () => {
    delete process.env.STRIPE_SECRET_KEY;
    try {
      requireFeatureEnv('stripe');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err.status).toBe(503);
      expect(err.code).toBe('FEATURE_NOT_CONFIGURED');
      expect(err.message).toMatch(/STRIPE_SECRET_KEY/);
    }
  });

  test('stripeWebhook needs BOTH the key and the webhook secret', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(missingFeatureVars('stripeWebhook')).toEqual(['STRIPE_WEBHOOK_SECRET']);
    expect(() => requireFeatureEnv('stripeWebhook')).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });
});
