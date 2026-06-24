/**
 * AuditLog — immutable audit trail records.
 *
 * Written exclusively by AuditLogger (server/stitcher/audit/AuditLogger.js).
 * Never updated or deleted — append-only by convention.
 *
 * Sensitive fields are redacted by AuditLogger BEFORE this model is called.
 * Nothing in this schema should ever hold a raw password, token, or PAN.
 *
 * Field name is `collectionName` (not `collection`) because `collection` is
 * a reserved Mongoose schema pathname that breaks internal behaviour.
 */
const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema(
  {
    collectionName: { type: String, required: true },
    documentId:     { type: mongoose.Schema.Types.ObjectId },
    action:         { type: String, enum: ['create', 'update', 'delete'], required: true },
    actor:          { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    actorRole:      { type: String },
    before:         { type: mongoose.Schema.Types.Mixed },
    after:          { type: mongoose.Schema.Types.Mixed },
    diff:           { type: mongoose.Schema.Types.Mixed },
    ip:             { type: String },
    userAgent:      { type: String },
    tenantId:       { type: String, default: 'castreach' },
  },
  { timestamps: true }
);

auditLogSchema.index({ collectionName: 1, documentId: 1, createdAt: -1 });
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ tenantId: 1, createdAt: -1 });

module.exports = mongoose.model('AuditLog', auditLogSchema);
