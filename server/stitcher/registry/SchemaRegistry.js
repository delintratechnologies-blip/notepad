/**
 * SchemaRegistry — introspects Mongoose schema paths and stores field metadata
 * in memory for the duration of the process lifetime.
 *
 * A field is marked "sensitive" if:
 *   (a) its Mongoose schema option `select: false` is set, OR
 *   (b) it appears in the collection's declared `sensitiveFields` list.
 *
 * Sensitive field NAMES are stored and surfaced in health reports.
 * Sensitive field VALUES are never stored here.
 */
class SchemaRegistry {
  constructor() {
    this._schemas = new Map();
  }

  /**
   * Walk a Mongoose model's schema.paths and build a field metadata map.
   *
   * @param {string}   collectionName   - Logical name (same as CollectionRegistry key).
   * @param {Model}    mongooseModel    - Mongoose Model class.
   * @param {string[]} sensitiveFields  - Additional fields declared sensitive by the app.
   * @returns {object} Field map: { [path]: FieldMeta }
   */
  introspect(collectionName, mongooseModel, sensitiveFields = []) {
    const sensitiveSet = new Set(sensitiveFields);
    const paths = mongooseModel.schema.paths;
    const fields = {};

    for (const [path, schemaType] of Object.entries(paths)) {
      // Skip Mongoose internals (__v, etc.) — __v is the version key noise.
      if (path === '__v') continue;

      const opts = schemaType.options || {};

      const isSelectFalse = opts.select === false;
      const isDeclaredSensitive = sensitiveSet.has(path);
      const isSensitive = isSelectFalse || isDeclaredSensitive;

      fields[path] = {
        type:      schemaType.instance || typeof schemaType,
        required:  !!opts.required,
        indexed:   !!opts.index || !!opts.unique,
        unique:    !!opts.unique,
        // select:false fields are excluded from query results by default.
        selected:  !isSelectFalse,
        ref:       opts.ref || null,
        enum:      Array.isArray(opts.enum) ? opts.enum : null,
        hasMin:    opts.min !== undefined,
        hasMax:    opts.max !== undefined,
        hasDefault:opts.default !== undefined,
        sensitive:  isSensitive,
      };
    }

    this._schemas.set(collectionName, fields);
    return fields;
  }

  /**
   * Returns the field map for a collection, or null if not introspected.
   */
  get(collectionName) {
    return this._schemas.get(collectionName) || null;
  }

  /**
   * Returns field paths that are marked sensitive (select:false or declared).
   * Used by AuditLogger (Step 3) to redact before/after snapshots.
   */
  getSensitiveFields(collectionName) {
    const schema = this.get(collectionName);
    if (!schema) return [];
    return Object.entries(schema)
      .filter(([, meta]) => meta.sensitive)
      .map(([path]) => path);
  }

  /**
   * Returns field paths that contain PII (as declared in CollectionRegistry meta).
   * Separate from sensitiveFields: PII is personally identifying, not just secret.
   */
  getPiiFields(collectionName, piiFieldsList = []) {
    const schema = this.get(collectionName);
    if (!schema) return [];
    return piiFieldsList.filter((f) => f in schema);
  }

  /** All introspected schemas as { collectionName: fieldMap }. */
  all() {
    return Object.fromEntries(this._schemas.entries());
  }

  /**
   * Generate a human-readable schema document for a collection.
   * Safe to expose in the health endpoint — no field values, only structure.
   */
  generateDocs(collectionName) {
    const schema = this.get(collectionName);
    if (!schema) return null;
    return Object.entries(schema).map(([path, meta]) => ({
      field:     path,
      type:      meta.type,
      required:  meta.required,
      indexed:   meta.indexed,
      ref:       meta.ref,
      sensitive: meta.sensitive,
    }));
  }
}

module.exports = SchemaRegistry;
