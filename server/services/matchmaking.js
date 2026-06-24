const User = require('../models/User');

/**
 * Score a guest candidate for a host (or vice versa).
 * Score = topic_overlap*0.4 + avg_rating*0.3 + response_rate*0.2 + recency*0.1
 */
function scoreCandidate(viewer, candidate) {
  const viewerTopics    = new Set(viewer.expertise || []);
  const candidateTopics = candidate.expertise || [];

  const overlap = candidateTopics.filter((t) => viewerTopics.has(t)).length;
  const topicScore = viewerTopics.size > 0
    ? overlap / Math.max(viewerTopics.size, candidateTopics.length, 1)
    : 0;

  const ratingScore   = (candidate.avgRating || 0) / 5;
  const responseScore = candidate.responseRate || 0;
  const recencyScore  = candidate.updatedAt
    ? Math.max(0, 1 - (Date.now() - new Date(candidate.updatedAt)) / (30 * 24 * 60 * 60 * 1000))
    : 0;

  return topicScore * 0.4 + ratingScore * 0.3 + responseScore * 0.2 + recencyScore * 0.1;
}

/**
 * Return top N recommended users for a given user.
 * Hosts get recommended guests and vice versa.
 */
async function getRecommendations(userId, limit = 10) {
  const viewer = await User.findById(userId);
  if (!viewer) throw new Error('User not found');

  const targetRole = viewer.role === 'host' ? 'guest' : 'host';

  const candidates = await User.find({
    _id:       { $ne: userId },
    role:      targetRole,
    isBlocked: false,
  }).limit(200);   // sample pool — good enough without vector DB

  const scored = candidates.map((c) => ({
    user:  c,
    score: scoreCandidate(viewer, c),
  }));

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(({ user, score }) => ({ user, score: +score.toFixed(3) }));
}

module.exports = { getRecommendations, scoreCandidate };
