/**
 * TenantContext — AsyncLocalStorage wrapper for per-request tenant isolation.
 *
 * Every authenticated request runs inside TenantContext.run(tenantId, next).
 * Any code downstream (models, analytics, audit) can call getTenantId()
 * without the tenantId being passed as a parameter.
 *
 * Default: 'castreach' — returned when called outside a tenant context
 * (background jobs, tests that don't go through HTTP, startup code).
 */
const { AsyncLocalStorage } = require('node:async_hooks');

const _store = new AsyncLocalStorage();

const DEFAULT_TENANT = 'castreach';

const TenantContext = {
  /**
   * Run `fn` inside a tenant context.
   * All async work spawned from `fn` inherits this context.
   * @param {string}   tenantId
   * @param {Function} fn       - typically Express `next`
   */
  run(tenantId, fn) {
    return _store.run({ tenantId: tenantId || DEFAULT_TENANT }, fn);
  },

  /**
   * Return the current tenant ID.
   * Falls back to DEFAULT_TENANT when called outside a run() context.
   * @returns {string}
   */
  getTenantId() {
    return (_store.getStore() || {}).tenantId || DEFAULT_TENANT;
  },

  /**
   * Return true when called from inside a run() context.
   * Useful for assertions and observability.
   * @returns {boolean}
   */
  isInContext() {
    return !!_store.getStore();
  },

  /** Expose default for use in tests and fallback logic. */
  DEFAULT_TENANT,
};

module.exports = TenantContext;
