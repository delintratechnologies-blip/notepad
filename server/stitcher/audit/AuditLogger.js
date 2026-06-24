/**
 * AuditLogger — non-blocking, PII-safe audit trail writer.
 *
 * Design rules enforced here:
 *   1. Non-blocking — log() is fire-and-forget. Audit failures never propagate
 *      to the caller. Errors are console.error'd for ops visibility.
 *   2. PII redaction — sensitive fields (select:false + declared sensitiveFields)
 *      are stripped from before/after snapshots before writing. Uses the
 *      SchemaRegistry populated in Step 2 as the single field-metadata source.
 *   3. Diff — a shallow before/after diff is computed and stored for fast
 *      "what changed" queries without re-reading the document.
 *   4. Append-only — AuditLogger never updates or deletes audit records.
 *
 * Usage:
 *   stitcher.audit.log({
 *     collectionName, documentId, action,
 *     actor, actorRole,
 *     before, after,       // plain objects — not Mongoose docs
 *     ip, userAgent,
 *     tenantId,            // optional, defaults to 'castreach'
 *   });
 *   // No await needed — fire and forget.
 */

const AuditLog   = require('../../models/AuditLog');
const { omitKeys, shallowDiff } = require('../utils');

class AuditLogger {
  /**
   * @param {SchemaRegistry} schemaRegistry - Populated registry from Step 2.
   */
  constructor(schemaRegistry) {
    this._schema = schemaRegistry;
  }

  /**
   * Record an action. Returns `this` for chaining. Never throws.
   *
   * @param {object} opts
   * @param {string}    opts.collectionName - e.g. 'bookings'
   * @param {*}         opts.documentId     - ObjectId of the affected document
   * @param {string}    opts.action         - 'create' | 'update' | 'delete'
   * @param {*}         [opts.actor]        - User ID who performed the action
   * @param {string}    [opts.actorRole]    - Role at time of action
   * @param {object}    [opts.before]       - Document state before (plain object)
   * @param {object}    [opts.after]        - Document state after (plain object)
   * @param {string}    [opts.ip]           - req.ip
   * @param {string}    [opts.userAgent]    - req.get('user-agent')
   * @param {string}    [opts.tenantId]     - Defaults to 'castreach'
   */
  log({
    collectionName,
    documentId,
    action,
    actor      = null,
    actorRole  = null,
    before     = null,
    after      = null,
    ip         = null,
    userAgent  = null,
    tenantId   = 'castreach',
  }) {
    const sensitive = this._schema.getSensitiveFields(collectionName);

    const safeBefore = before ? omitKeys(before, sensitive) : null;
    const safeAfter  = after  ? omitKeys(after,  sensitive) : null;
    const diff       = safeBefore && safeAfter ? shallowDiff(safeBefore, safeAfter) : null;

    AuditLog.create({
      collectionName,
      documentId,
      action,
      actor,
      actorRole,
      before:    safeBefore,
      after:     safeAfter,
      diff,
      ip,
      userAgent,
      tenantId,
    }).catch((err) => {
      console.error(`[AuditLogger] Write failed (${collectionName}/${action}):`, err.message);
    });

    return this;
  }

  /**
   * Convenience wrapper — sugar for common route handler pattern.
   * Extracts ip + userAgent from an Express req object.
   *
   * @param {Request} req   - Express request (for ip + user-agent)
   * @param {object}  opts  - Same as log() but without ip/userAgent
   */
  logReq(req, opts) {
    return this.log({
      ...opts,
      ip:        req.ip,
      userAgent: req.get('user-agent'),
    });
  }
}

module.exports = AuditLogger;
