/**
 * AIContextLayer — session and memory management for CastReach AI features.
 *
 * Does NOT call the Anthropic API directly. Manages the context layer
 * (sessions + memories) that routes/ai.js injects into Claude prompts.
 *
 * Design:
 *   - Sessions  — ephemeral conversation state, 24h TTL.
 *   - Memories  — long-term user context keyed by { userId, key }, optional TTL.
 *   - buildContext() — formats memories into a prompt-ready string.
 */

const AiSession = require('../../models/AiSession');
const AiMemory  = require('../../models/AiMemory');

const VALID_CONTEXTS = ['suggest', 'match', 'show_prep', 'bio_polish', 'general'];
const VALID_TYPES    = ['preference', 'expertise', 'history', 'feedback', 'context'];
const VALID_ROLES    = ['user', 'assistant', 'system'];

class AIContextLayer {
  constructor() {
    this._sessionCreates  = 0;
    this._memoryUpserts   = 0;
    this._contextBuilds   = 0;
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────

  /**
   * Create a new AI session for a user.
   * @param {string|ObjectId} userId
   * @param {string}          context  - one of VALID_CONTEXTS
   * @param {object}          opts     - { bookingId, metadata, tenantId }
   */
  async createSession(userId, context = 'general', opts = {}) {
    if (!VALID_CONTEXTS.includes(context)) {
      throw new Error(`Invalid context '${context}'. Must be one of: ${VALID_CONTEXTS.join(', ')}`);
    }
    this._sessionCreates++;
    return AiSession.create({
      userId,
      context,
      bookingId: opts.bookingId  || null,
      metadata:  opts.metadata   || {},
      tenantId:  opts.tenantId   || 'castreach',
    });
  }

  /**
   * Retrieve a session by ID.
   * @param {string|ObjectId} sessionId
   * @returns {Promise<AiSession|null>}
   */
  getSession(sessionId) {
    return AiSession.findById(sessionId);
  }

  /**
   * Append a message to a session's message history.
   * @param {string|ObjectId} sessionId
   * @param {'user'|'assistant'|'system'} role
   * @param {string}          content
   * @returns {Promise<AiSession>}
   */
  async appendMessage(sessionId, role, content) {
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`Invalid role '${role}'. Must be user, assistant, or system.`);
    }
    const session = await AiSession.findByIdAndUpdate(
      sessionId,
      { $push: { messages: { role, content } } },
      { new: true, runValidators: true }
    );
    if (!session) throw new Error('Session not found');
    return session;
  }

  /**
   * Close a session (mark as closed; TTL handles physical deletion).
   * @param {string|ObjectId} sessionId
   * @returns {Promise<AiSession>}
   */
  async closeSession(sessionId) {
    const session = await AiSession.findByIdAndUpdate(
      sessionId,
      { status: 'closed' },
      { new: true }
    );
    if (!session) throw new Error('Session not found');
    return session;
  }

  /**
   * List active sessions for a user.
   * @param {string|ObjectId} userId
   * @returns {Promise<AiSession[]>}
   */
  listSessions(userId) {
    return AiSession.find({ userId, status: 'active' }).sort({ createdAt: -1 });
  }

  // ── Memories ─────────────────────────────────────────────────────────────────

  /**
   * Create or update a memory entry.
   * @param {string|ObjectId} userId
   * @param {string}          key       - e.g. 'preferred_topics', 'communication_style'
   * @param {*}               value
   * @param {object}          opts      - { type, confidence, source, expiresAt, tenantId }
   * @returns {Promise<AiMemory>}
   */
  async upsertMemory(userId, key, value, opts = {}) {
    if (!key || typeof key !== 'string') throw new Error('key must be a non-empty string');
    if (opts.type && !VALID_TYPES.includes(opts.type)) {
      throw new Error(`Invalid type '${opts.type}'. Must be one of: ${VALID_TYPES.join(', ')}`);
    }
    this._memoryUpserts++;
    return AiMemory.findOneAndUpdate(
      { userId, key },
      {
        $set: {
          value,
          type:       opts.type       || 'context',
          confidence: opts.confidence ?? 1.0,
          source:     opts.source     || 'user_stated',
          expiresAt:  opts.expiresAt  || null,
          tenantId:   opts.tenantId   || 'castreach',
        },
      },
      { upsert: true, new: true, runValidators: true }
    );
  }

  /**
   * Get all memories for a user, optionally filtered by type.
   * @param {string|ObjectId} userId
   * @param {string|null}     type
   * @returns {Promise<AiMemory[]>}
   */
  getMemories(userId, type = null) {
    const filter = { userId };
    if (type) filter.type = type;
    return AiMemory.find(filter).sort({ updatedAt: -1 });
  }

  /**
   * Delete a specific memory by userId + key.
   * @returns {Promise<{deleted: boolean}>}
   */
  async deleteMemory(userId, key) {
    const result = await AiMemory.deleteOne({ userId, key });
    return { deleted: result.deletedCount === 1 };
  }

  // ── Context building ──────────────────────────────────────────────────────────

  /**
   * Build a prompt-injection-ready context block from a user's memories.
   * Returns an empty string when the user has no memories.
   *
   * @param {string|ObjectId} userId
   * @returns {Promise<string>}
   */
  async buildContext(userId) {
    this._contextBuilds++;
    const memories = await AiMemory.find({ userId }).sort({ type: 1, key: 1 });
    if (!memories.length) return '';

    const lines = ['[User context from memory]'];
    for (const mem of memories) {
      const val = typeof mem.value === 'object'
        ? JSON.stringify(mem.value)
        : String(mem.value);
      lines.push(`${mem.type}/${mem.key}: ${val}`);
    }
    return lines.join('\n');
  }

  // ── Stats ─────────────────────────────────────────────────────────────────────

  stats() {
    return {
      sessionCreates: this._sessionCreates,
      memoryUpserts:  this._memoryUpserts,
      contextBuilds:  this._contextBuilds,
    };
  }
}

module.exports = AIContextLayer;
