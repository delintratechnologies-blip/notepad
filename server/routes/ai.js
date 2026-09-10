/**
 * AI routes — Claude API integration + AIContextLayer (sessions + memories).
 *
 * Stateless endpoints (no memory):
 *   POST /api/ai/suggest       — topics + questions (memory-enhanced when context exists)
 *   POST /api/ai/bio-polish    — polish a user's bio
 *   POST /api/ai/match         — host-guest matching suggestions
 *   POST /api/ai/show-prep     — personalised show preparation
 *
 * Session endpoints:
 *   POST   /api/ai/sessions                   — create session
 *   GET    /api/ai/sessions                   — list own active sessions
 *   GET    /api/ai/sessions/:id               — get session with messages
 *   POST   /api/ai/sessions/:id/messages      — append message
 *   DELETE /api/ai/sessions/:id               — close session
 *
 * Memory endpoints:
 *   GET    /api/ai/memory                     — list own memories
 *   POST   /api/ai/memory                     — upsert a memory entry
 *   DELETE /api/ai/memory/:key                — delete a memory
 *   GET    /api/ai/context                    — build prompt-ready context string
 */

const router      = require('express').Router();
const Anthropic   = require('@anthropic-ai/sdk');
const verifyToken = require('../middleware/verifyToken');
const { authLimiter } = require('../middleware/rateLimit');
const { requireFeatureEnv } = require('../config/validateEnv');
const stitcher    = require('../stitcher');

// Lazy — session/memory endpoints below work with no Anthropic key; only the
// generation endpoints need it, and they get a clear 503 when it's absent.
let anthropicClient = null;
function getClient() {
  requireFeatureEnv('anthropic');
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

// ── Helper: call Claude ──────────────────────────────────────────────────────
async function callClaude(prompt, maxTokens = 1024) {
  const message = await getClient().messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: maxTokens,
    messages:   [{ role: 'user', content: prompt }],
  });
  return message.content[0].text;
}

// ── POST /api/ai/suggest — memory-enhanced topic + question suggestions ────────
router.post('/suggest', verifyToken, authLimiter, async (req, res) => {
  try {
    const { hostBio, guestBio, guestExpertise = [] } = req.body;

    // Inject user memories to personalise the prompt.
    const memoryContext = await stitcher.ai.buildContext(req.user.id);

    const prompt = [
      'You are a podcast producer. Given a host and a guest, suggest episode content.',
      '',
      ...(memoryContext ? [memoryContext, ''] : []),
      `Host bio: ${hostBio || 'Not provided'}`,
      `Guest bio: ${guestBio || 'Not provided'}`,
      `Guest expertise: ${guestExpertise.join(', ') || 'Not provided'}`,
      '',
      'Return a JSON object with:',
      '- topics: array of 5 episode topic ideas (strings)',
      '- questions: array of 8 compelling interview questions (strings)',
      '- episodeTitles: array of 3 catchy episode title suggestions (strings)',
      '',
      'Return only valid JSON, no markdown.',
    ].join('\n');

    const text   = await callClaude(prompt);
    const parsed = JSON.parse(text);
    res.json(parsed);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/ai/bio-polish — improve a user's bio ────────────────────────────
router.post('/bio-polish', verifyToken, async (req, res) => {
  try {
    const { bio, role } = req.body;
    if (!bio) return res.status(400).json({ error: 'bio is required' });

    const text = await callClaude(
      `Polish this ${role || 'podcaster'} bio to be compelling and professional (max 150 words). Return only the improved bio, no explanation.\n\nOriginal: ${bio}`,
      512
    );
    res.json({ bio: text.trim() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/ai/match — host-guest matching suggestions ──────────────────────
router.post('/match', verifyToken, authLimiter, async (req, res) => {
  try {
    const { hostProfile, guestProfile } = req.body;
    if (!hostProfile || !guestProfile) {
      return res.status(400).json({ error: 'hostProfile and guestProfile are required' });
    }

    const memoryContext = await stitcher.ai.buildContext(req.user.id);

    const prompt = [
      'You are a podcast booking specialist. Evaluate the compatibility between a host and a guest.',
      '',
      ...(memoryContext ? [memoryContext, ''] : []),
      `Host: ${JSON.stringify(hostProfile)}`,
      `Guest: ${JSON.stringify(guestProfile)}`,
      '',
      'Return a JSON object with:',
      '- compatibilityScore: number 0-100',
      '- reasons: array of 3-5 strings explaining the match',
      '- suggestedTopics: array of 3 topics that would work well',
      '- potentialChallenges: array of 1-3 potential friction points',
      '',
      'Return only valid JSON, no markdown.',
    ].join('\n');

    const text   = await callClaude(prompt);
    const parsed = JSON.parse(text);
    res.json({ success: true, data: parsed });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── POST /api/ai/show-prep — personalised show preparation ────────────────────
router.post('/show-prep', verifyToken, authLimiter, async (req, res) => {
  try {
    const { bookingId, hostName, guestName, topics = [], durationMinutes = 60 } = req.body;
    if (!hostName || !guestName) {
      return res.status(400).json({ error: 'hostName and guestName are required' });
    }

    const memoryContext = await stitcher.ai.buildContext(req.user.id);

    const prompt = [
      'You are a podcast show prep specialist.',
      '',
      ...(memoryContext ? [memoryContext, ''] : []),
      `Host: ${hostName}`,
      `Guest: ${guestName}`,
      `Topics: ${topics.join(', ') || 'General'}`,
      `Episode duration: ${durationMinutes} minutes`,
      '',
      'Return a JSON object with:',
      '- outline: array of segments with { title, durationMinutes, notes }',
      '- openingHook: string — compelling way to start the episode',
      '- closingCall: string — strong call-to-action for the outro',
      '- researchPoints: array of 5 things to research before the recording',
      '',
      'Return only valid JSON, no markdown.',
    ].join('\n');

    // Optionally save to a session if bookingId is provided.
    let session = null;
    if (bookingId) {
      session = await stitcher.ai.createSession(req.user.id, 'show_prep', {
        bookingId,
        tenantId: req.user.tenantId || 'castreach',
      });
    }

    const text   = await callClaude(prompt, 2048);
    const parsed = JSON.parse(text);

    if (session) {
      await stitcher.ai.appendMessage(session._id, 'assistant', text);
    }

    res.json({ success: true, data: parsed, sessionId: session?._id || null });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Sessions ──────────────────────────────────────────────────────────────────

// POST /api/ai/sessions — create a new session
router.post('/sessions', verifyToken, async (req, res) => {
  try {
    const { context = 'general', bookingId, metadata } = req.body;
    const session = await stitcher.ai.createSession(req.user.id, context, {
      bookingId,
      metadata,
      tenantId: req.user.tenantId || 'castreach',
    });
    res.status(201).json({ success: true, session });
  } catch (err) {
    const status = err.message.startsWith('Invalid') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// GET /api/ai/sessions — list own active sessions
router.get('/sessions', verifyToken, async (req, res) => {
  try {
    const sessions = await stitcher.ai.listSessions(req.user.id);
    res.json({ success: true, sessions });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/ai/sessions/:id — get a session (own or admin)
router.get('/sessions/:id', verifyToken, async (req, res) => {
  try {
    const session = await stitcher.ai.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });

    const isOwner = session.userId.toString() === req.user.id;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Forbidden' });

    res.json({ success: true, session });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/ai/sessions/:id/messages — append a message to a session
router.post('/sessions/:id/messages', verifyToken, async (req, res) => {
  try {
    const { role, content } = req.body;
    if (!role || !content) {
      return res.status(400).json({ error: 'role and content are required' });
    }

    const existing = await stitcher.ai.getSession(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Session not found' });
    if (existing.userId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (existing.status === 'closed') {
      return res.status(400).json({ error: 'Session is closed' });
    }

    const session = await stitcher.ai.appendMessage(req.params.id, role, content);
    res.json({ success: true, session });
  } catch (err) {
    const status = err.message.startsWith('Invalid') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/ai/sessions/:id — close a session
router.delete('/sessions/:id', verifyToken, async (req, res) => {
  try {
    const existing = await stitcher.ai.getSession(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Session not found' });
    if (existing.userId.toString() !== req.user.id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const session = await stitcher.ai.closeSession(req.params.id);
    res.json({ success: true, session });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ── Memories ──────────────────────────────────────────────────────────────────

// GET /api/ai/memory — list own memories
router.get('/memory', verifyToken, async (req, res) => {
  try {
    const { type } = req.query;
    const memories = await stitcher.ai.getMemories(req.user.id, type || null);
    res.json({ success: true, memories });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// POST /api/ai/memory — upsert a memory
router.post('/memory', verifyToken, async (req, res) => {
  try {
    const { key, value, type, confidence, source, expiresAt } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value are required' });
    }
    const memory = await stitcher.ai.upsertMemory(req.user.id, key, value, {
      type,
      confidence,
      source,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      tenantId:  req.user.tenantId || 'castreach',
    });
    res.status(201).json({ success: true, memory });
  } catch (err) {
    const status = err.message.startsWith('Invalid') ? 400 : 500;
    res.status(status).json({ error: err.message });
  }
});

// DELETE /api/ai/memory/:key — delete a memory by key
router.delete('/memory/:key', verifyToken, async (req, res) => {
  try {
    const result = await stitcher.ai.deleteMemory(req.user.id, req.params.key);
    if (!result.deleted) return res.status(404).json({ error: 'Memory not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /api/ai/context — return the built context string for the calling user
router.get('/context', verifyToken, async (req, res) => {
  try {
    const context = await stitcher.ai.buildContext(req.user.id);
    res.json({ success: true, context, hasContext: context.length > 0 });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
