/**
 * initAtlas.js — one-shot initialization script for MongoDB Atlas.
 *
 * What this does:
 *   1. Connects to Atlas
 *   2. Lists all databases and existing collections (read-only inspection)
 *   3. Syncs indexes for all Mongoose models (creates collections implicitly)
 *   4. Creates approved additional collections: auditlogs, disputes,
 *      analytics_events, migration_history
 *   5. Prints the final cluster map — all databases, collections, indexes
 *
 * Safe to run multiple times (idempotent). Never drops or modifies data.
 *
 * Run:
 *   cd server && node database/initAtlas.js
 */

'use strict';

require('dotenv').config();
const mongoose = require('mongoose');

// ── Load all Mongoose models (causes their schemas + indexes to be registered) ─
const User         = require('../models/User');
const Booking      = require('../models/Booking');
const Message      = require('../models/Message');
const Notification = require('../models/Notification');
const Availability = require('../models/Availability');
const Report       = require('../models/Report');

const MONGO_URI = process.env.MONGODB_URI;
const DB_NAME   = 'castreach';

// ── Extra collection schemas (not yet in Mongoose models — created here directly) ─

const auditLogSchema = new mongoose.Schema(
  {
    collection:  { type: String, required: true },
    documentId:  { type: mongoose.Schema.Types.ObjectId },
    action:      { type: String, enum: ['create', 'update', 'delete'], required: true },
    actor:       { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole:   { type: String },
    before:      { type: mongoose.Schema.Types.Mixed },   // sensitive fields pre-redacted
    after:       { type: mongoose.Schema.Types.Mixed },   // sensitive fields pre-redacted
    diff:        { type: mongoose.Schema.Types.Mixed },
    ip:          { type: String },
    userAgent:   { type: String },
    tenantId:    { type: String, default: 'castreach' },
  },
  { timestamps: true, collection: 'auditlogs' }
);
auditLogSchema.index({ collection: 1, documentId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ tenantId: 1, createdAt: -1 });

const disputeSchema = new mongoose.Schema(
  {
    booking:    { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true },
    raisedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
    against:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',    required: true },
    reason:     { type: String, required: true, maxlength: 1000 },
    evidence:   [{ type: String }],                       // signed URLs to uploaded files
    status:     {
      type:    String,
      enum:    ['open', 'under_review', 'resolved_host_wins', 'resolved_guest_wins', 'dismissed'],
      default: 'open',
    },
    resolution: { type: String, maxlength: 2000 },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: { type: Date },
    tenantId:   { type: String, default: 'castreach' },
  },
  { timestamps: true, collection: 'disputes' }
);
disputeSchema.index({ booking:  1 });
disputeSchema.index({ raisedBy: 1, status: 1 });
disputeSchema.index({ status:   1, createdAt: -1 });
disputeSchema.index({ tenantId: 1, status: 1 });

const analyticsEventSchema = new mongoose.Schema(
  {
    event:      { type: String, required: true },         // e.g. 'booking.created'
    actorId:    { type: mongoose.Schema.Types.ObjectId },
    targetId:   { type: mongoose.Schema.Types.ObjectId },
    targetType: { type: String },                         // 'booking' | 'user' | 'review'
    properties: { type: mongoose.Schema.Types.Mixed },    // IDs only — no full documents
    tenantId:   { type: String, default: 'castreach' },
  },
  { timestamps: true, collection: 'analytics_events' }
);
analyticsEventSchema.index({ event:    1, createdAt: -1 });
analyticsEventSchema.index({ actorId:  1, createdAt: -1 });
analyticsEventSchema.index({ tenantId: 1, event: 1, createdAt: -1 });

const migrationHistorySchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, unique: true },
    description: { type: String },
    status:      {
      type:    String,
      enum:    ['pending', 'running', 'completed', 'failed', 'rolled_back'],
      default: 'pending',
    },
    startedAt:   { type: Date },
    completedAt: { type: Date },
    durationMs:  { type: Number },
    error:       { type: String },
    checksum:    { type: String },                        // MD5 of the migration script
    appliedBy:   { type: String },
    tenantId:    { type: String, default: 'castreach' },
  },
  { timestamps: true, collection: 'migration_history' }
);
migrationHistorySchema.index({ status:   1 });
migrationHistorySchema.index({ tenantId: 1, createdAt: -1 });

// ── Register extra models ────────────────────────────────────────────────────

const AuditLog         = mongoose.model('AuditLog',         auditLogSchema);
const Dispute          = mongoose.model('Dispute',          disputeSchema);
const AnalyticsEvent   = mongoose.model('AnalyticsEvent',   analyticsEventSchema);
const MigrationHistory = mongoose.model('MigrationHistory', migrationHistorySchema);

// ── ALL managed collections ──────────────────────────────────────────────────

const MODELS = [
  { name: 'users',             model: User,             step: 'core' },
  { name: 'bookings',          model: Booking,          step: 'core' },
  { name: 'messages',          model: Message,          step: 'core' },
  { name: 'notifications',     model: Notification,     step: 'core' },
  { name: 'availabilities',    model: Availability,     step: 'core' },
  { name: 'reports',           model: Report,           step: 'Step 1' },
  { name: 'auditlogs',         model: AuditLog,         step: 'Step 3' },
  { name: 'disputes',          model: Dispute,          step: 'Step 6' },
  { name: 'analytics_events',  model: AnalyticsEvent,   step: 'Step 8' },
  { name: 'migration_history', model: MigrationHistory, step: 'Step 7' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function sep(char = '─', len = 70) {
  return char.repeat(len);
}

function pad(str, width) {
  return str.toString().padEnd(width);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + sep('═'));
  console.log('  CastReach — Atlas Initialization & Cluster Map');
  console.log('  Cluster : delintra.zsegtzu.mongodb.net');
  console.log('  Database: ' + DB_NAME);
  console.log(sep('═') + '\n');

  // ── Connect ────────────────────────────────────────────────────────────────
  console.log('[1/4] Connecting to MongoDB Atlas...');
  await mongoose.connect(MONGO_URI);
  console.log('      Connected.\n');

  const db     = mongoose.connection.db;
  const admin  = db.admin();

  // ── Read current state ────────────────────────────────────────────────────
  console.log('[2/4] Reading current cluster state...');

  const { databases } = await admin.listDatabases();
  const currentColls  = await db.listCollections().toArray();
  const existingNames = new Set(currentColls.map((c) => c.name));

  console.log('\n  Databases on this cluster:');
  for (const dbInfo of databases) {
    const marker = dbInfo.name === DB_NAME ? ' ← active' : '';
    console.log(`    • ${dbInfo.name}${marker}`);
  }

  console.log('\n  Existing collections in [' + DB_NAME + '] before sync:');
  if (currentColls.length === 0) {
    console.log('    (none — empty database)');
  } else {
    for (const c of currentColls) {
      console.log(`    • ${c.name}`);
    }
  }

  // ── Sync all Mongoose model indexes ──────────────────────────────────────
  console.log('\n[3/4] Syncing collections & indexes...\n');

  const results = [];

  for (const { name, model, step } of MODELS) {
    process.stdout.write(`  ${pad(name, 22)} (${step})  →  `);
    try {
      await model.syncIndexes();
      const isNew = !existingNames.has(name);
      const tag   = isNew ? 'CREATED' : 'synced';
      console.log(tag);
      results.push({ name, step, status: tag, error: null });
    } catch (err) {
      console.log('ERROR: ' + err.message);
      results.push({ name, step, status: 'ERROR', error: err.message });
    }
  }

  // ── Notifications TTL index (approved in implementation authorization) ────
  console.log('\n  Adding notifications TTL index (30-day auto-expiry)...');
  try {
    await db.collection('notifications').createIndex(
      { createdAt: 1 },
      { expireAfterSeconds: 30 * 24 * 60 * 60, name: 'notifications_ttl_30d' }
    );
    console.log('  notifications_ttl_30d  →  synced');
  } catch (err) {
    if (err.codeName === 'IndexAlreadyExists' || err.code === 85 || err.code === 86) {
      console.log('  notifications_ttl_30d  →  already exists');
    } else {
      console.log('  notifications_ttl_30d  →  ERROR: ' + err.message);
    }
  }

  // ── Bookings Stripe PaymentIntent index (approved) ────────────────────────
  console.log('  Adding bookings stripePaymentIntentId index...');
  try {
    await db.collection('bookings').createIndex(
      { stripePaymentIntentId: 1 },
      { sparse: true, name: 'bookings_stripe_pi_idx' }
    );
    console.log('  bookings_stripe_pi_idx →  synced');
  } catch (err) {
    if (err.codeName === 'IndexAlreadyExists' || err.code === 85 || err.code === 86) {
      console.log('  bookings_stripe_pi_idx →  already exists');
    } else {
      console.log('  bookings_stripe_pi_idx →  ERROR: ' + err.message);
    }
  }

  // ── Print final cluster map ───────────────────────────────────────────────
  console.log('\n' + sep('═'));
  console.log('  FINAL CLUSTER MAP — Delintra Atlas Cluster');
  console.log(sep('═'));

  const finalColls = await db.listCollections().toArray();
  const finalNames = finalColls.map((c) => c.name).sort();

  console.log('\n  Cluster  : delintra.zsegtzu.mongodb.net (M0 Free Tier)');
  console.log('  Provider : AWS  Region: us-east-1 (Virginia)\n');

  const dbsAfter = await admin.listDatabases();
  for (const dbInfo of dbsAfter.databases) {
    console.log(`  DATABASE: ${dbInfo.name}`);
    if (dbInfo.name === DB_NAME) {
      for (const collName of finalNames) {
        // Get index list
        const indexes = await db.collection(collName).indexes();
        const idxNames = indexes.map((i) => i.name).filter((n) => n !== '_id_');
        const modelInfo = MODELS.find((m) => m.name === collName);
        const step = modelInfo ? modelInfo.step : 'system';

        console.log(`  ├── ${pad(collName, 25)} [${step}]`);
        for (const idx of idxNames) {
          console.log(`  │     index: ${idx}`);
        }
        if (idxNames.length === 0) {
          console.log('  │     (no custom indexes)');
        }
      }
    } else {
      const otherDb   = db.admin().command ? null : null;
      const tempConn  = mongoose.connection.useDb(dbInfo.name);
      const otherList = await tempConn.db.listCollections().toArray();
      if (otherList.length === 0) {
        console.log('  └── (empty database)');
      } else {
        for (const c of otherList) {
          console.log(`  ├── ${c.name}`);
        }
      }
    }
    console.log('');
  }

  // ── Summary table ─────────────────────────────────────────────────────────
  console.log(sep());
  console.log('  COLLECTION SUMMARY');
  console.log(sep());
  console.log(`  ${pad('Collection', 25)} ${pad('Implemented At', 12)} ${pad('Status', 10)} Purpose`);
  console.log('  ' + sep('-', 67));

  const purposeMap = {
    users:             'Platform users — hosts, guests, admins',
    bookings:          'Podcast session bookings + Stripe escrow',
    messages:          'Per-booking chat',
    notifications:     'In-app notification queue (TTL: 30 days)',
    availabilities:    'Host time-slot availability',
    reports:           'User-submitted moderation reports',
    auditlogs:         'Immutable audit trail (PII-redacted snapshots)',
    disputes:          'Booking dispute workflow',
    analytics_events:  'Event stream for analytics projections',
    migration_history: 'Schema migration tracking',
  };

  for (const { name, step, status } of results) {
    const purpose = purposeMap[name] || '';
    console.log(`  ${pad(name, 25)} ${pad(step, 12)} ${pad(status, 10)} ${purpose}`);
  }

  console.log('\n  Total collections : ' + finalNames.length);
  console.log('  Total databases   : ' + dbsAfter.databases.length);
  console.log(sep('═') + '\n');

  await mongoose.disconnect();
  console.log('Done. Connection closed.\n');
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  process.exit(1);
});
