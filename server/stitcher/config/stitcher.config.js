/**
 * stitcher.config.js — single source of truth for collection registrations
 * and relationship declarations.
 *
 * Registrations:
 *   - Every Mongoose model used by this product must be registered here.
 *   - The order does not matter; relationships are validated after all registrations.
 *
 * Relationships:
 *   - Declared with 'from', 'field', 'to', 'as', and 'type'.
 *   - Consumed by JoinResolver (Step 5) for named population.
 *   - Do not scatter .populate() strings across route files — declare them here.
 *
 * DO NOT add new MongoDB collections without updating this file.
 */
const User         = require('../../models/User');
const Booking      = require('../../models/Booking');
const Message      = require('../../models/Message');
const Notification = require('../../models/Notification');
const Availability = require('../../models/Availability');
const Report       = require('../../models/Report');
const Dispute          = require('../../models/Dispute');
const MigrationHistory = require('../../models/MigrationHistory');
const AnalyticsEvent   = require('../../models/AnalyticsEvent');
const AuditLog         = require('../../models/AuditLog');
const AiSession        = require('../../models/AiSession');
const AiMemory         = require('../../models/AiMemory');

/**
 * @param {CollectionRegistry}  registry
 * @param {SchemaRegistry}      schema
 * @param {RelationshipRegistry}relationships
 */
module.exports = function configure(registry, schema, relationships) {

  // ── Collection registrations ──────────────────────────────────────────────

  registry.register('users', User, {
    version:         1,
    description:     'Platform users (hosts, guests, admins). Root identity record.',
    owner:           'auth',
    tags:            ['core', 'pii'],
    piiFields:       ['name', 'email'],
    sensitiveFields: ['password', 'refreshToken', 'stripeAccountId'],
  });

  registry.register('bookings', Booking, {
    version:         1,
    description:     'Podcast session bookings with Stripe escrow payment lifecycle.',
    owner:           'bookings',
    tags:            ['core', 'financial'],
    sensitiveFields: ['stripePaymentIntentId'],
  });

  registry.register('messages', Message, {
    version:     1,
    description: 'Per-booking chat messages between host and guest.',
    owner:       'messaging',
    tags:        ['core'],
  });

  registry.register('notifications', Notification, {
    version:     1,
    description: 'In-app notification queue — delivery by polling or future push.',
    owner:       'notifications',
    tags:        ['core'],
  });

  registry.register('availabilities', Availability, {
    version:     1,
    description: 'Host availability time slots. isBooked toggled on booking confirm.',
    owner:       'bookings',
    tags:        ['core'],
  });

  registry.register('reports', Report, {
    version:     1,
    description: 'User-submitted moderation reports — persisted (not console.log).',
    owner:       'moderation',
    tags:        ['admin'],
  });

  registry.register('disputes', Dispute, {
    version:     1,
    description: 'Booking dispute lifecycle — open → under_review → resolved | dismissed.',
    owner:       'disputes',
    tags:        ['admin', 'compliance'],
  });

  registry.register('analyticsevents', AnalyticsEvent, {
    version:     1,
    description: 'Immutable time-series record of every domain event. Append-only.',
    owner:       'stitcher',
    tags:        ['admin', 'analytics'],
  });

  registry.register('migrationhistories', MigrationHistory, {
    version:     1,
    description: 'Tracks which migrations have been applied and when.',
    owner:       'stitcher',
    tags:        ['admin', 'compliance'],
  });

  registry.register('auditlogs', AuditLog, {
    version:     1,
    description: 'Immutable audit trail. Append-only. Sensitive fields pre-redacted by AuditLogger.',
    owner:       'stitcher',
    tags:        ['admin', 'compliance'],
  });

  registry.register('aisessions', AiSession, {
    version:     1,
    description: 'Ephemeral AI conversation sessions. 24h TTL. Keyed by userId + context.',
    owner:       'ai',
    tags:        ['core', 'ai'],
  });

  registry.register('aimemories', AiMemory, {
    version:     1,
    description: 'Long-term user context for AI personalisation. Keyed by userId + key.',
    owner:       'ai',
    tags:        ['core', 'ai', 'pii'],
    piiFields:   ['value'],
  });

  // ── Schema introspection (derived from Mongoose models — no duplication) ──

  for (const { name, model, meta } of registry.all()) {
    schema.introspect(name, model, meta.sensitiveFields);
  }

  // ── Relationship declarations ─────────────────────────────────────────────

  relationships.declare([
    // Booking → User (host)
    { from: 'bookings',      field: 'host',      to: 'users',    as: 'hostUser',       type: 'belongsTo' },
    // Booking → User (guest)
    { from: 'bookings',      field: 'guest',     to: 'users',    as: 'guestUser',      type: 'belongsTo' },
    // Message → Booking
    { from: 'messages',      field: 'booking',   to: 'bookings', as: 'parentBooking',  type: 'belongsTo' },
    // Message → User (sender)
    { from: 'messages',      field: 'sender',    to: 'users',    as: 'senderUser',     type: 'belongsTo' },
    // Notification → User (recipient)
    { from: 'notifications', field: 'recipient', to: 'users',    as: 'recipientUser',  type: 'belongsTo' },
    // Availability → User (owner)
    { from: 'availabilities',field: 'user',      to: 'users',    as: 'owner',          type: 'belongsTo' },
    // Report → User (reporter)
    { from: 'reports',       field: 'reporter',  to: 'users',    as: 'reporterUser',   type: 'belongsTo' },
    // Report → User (reported)
    { from: 'reports',       field: 'reported',   to: 'users',    as: 'reportedUser',   type: 'belongsTo' },
    // Dispute → Booking
    { from: 'disputes',      field: 'booking',    to: 'bookings', as: 'parentBooking',  type: 'belongsTo' },
    // Dispute → User (who raised it)
    { from: 'disputes',      field: 'raisedBy',   to: 'users',    as: 'raisedByUser',   type: 'belongsTo' },
    // Dispute → User (who it's against)
    { from: 'disputes',      field: 'againstUser',to: 'users',    as: 'againstUserDoc', type: 'belongsTo' },
    // Dispute → User (who resolved it)
    { from: 'disputes',      field: 'resolvedBy', to: 'users',    as: 'resolvedByUser', type: 'belongsTo' },
  ]);
};
