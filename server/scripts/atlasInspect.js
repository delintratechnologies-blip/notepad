/**
 * READ-ONLY Atlas inspection (Phases 2/3/5). No writes of any kind.
 * Connection string is read from env INSPECT_URI (never hardcoded).
 * Prints field NAMES + BSON types + presence — not raw document values —
 * so document contents (PII/secrets) are not exposed. Sensitive-named fields
 * are reported as <present> only.
 */
const { MongoClient } = require('mongodb');

const uri    = process.env.INSPECT_URI;
const TARGET = process.env.TARGET_DB || null;     // if set, only this db
const SAMPLE = parseInt(process.env.SAMPLE || '200', 10);
const SENSITIVE = /pass|secret|token|hash|cvv|card|otp|apikey|api_key|privatekey/i;

function bsonType(v) {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (Array.isArray(v)) return 'array';
  if (v && v._bsontype) return v._bsontype;          // ObjectId, Decimal128, etc.
  if (v instanceof Date) return 'date';
  return typeof v;                                    // string|number|boolean|object
}

function walk(doc, prefix, acc, depth) {
  for (const [k, v] of Object.entries(doc || {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    const t = bsonType(v);
    const e = acc[path] || (acc[path] = { types: new Set(), count: 0 });
    e.types.add(t);
    e.count++;
    if (t === 'object' && depth < 2 && !(v && v._bsontype)) walk(v, path, acc, depth + 1);
    if (t === 'array' && v.length && bsonType(v[0]) === 'object' && depth < 2) {
      walk(v[0], `${path}[]`, acc, depth + 1);
    }
  }
}

async function main() {
  if (!uri) { console.error('INSPECT_URI not set'); process.exit(1); }
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  console.log('CONNECTED OK\n');

  // ── Phase 1 (partial): list databases ───────────────────────────────────────
  const admin = client.db().admin();
  const { databases } = await admin.listDatabases();
  console.log('=== DATABASES ===');
  databases.forEach((d) => console.log(`  ${d.name}  (${(d.sizeOnDisk/1024/1024).toFixed(2)} MB)`));
  console.log('');

  const targets = TARGET ? [TARGET] : databases.map((d) => d.name).filter((n) => !['admin','local','config'].includes(n));

  for (const dbName of targets) {
    const db = client.db(dbName);
    const stats = await db.stats();
    console.log(`\n########## DATABASE: ${dbName} ##########`);
    console.log(`  collections=${stats.collections}  objects=${stats.objects}  dataSize=${(stats.dataSize/1024/1024).toFixed(2)}MB  indexes=${stats.indexes}  indexSize=${(stats.indexSize/1024/1024).toFixed(2)}MB`);

    const colls = await db.listCollections().toArray();
    if (!colls.length) { console.log('  (no collections)'); continue; }

    for (const c of colls) {
      const coll = db.collection(c.name);
      let count = 0;
      try { count = await coll.estimatedDocumentCount(); } catch {}
      console.log(`\n  ── collection: ${c.name}  (~${count} docs) ──`);

      // Indexes
      const idx = await coll.indexes();
      console.log('    indexes:');
      idx.forEach((i) => console.log(`      ${i.name}: ${JSON.stringify(i.key)}${i.unique ? ' UNIQUE' : ''}${i.expireAfterSeconds !== undefined ? ' TTL' : ''}${i.textIndexVersion ? ' TEXT' : ''}`));

      // collStats (size info)
      try {
        const cs = await db.command({ collStats: c.name });
        console.log(`    size: storage=${(cs.storageSize/1024).toFixed(1)}KB avgObj=${cs.avgObjSize||0}B nindexes=${cs.nindexes} totalIndex=${(cs.totalIndexSize/1024).toFixed(1)}KB`);
      } catch {}

      // Schema inference (field names + types only)
      const docs = await coll.find({}).limit(SAMPLE).toArray();
      const acc = {};
      docs.forEach((d) => walk(d, '', acc, 0));
      console.log(`    schema (sampled ${docs.length}):`);
      Object.keys(acc).sort().forEach((path) => {
        const { types, count: cnt } = acc[path];
        const pct = docs.length ? Math.round((cnt / docs.length) * 100) : 0;
        const sens = SENSITIVE.test(path) ? '  <sensitive: value hidden>' : '';
        console.log(`      ${path}: ${[...types].join('|')}  (${pct}%)${sens}`);
      });
    }
  }

  await client.close();
  console.log('\nDONE (read-only, no writes performed)');
}

main().catch((e) => { console.error('INSPECTION ERROR:', e.message); process.exit(1); });
