/**
 * CollectionRegistry — in-memory map of registered Mongoose models.
 *
 * The registry is populated at startup by stitcher.config.js from the
 * existing Mongoose models. It is NOT stored in MongoDB — the models are
 * the authoritative schema source; this is a derived metadata index.
 */
class CollectionRegistry {
  constructor() {
    this._collections = new Map();
  }

  /**
   * Register a Mongoose model with metadata.
   * @param {string} name - Logical collection name (matches MongoDB collection).
   * @param {Model}  model - Mongoose model class.
   * @param {object} meta  - Metadata descriptor.
   */
  register(name, model, meta = {}) {
    if (this._collections.has(name)) {
      throw new Error(`[CollectionRegistry] '${name}' is already registered`);
    }
    if (!model || typeof model.find !== 'function') {
      throw new Error(`[CollectionRegistry] '${name}' — model must be a Mongoose Model`);
    }
    this._collections.set(name, {
      model,
      meta: {
        version:         meta.version         || 1,
        description:     meta.description     || '',
        owner:           meta.owner           || 'unassigned',
        tags:            Array.isArray(meta.tags)            ? meta.tags            : [],
        piiFields:       Array.isArray(meta.piiFields)       ? meta.piiFields       : [],
        sensitiveFields: Array.isArray(meta.sensitiveFields) ? meta.sensitiveFields : [],
      },
    });
    return this;
  }

  /**
   * Retrieve a registered collection entry.
   * @throws if the name is not registered.
   */
  get(name) {
    const entry = this._collections.get(name);
    if (!entry) throw new Error(`[CollectionRegistry] Unknown collection '${name}'`);
    return entry;
  }

  /** Returns true if the collection name is registered. */
  has(name) {
    return this._collections.has(name);
  }

  /** All registered names. */
  names() {
    return [...this._collections.keys()];
  }

  /** All entries as an array of { name, model, meta }. */
  all() {
    return [...this._collections.entries()].map(([name, entry]) => ({
      name,
      model: entry.model,
      meta:  entry.meta,
    }));
  }
}

module.exports = CollectionRegistry;
