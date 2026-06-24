/**
 * RelationshipRegistry — in-memory map of all declared cross-collection
 * relationships.
 *
 * Relationships are declared in stitcher.config.js, not stored in MongoDB.
 * They are consumed by JoinResolver (Step 5 — UnifiedQuery) to resolve
 * populate() calls by name rather than by scattered hardcoded field strings.
 *
 * Supported relationship types:
 *   belongsTo — the "from" collection holds a foreign key pointing to "to".
 *   hasMany   — the "to" collection holds a foreign key pointing to "from".
 */

const VALID_TYPES = ['belongsTo', 'hasMany'];

class RelationshipRegistry {
  constructor() {
    this._relationships = [];
  }

  /**
   * Declare one or more relationships.
   * @param {Array<RelationshipDescriptor>} descriptors
   *
   * RelationshipDescriptor shape:
   * {
   *   from:  string  — source collection name
   *   field: string  — foreign key field name on the source document
   *   to:    string  — target collection name
   *   as:    string  — alias used when resolving/populating (optional, defaults to field)
   *   type:  string  — 'belongsTo' | 'hasMany'
   * }
   */
  declare(descriptors) {
    for (const descriptor of descriptors) {
      this._validateDescriptor(descriptor);
      this._relationships.push({
        from:  descriptor.from,
        field: descriptor.field,
        to:    descriptor.to,
        as:    descriptor.as || descriptor.field,
        type:  descriptor.type,
      });
    }
    return this;
  }

  /** All declared relationships. */
  all() {
    return [...this._relationships];
  }

  /** Total number of declared relationships. */
  count() {
    return this._relationships.length;
  }

  /**
   * All outbound relationships from a given collection.
   * Used by JoinResolver to resolve .with('alias') calls.
   */
  forCollection(collectionName) {
    return this._relationships.filter((r) => r.from === collectionName);
  }

  /**
   * Find a specific relationship by its source collection and alias.
   * Returns null if not found.
   */
  find(collectionName, alias) {
    return this._relationships.find(
      (r) => r.from === collectionName && r.as === alias
    ) || null;
  }

  /**
   * Validate that all declared relationships reference registered collections.
   * Called by DataStitcher.initialize() after all collections are registered.
   */
  validateAgainst(collectionRegistry) {
    const errors = [];
    for (const rel of this._relationships) {
      if (!collectionRegistry.has(rel.from)) {
        errors.push(`Relationship '${rel.from}.${rel.field}' references unregistered collection '${rel.from}'`);
      }
      if (!collectionRegistry.has(rel.to)) {
        errors.push(`Relationship '${rel.from}.${rel.field} → ${rel.to}' references unregistered collection '${rel.to}'`);
      }
    }
    if (errors.length > 0) {
      throw new Error(`[RelationshipRegistry] Validation failed:\n  ${errors.join('\n  ')}`);
    }
  }

  _validateDescriptor(rel) {
    const required = ['from', 'field', 'to', 'type'];
    for (const key of required) {
      if (!rel[key]) {
        throw new Error(`[RelationshipRegistry] Descriptor missing '${key}': ${JSON.stringify(rel)}`);
      }
    }
    if (!VALID_TYPES.includes(rel.type)) {
      throw new Error(
        `[RelationshipRegistry] Invalid type '${rel.type}' in descriptor for '${rel.from}.${rel.field}'. ` +
        `Valid types: ${VALID_TYPES.join(', ')}`
      );
    }
  }
}

module.exports = RelationshipRegistry;
