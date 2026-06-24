/**
 * QueryBuilder — fluent wrapper around a Mongoose Model.
 *
 * Created fresh by stitcher.query('collectionName') on every call.
 * Builder state accumulates via with/select/sort/limit/skip/paginate.
 * Execution methods (find/findOne/findById/create/…) apply accumulated
 * state to a Mongoose query and return the result.
 *
 * The Stitcher does NOT replace Mongoose. Routes that need transactions,
 * sessions, or advanced aggregations should use Mongoose models directly.
 * Use QueryBuilder for the common CRUD + named-join pattern.
 *
 * Usage:
 *   const docs = await stitcher.query('bookings')
 *     .with('hostUser', 'name avatar podcastName')
 *     .with('guestUser', 'name avatar')
 *     .sort({ slotStart: -1 })
 *     .paginate(page, limit)
 *     .find({ status: 'pending' });
 *
 *   const paged = await stitcher.query('users')
 *     .sort({ createdAt: -1 })
 *     .paginate(1, 20)
 *     .page({ role: 'host' });   // { docs, total, page, limit, pages }
 */

class QueryBuilder {
  /**
   * @param {string}               collectionName
   * @param {Model}                model              - Mongoose Model
   * @param {RelationshipRegistry} relationshipRegistry
   */
  constructor(collectionName, model, relationshipRegistry) {
    this._name  = collectionName;
    this._model = model;
    this._rels  = relationshipRegistry;

    // Accumulated modifiers.
    this._withs  = [];    // [{ path, select }]
    this._select = null;
    this._sort   = null;
    this._limit  = null;
    this._skip   = null;
  }

  // ── Builder methods (return this for chaining) ────────────────────────────

  /**
   * Add a named join declared in RelationshipRegistry.
   * @param {string} alias   - The `as` alias in stitcher.config.js relationships.
   * @param {string} [select] - Space-separated fields to include on the joined doc.
   */
  with(alias, select = null) {
    const rel = this._rels.find(this._name, alias);
    if (!rel) {
      throw new Error(
        `[QueryBuilder] No relationship '${alias}' declared for '${this._name}'. ` +
        `Check stitcher.config.js.`
      );
    }
    this._withs.push({ path: rel.field, select: select || undefined });
    return this;
  }

  /** Mongoose field projection — string or object. */
  select(fields) {
    this._select = fields;
    return this;
  }

  /** Sort — same format as Mongoose: { field: 1 } or '-field'. */
  sort(obj) {
    this._sort = obj;
    return this;
  }

  /** Maximum documents returned. */
  limit(n) {
    this._limit = Math.max(1, parseInt(n, 10));
    return this;
  }

  /** Number of documents to skip. */
  skip(n) {
    this._skip = Math.max(0, parseInt(n, 10));
    return this;
  }

  /**
   * Convenience: sets skip + limit from a page number and page size.
   * Clamps limit to [1, 100].
   */
  paginate(page, limit) {
    const lim  = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const pg   = Math.max(1, parseInt(page, 10) || 1);
    this._limit = lim;
    this._skip  = (pg - 1) * lim;
    return this;
  }

  // ── Execution methods ─────────────────────────────────────────────────────

  /**
   * Returns an array of matching documents.
   * Result is a Mongoose Query (thenable) — further Mongoose methods can be chained.
   */
  find(filter = {}) {
    return this._apply(this._model.find(filter));
  }

  /**
   * Returns the first matching document, or null.
   */
  findOne(filter = {}) {
    return this._apply(this._model.findOne(filter));
  }

  /**
   * Returns the document with the given _id, or null.
   */
  findById(id) {
    return this._apply(this._model.findById(id));
  }

  /**
   * Returns the count of matching documents.
   */
  count(filter = {}) {
    return this._model.countDocuments(filter);
  }

  /**
   * Creates one or more documents.
   * Passes through to Model.create() — no builder modifiers applied.
   */
  create(data) {
    return this._model.create(data);
  }

  /**
   * Finds the first matching document, applies changes, returns the updated doc.
   */
  update(filter, changes) {
    return this._model.findOneAndUpdate(filter, changes, {
      new:            true,
      runValidators:  true,
    });
  }

  /**
   * Finds by _id, applies changes, returns the updated doc.
   */
  updateById(id, changes) {
    return this._model.findByIdAndUpdate(id, changes, {
      new:           true,
      runValidators: true,
    });
  }

  /**
   * Deletes the first matching document. Returns the deleted doc.
   */
  delete(filter) {
    return this._model.findOneAndDelete(filter);
  }

  /**
   * Deletes by _id. Returns the deleted doc.
   */
  deleteById(id) {
    return this._model.findByIdAndDelete(id);
  }

  /**
   * Executes find(filter) + count(filter) in parallel and returns a
   * pagination envelope: { docs, total, page, limit, pages }.
   *
   * Requires paginate() to have been called first (otherwise limit defaults
   * to no restriction and page is reported as 1).
   */
  async page(filter = {}) {
    const [docs, total] = await Promise.all([
      this.find(filter),
      this.count(filter),
    ]);
    const limit = this._limit || docs.length;
    const pg    = this._skip !== null && limit > 0
      ? Math.floor(this._skip / limit) + 1
      : 1;

    return {
      docs,
      total,
      page:  pg,
      limit,
      pages: Math.ceil(total / limit) || 1,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _apply(mongooseQuery) {
    for (const pop of this._withs) {
      mongooseQuery = mongooseQuery.populate(pop);
    }
    if (this._select !== null) mongooseQuery = mongooseQuery.select(this._select);
    if (this._sort   !== null) mongooseQuery = mongooseQuery.sort(this._sort);
    if (this._limit  !== null) mongooseQuery = mongooseQuery.limit(this._limit);
    if (this._skip   !== null) mongooseQuery = mongooseQuery.skip(this._skip);
    return mongooseQuery;
  }
}

module.exports = QueryBuilder;
