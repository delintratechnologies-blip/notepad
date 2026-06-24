/**
 * Shared utility functions used across the Stitcher layer.
 * Not application-specific — these are pure helpers with no DB or model imports.
 */

/** Escape all regex metacharacters so a string is safe to embed in a RegExp. */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Returns true if str is a valid 24-character MongoDB ObjectId hex string. */
function isValidObjectId(str) {
  return /^[a-f\d]{24}$/i.test(str);
}

/** Returns human-readable elapsed time from a startMs timestamp. */
function elapsed(startMs) {
  const ms = Date.now() - startMs;
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Omit keys from an object (immutable — returns a new object).
 * Used by AuditLogger (Step 3) to strip sensitive fields from snapshots.
 */
function omitKeys(obj, keys) {
  if (!obj || !keys || keys.length === 0) return obj;
  const keySet = new Set(keys);
  return Object.fromEntries(
    Object.entries(obj).filter(([k]) => !keySet.has(k))
  );
}

/**
 * Deep-diff two plain objects — returns a map of { field: { before, after } }
 * for every field whose value changed.
 * Shallow only (one level deep) — sufficient for audit snapshots.
 */
function shallowDiff(before, after) {
  const keys = new Set([
    ...Object.keys(before || {}),
    ...Object.keys(after  || {}),
  ]);
  const diff = {};
  for (const key of keys) {
    const bVal = before?.[key];
    const aVal = after?.[key];
    if (JSON.stringify(bVal) !== JSON.stringify(aVal)) {
      diff[key] = { before: bVal, after: aVal };
    }
  }
  return diff;
}

module.exports = { escapeRegex, isValidObjectId, elapsed, omitKeys, shallowDiff };
