/**
 * DataStitcher — singleton orchestration layer between route handlers and MongoDB.
 *
 * Architecture:
 *   Route handler → DataStitcher → Mongoose Model → MongoDB Atlas
 *
 * The Stitcher does NOT replace Mongoose. It wraps it with:
 *   - A Collection Registry (named model access)
 *   - A Schema Registry    (field metadata + sensitive field tracking)
 *   - A Relationship Registry (cross-collection join declarations)
 *   - (Step 3) Audit Logger
 *   - (Step 4) Event Bus
 *   - (Step 5) Unified Query Interface
 *   - (Step 7) Migration Engine
 *   - (Step 8) Analytics Layer
 *   - (Step 9) Tenant Context
 *   - (Step 10) AI Context Layer
 *
 * Usage:
 *   const stitcher = require('./stitcher');
 *   stitcher.initialize();            // called once in app.js
 *   stitcher.healthCheck();           // returns registry summary
 *   stitcher.collections.get('users') // { model, meta }
 *   stitcher.schema.getSensitiveFields('bookings')
 *   stitcher.relationships.forCollection('messages')
 */

const CollectionRegistry   = require('./registry/CollectionRegistry');
const SchemaRegistry       = require('./registry/SchemaRegistry');
const RelationshipRegistry = require('./registry/RelationshipRegistry');
const AuditLogger          = require('./audit/AuditLogger');
const EventBus             = require('./events/EventBus');
const EVENTS               = require('./events/EVENTS');
const QueryBuilder         = require('./query/QueryBuilder');
const { elapsed }          = require('./utils');

class DataStitcher {
  constructor() {
    this.collections   = new CollectionRegistry();
    this.schema        = new SchemaRegistry();
    this.relationships = new RelationshipRegistry();

    // Future components — attached as the build progresses.
    this.audit     = null;  // Step 3
    this.events    = null;  // Step 4
    this.query     = null;  // Step 5
    this.migration = null;  // Step 7
    this.analytics = null;  // Step 8
    this.tenant    = null;  // Step 9
    this.ai        = null;  // Step 10

    this._ready     = false;
    this._startedAt = null;
    this._initMs    = null;
  }

  /**
   * Populate registries from stitcher.config.js.
   * Idempotent — safe to call multiple times (noop after first call).
   * Must be called before any route handler runs.
   */
  initialize() {
    if (this._ready) return this;

    const startMs = Date.now();

    // Lazy-require config so model files are only loaded at init time,
    // not at the time this module is first required.
    const configure = require('./config/stitcher.config');
    configure(this.collections, this.schema, this.relationships);

    // Cross-validate: all relationship endpoints must be registered collections.
    this.relationships.validateAgainst(this.collections);

    // Step 3 — AuditLogger (needs SchemaRegistry to know sensitive fields).
    this.audit = new AuditLogger(this.schema);

    // Step 9 — Tenant Layer (before EventBus so subscribers can call getTenantId()).
    const TenantContext = require('./tenant/TenantContext');
    this.tenant = TenantContext;

    // Step 8 — Analytics Engine (must be before EventBus so subscribers receive it).
    const AnalyticsEngine = require('./analytics');
    this.analytics = new AnalyticsEngine();

    // Step 4 — EventBus + default subscribers.
    this.events = new EventBus();
    const registerDefaultSubscribers = require('./events/subscribers');
    registerDefaultSubscribers(this.events, process.env.NODE_ENV, this.analytics);

    // Step 10 — AI Context Layer.
    const AIContextLayer = require('./ai');
    this.ai = new AIContextLayer();

    // Step 7 — Migration Engine.
    const { MigrationEngine, migrations } = require('./migration');
    this.migration = new MigrationEngine(migrations);

    // Step 5 — Unified Query factory.
    // stitcher.query('collectionName') → new QueryBuilder scoped to that collection.
    // Tracks call count for health reporting.
    this._queryCalls = 0;
    const self = this;
    this.query = function stitcherQuery(collectionName) {
      self._queryCalls++;
      const { model } = self.collections.get(collectionName); // throws for unknown names
      return new QueryBuilder(collectionName, model, self.relationships);
    };

    this._ready     = true;
    this._startedAt = new Date();
    this._initMs    = Date.now() - startMs;

    console.log(
      `[Stitcher] Ready — ` +
      `${this.collections.names().length} collections, ` +
      `${this.relationships.count()} relationships — ` +
      `initialized in ${this._initMs}ms`
    );

    return this;
  }

  /**
   * Returns a summary safe to expose in the admin health endpoint.
   * Contains structure metadata only — no document values, no raw schemas.
   */
  healthCheck() {
    if (!this._ready) {
      return { status: 'not_initialized', message: 'Call stitcher.initialize() first' };
    }

    const collections = this.collections.all().map(({ name, meta }) => {
      const fields          = this.schema.get(name) || {};
      const sensitiveFields = this.schema.getSensitiveFields(name);

      return {
        name,
        version:        meta.version,
        description:    meta.description,
        owner:          meta.owner,
        tags:           meta.tags,
        fieldCount:     Object.keys(fields).length,
        sensitiveFields,
        piiFields:      meta.piiFields,
      };
    });

    const relationships = this.relationships.all().map((r) =>
      `${r.from}.${r.field} → ${r.to} as '${r.as}' (${r.type})`
    );

    return {
      status:      'ok',
      startedAt:   this._startedAt,
      initMs:      this._initMs,
      tenant:      this.tenant ? this.tenant.getTenantId() : 'castreach',
      components: {
        collections:   'active',
        schema:        'active',
        relationships: 'active',
        audit:         'active',
        events:        'active',
        query:         'active',
        migration:     'active',
        analytics:     'active',
        tenantLayer:   'active',             // Step 9 done
        ai:            'active',             // Step 10 done
      },
      collections,
      relationships,
      eventBus:   this.events.stats(),
      queryCalls:      this._queryCalls,
      migrationCount:  this.migration?.totalCount ?? 0,
      analyticsStats:  this.analytics?.stats()  ?? null,
      aiStats:         this.ai?.stats()          ?? null,
      totals: {
        collections:   this.collections.names().length,
        relationships: this.relationships.count(),
        eventTypes:    Object.keys(EVENTS).length,
      },
    };
  }
}

// Process-level singleton — all route handlers share this instance.
const stitcher = new DataStitcher();

// Expose EVENTS as a top-level property so route handlers need only one import:
//   const stitcher = require('../stitcher');
//   stitcher.events.emit(stitcher.EVENTS.BOOKING_CREATED, payload);
stitcher.EVENTS = EVENTS;

module.exports = stitcher;
