const TenantContext = require('../stitcher/tenant/TenantContext');

/**
 * Global tenant middleware — establishes a default 'castreach' tenant context
 * for every request, including unauthenticated ones (register, login, webhooks).
 *
 * For authenticated routes, verifyToken runs later and overrides the context
 * with the tenantId from the JWT claim. AsyncLocalStorage nesting means the
 * inner context (from verifyToken) takes precedence for the rest of that chain.
 */
module.exports = function tenantMiddleware(req, res, next) {
  TenantContext.run(TenantContext.DEFAULT_TENANT, next);
};
