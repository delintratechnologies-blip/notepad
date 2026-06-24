/**
 * Tests for Step 10 — AI Context Layer.
 *
 * What is tested:
 *   AIContextLayer (unit):
 *     - createSession() — valid + invalid context
 *     - getSession() — returns doc or null
 *     - appendMessage() — adds to messages array, validates role
 *     - closeSession() — sets status: closed
 *     - listSessions() — returns active sessions for user only
 *     - upsertMemory() — create + update (idempotent key)
 *     - getMemories() — all + filtered by type
 *     - deleteMemory() — returns {deleted: true/false}
 *     - buildContext() — empty string when no memories; structured string otherwise
 *     - stats() — counts sessionCreates, memoryUpserts, contextBuilds
 *
 *   API endpoints (integration — no Claude calls):
 *     Sessions: POST / GET / GET:id / POST:id/messages / DELETE:id
 *     Memory:   GET / POST / DELETE:key / GET /context
 *     Auth:     all endpoints require verifyToken (401 without token)
 *
 *   Stitcher:
 *     - stitcher.ai is AIContextLayer after initialize()
 *     - healthCheck reports ai: 'active' and aiStats
 *     - health endpoint shows ai: 'active'
 *
 *   Collections:
 *     - 'aisessions' and 'aimemories' registered in stitcher
 *
 * NOTE: afterEach wipes all collections — each test creates its own data.
 * Claude API calls (/suggest, /bio-polish, /match, /show-prep) are NOT tested
 * here — they require a real ANTHROPIC_API_KEY.
 */

const AIContextLayer = require('../stitcher/ai/AIContextLayer');
const AiSession      = require('../models/AiSession');
const AiMemory       = require('../models/AiMemory');
const stitcher       = require('../stitcher');
const { request, app, makeUser, makeAdmin, makeHost } = require('./helpers');

// ── Unit: AIContextLayer ──────────────────────────────────────────────────────
describe('AIContextLayer (unit)', () => {
  let ai;
  let userId;

  beforeEach(async () => {
    ai = new AIContextLayer();
    const user = await makeUser({ role: 'host' });
    userId = user.user._id;
  });

  // Sessions
  test('createSession() returns an AiSession document', async () => {
    const session = await ai.createSession(userId, 'suggest');
    expect(session._id).toBeDefined();
    expect(session.context).toBe('suggest');
    expect(session.status).toBe('active');
    expect(session.messages).toHaveLength(0);
  });

  test('createSession() throws for invalid context', async () => {
    await expect(ai.createSession(userId, 'invalid_ctx')).rejects.toThrow('Invalid context');
  });

  test('getSession() returns the session by id', async () => {
    const created = await ai.createSession(userId, 'general');
    const found   = await ai.getSession(created._id);
    expect(found._id.toString()).toBe(created._id.toString());
  });

  test('getSession() returns null for unknown id', async () => {
    const found = await ai.getSession('507f1f77bcf86cd799439011');
    expect(found).toBeNull();
  });

  test('appendMessage() adds a message to the session', async () => {
    const session = await ai.createSession(userId, 'general');
    const updated = await ai.appendMessage(session._id, 'user', 'Hello AI');
    expect(updated.messages).toHaveLength(1);
    expect(updated.messages[0].role).toBe('user');
    expect(updated.messages[0].content).toBe('Hello AI');
  });

  test('appendMessage() accumulates multiple messages', async () => {
    const session = await ai.createSession(userId, 'general');
    await ai.appendMessage(session._id, 'user',      'First message');
    const updated = await ai.appendMessage(session._id, 'assistant', 'First response');
    expect(updated.messages).toHaveLength(2);
  });

  test('appendMessage() throws for invalid role', async () => {
    const session = await ai.createSession(userId, 'general');
    await expect(ai.appendMessage(session._id, 'bot', 'Hello')).rejects.toThrow('Invalid role');
  });

  test('appendMessage() throws for unknown session', async () => {
    await expect(
      ai.appendMessage('507f1f77bcf86cd799439011', 'user', 'Hello')
    ).rejects.toThrow('Session not found');
  });

  test('closeSession() sets status to closed', async () => {
    const session = await ai.createSession(userId, 'general');
    const closed  = await ai.closeSession(session._id);
    expect(closed.status).toBe('closed');
  });

  test('listSessions() returns active sessions for the user', async () => {
    await ai.createSession(userId, 'suggest');
    await ai.createSession(userId, 'match');
    const sessions = await ai.listSessions(userId);
    expect(sessions.length).toBe(2);
    expect(sessions.every((s) => s.status === 'active')).toBe(true);
  });

  test('listSessions() excludes closed sessions', async () => {
    const s1 = await ai.createSession(userId, 'suggest');
    await ai.createSession(userId, 'match');
    await ai.closeSession(s1._id);
    const sessions = await ai.listSessions(userId);
    expect(sessions.length).toBe(1);
  });

  // Memories
  test('upsertMemory() creates a new memory', async () => {
    const mem = await ai.upsertMemory(userId, 'preferred_topics', ['AI', 'Science']);
    expect(mem._id).toBeDefined();
    expect(mem.key).toBe('preferred_topics');
    expect(mem.value).toEqual(['AI', 'Science']);
    expect(mem.type).toBe('context');
  });

  test('upsertMemory() updates existing memory by key', async () => {
    await ai.upsertMemory(userId, 'tone', 'casual');
    const updated = await ai.upsertMemory(userId, 'tone', 'professional');
    const all = await AiMemory.find({ userId });
    expect(all.length).toBe(1); // no duplicate
    expect(updated.value).toBe('professional');
  });

  test('upsertMemory() respects type option', async () => {
    const mem = await ai.upsertMemory(userId, 'topic_pref', 'tech', { type: 'preference' });
    expect(mem.type).toBe('preference');
  });

  test('upsertMemory() throws for invalid type', async () => {
    await expect(
      ai.upsertMemory(userId, 'bad', 'val', { type: 'unknown_type' })
    ).rejects.toThrow('Invalid type');
  });

  test('getMemories() returns all memories for user', async () => {
    await ai.upsertMemory(userId, 'k1', 'v1', { type: 'preference' });
    await ai.upsertMemory(userId, 'k2', 'v2', { type: 'expertise' });
    const mems = await ai.getMemories(userId);
    expect(mems.length).toBe(2);
  });

  test('getMemories() filters by type', async () => {
    await ai.upsertMemory(userId, 'k1', 'v1', { type: 'preference' });
    await ai.upsertMemory(userId, 'k2', 'v2', { type: 'expertise' });
    const prefs = await ai.getMemories(userId, 'preference');
    expect(prefs.length).toBe(1);
    expect(prefs[0].key).toBe('k1');
  });

  test('deleteMemory() removes a memory and returns {deleted: true}', async () => {
    await ai.upsertMemory(userId, 'temp_key', 'temp_val');
    const result = await ai.deleteMemory(userId, 'temp_key');
    expect(result.deleted).toBe(true);
    const remaining = await AiMemory.findOne({ userId, key: 'temp_key' });
    expect(remaining).toBeNull();
  });

  test('deleteMemory() returns {deleted: false} for unknown key', async () => {
    const result = await ai.deleteMemory(userId, 'nonexistent_key');
    expect(result.deleted).toBe(false);
  });

  // buildContext
  test('buildContext() returns empty string when user has no memories', async () => {
    const ctx = await ai.buildContext(userId);
    expect(ctx).toBe('');
  });

  test('buildContext() returns structured string with memories', async () => {
    await ai.upsertMemory(userId, 'preferred_topics', 'AI and robotics', { type: 'preference' });
    const ctx = await ai.buildContext(userId);
    expect(ctx).toContain('[User context from memory]');
    expect(ctx).toContain('preferred_topics');
    expect(ctx).toContain('AI and robotics');
  });

  test('buildContext() includes all memory types', async () => {
    await ai.upsertMemory(userId, 'topic_pref',   'tech',    { type: 'preference' });
    await ai.upsertMemory(userId, 'python_expert', '5 years', { type: 'expertise' });
    const ctx = await ai.buildContext(userId);
    expect(ctx).toContain('preference/topic_pref');
    expect(ctx).toContain('expertise/python_expert');
  });

  // Stats
  test('stats() tracks sessionCreates, memoryUpserts, contextBuilds', async () => {
    await ai.createSession(userId, 'suggest');
    await ai.createSession(userId, 'match');
    await ai.upsertMemory(userId, 'key1', 'val1');
    await ai.buildContext(userId);

    const s = ai.stats();
    expect(s.sessionCreates).toBe(2);
    expect(s.memoryUpserts).toBe(1);
    expect(s.contextBuilds).toBe(1);
  });
});

// ── Integration: Session API endpoints ───────────────────────────────────────
describe('AI session endpoints', () => {
  test('POST /api/ai/sessions — 201 with valid context', async () => {
    const { token } = await makeUser({ role: 'host' });
    const res = await request(app)
      .post('/api/ai/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ context: 'suggest' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.session.context).toBe('suggest');
    expect(res.body.session.status).toBe('active');
  });

  test('POST /api/ai/sessions — 400 for invalid context', async () => {
    const { token } = await makeUser({ role: 'host' });
    const res = await request(app)
      .post('/api/ai/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ context: 'bad_ctx' });

    expect(res.status).toBe(400);
  });

  test('POST /api/ai/sessions — 401 without token', async () => {
    const res = await request(app).post('/api/ai/sessions').send({ context: 'suggest' });
    expect(res.status).toBe(401);
  });

  test('GET /api/ai/sessions — lists own active sessions', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    await AiSession.create({ userId: user._id, context: 'suggest' });
    await AiSession.create({ userId: user._id, context: 'match' });

    const res = await request(app)
      .get('/api/ai/sessions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.sessions.length).toBe(2);
  });

  test('GET /api/ai/sessions/:id — owner can view their session', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    const session = await AiSession.create({ userId: user._id, context: 'general' });

    const res = await request(app)
      .get(`/api/ai/sessions/${session._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.session._id).toBe(session._id.toString());
  });

  test('GET /api/ai/sessions/:id — non-owner gets 403', async () => {
    const { user: owner } = await makeUser({ role: 'host' });
    const { token: otherToken } = await makeUser({ role: 'guest' });
    const session = await AiSession.create({ userId: owner._id, context: 'general' });

    const res = await request(app)
      .get(`/api/ai/sessions/${session._id}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  test('GET /api/ai/sessions/:id — 404 for unknown session', async () => {
    const { token } = await makeUser({ role: 'host' });
    const res = await request(app)
      .get('/api/ai/sessions/507f1f77bcf86cd799439011')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('POST /api/ai/sessions/:id/messages — appends message', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    const session = await AiSession.create({ userId: user._id, context: 'general' });

    const res = await request(app)
      .post(`/api/ai/sessions/${session._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'user', content: 'What topics should I cover?' });

    expect(res.status).toBe(200);
    expect(res.body.session.messages).toHaveLength(1);
    expect(res.body.session.messages[0].content).toBe('What topics should I cover?');
  });

  test('POST /api/ai/sessions/:id/messages — 400 for closed session', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    const session = await AiSession.create({ userId: user._id, context: 'general', status: 'closed' });

    const res = await request(app)
      .post(`/api/ai/sessions/${session._id}/messages`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: 'user', content: 'Still open?' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/closed/);
  });

  test('DELETE /api/ai/sessions/:id — closes session', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    const session = await AiSession.create({ userId: user._id, context: 'general' });

    const res = await request(app)
      .delete(`/api/ai/sessions/${session._id}`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.session.status).toBe('closed');
  });

  test('DELETE /api/ai/sessions/:id — non-owner gets 403', async () => {
    const { user: owner } = await makeUser({ role: 'host' });
    const { token: other } = await makeUser({ role: 'guest' });
    const session = await AiSession.create({ userId: owner._id, context: 'general' });

    const res = await request(app)
      .delete(`/api/ai/sessions/${session._id}`)
      .set('Authorization', `Bearer ${other}`);

    expect(res.status).toBe(403);
  });
});

// ── Integration: Memory API endpoints ────────────────────────────────────────
describe('AI memory endpoints', () => {
  test('GET /api/ai/memory — returns own memories', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    await AiMemory.create({ userId: user._id, key: 'topics', value: 'tech', type: 'preference' });

    const res = await request(app)
      .get('/api/ai/memory')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.memories).toHaveLength(1);
    expect(res.body.memories[0].key).toBe('topics');
  });

  test('GET /api/ai/memory — 401 without token', async () => {
    const res = await request(app).get('/api/ai/memory');
    expect(res.status).toBe(401);
  });

  test('GET /api/ai/memory?type=preference — filters by type', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    await AiMemory.create({ userId: user._id, key: 'k1', value: 'v1', type: 'preference' });
    await AiMemory.create({ userId: user._id, key: 'k2', value: 'v2', type: 'expertise' });

    const res = await request(app)
      .get('/api/ai/memory?type=preference')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.memories).toHaveLength(1);
    expect(res.body.memories[0].key).toBe('k1');
  });

  test('POST /api/ai/memory — creates a new memory (201)', async () => {
    const { token } = await makeUser({ role: 'host' });
    const res = await request(app)
      .post('/api/ai/memory')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'preferred_style', value: 'conversational', type: 'preference' });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.memory.key).toBe('preferred_style');
  });

  test('POST /api/ai/memory — upserts (same key updates in place)', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    await AiMemory.create({ userId: user._id, key: 'style', value: 'formal', type: 'preference' });

    await request(app)
      .post('/api/ai/memory')
      .set('Authorization', `Bearer ${token}`)
      .send({ key: 'style', value: 'casual' });

    const all = await AiMemory.find({ userId: user._id, key: 'style' });
    expect(all.length).toBe(1);
    expect(all[0].value).toBe('casual');
  });

  test('POST /api/ai/memory — 400 when key is missing', async () => {
    const { token } = await makeUser({ role: 'host' });
    const res = await request(app)
      .post('/api/ai/memory')
      .set('Authorization', `Bearer ${token}`)
      .send({ value: 'something' });

    expect(res.status).toBe(400);
  });

  test('DELETE /api/ai/memory/:key — removes memory', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    await AiMemory.create({ userId: user._id, key: 'temp', value: 'gone', type: 'context' });

    const res = await request(app)
      .delete('/api/ai/memory/temp')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const remaining = await AiMemory.findOne({ userId: user._id, key: 'temp' });
    expect(remaining).toBeNull();
  });

  test('DELETE /api/ai/memory/:key — 404 for unknown key', async () => {
    const { token } = await makeUser({ role: 'host' });
    const res = await request(app)
      .delete('/api/ai/memory/nonexistent_key')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  test('DELETE /api/ai/memory/:key — only deletes own memory', async () => {
    const { user: owner } = await makeUser({ role: 'host' });
    const { token: other } = await makeUser({ role: 'guest' });
    await AiMemory.create({ userId: owner._id, key: 'secret', value: 'data', type: 'context' });

    const res = await request(app)
      .delete('/api/ai/memory/secret')
      .set('Authorization', `Bearer ${other}`);

    // Other user has no memory with key 'secret' → 404 (not a data leak)
    expect(res.status).toBe(404);

    const still = await AiMemory.findOne({ userId: owner._id, key: 'secret' });
    expect(still).not.toBeNull();
  });
});

// ── Integration: GET /api/ai/context ─────────────────────────────────────────
describe('GET /api/ai/context', () => {
  test('returns empty context when user has no memories', async () => {
    const { token } = await makeUser({ role: 'host' });
    const res = await request(app)
      .get('/api/ai/context')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.context).toBe('');
    expect(res.body.hasContext).toBe(false);
  });

  test('returns context string when user has memories', async () => {
    const { token, user } = await makeUser({ role: 'host' });
    await AiMemory.create({
      userId: user._id, key: 'style', value: 'conversational', type: 'preference',
    });

    const res = await request(app)
      .get('/api/ai/context')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.hasContext).toBe(true);
    expect(res.body.context).toContain('style');
    expect(res.body.context).toContain('conversational');
  });
});

// ── Stitcher integration ──────────────────────────────────────────────────────
describe('stitcher.ai', () => {
  test('stitcher.ai is an AIContextLayer instance', () => {
    expect(stitcher.ai).toBeInstanceOf(AIContextLayer);
  });

  test('healthCheck reports ai: active', () => {
    const hc = stitcher.healthCheck();
    expect(hc.components.ai).toBe('active');
    expect(hc.aiStats).toHaveProperty('sessionCreates');
    expect(hc.aiStats).toHaveProperty('memoryUpserts');
    expect(hc.aiStats).toHaveProperty('contextBuilds');
  });

  test('health endpoint reports ai: active', async () => {
    const { token } = await makeAdmin();
    const res = await request(app)
      .get('/api/stitcher/health')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.components.ai).toBe('active');
    expect(res.body.aiStats).toBeDefined();
  });

  test('aisessions and aimemories are registered collections', () => {
    const names = stitcher.collections.names();
    expect(names).toContain('aisessions');
    expect(names).toContain('aimemories');
  });
});
