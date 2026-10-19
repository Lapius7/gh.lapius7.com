// Persistent stale-while-revalidate cache. SQLite (node:sqlite, no deps) keeps values across restarts;
// without it the cache is memory-only. Entries marked final never expire (immutable past data).
const fs = require('fs');
const path = require('path');

let db = null, rd = null, wr = null;
try {
  const { DatabaseSync } = require('node:sqlite');
  const file = process.env.DB_PATH || path.join(__dirname, 'data', 'cache.sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL, t INTEGER NOT NULL, final INTEGER NOT NULL DEFAULT 0)');
  rd = db.prepare('SELECT v, t, final FROM kv WHERE k = ?');
  wr = db.prepare('INSERT INTO kv (k, v, t, final) VALUES (?, ?, ?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v, t = excluded.t, final = excluded.final');
} catch (e) { console.error('sqlite disabled, memory cache only:', e.message); }

const mem = new Map();
const inflight = new Map();

function load(k) {
  let e = mem.get(k);
  if (!e && rd) {
    try { const r = rd.get(k); if (r) { e = { t: r.t, v: JSON.parse(r.v), final: !!r.final }; mem.set(k, e); } }
    catch (err) { console.error('db read:', err.message); }
  }
  return e;
}

// One build per key at a time; a failed build keeps the previous value.
function refresh(k, build, isFinal) {
  let p = inflight.get(k);
  if (p) return p;
  p = (async () => {
    const v = await build();
    const e = { t: Date.now(), v, final: !!(isFinal && isFinal(v)) };
    mem.set(k, e);
    if (wr) try { wr.run(k, JSON.stringify(v), e.t, e.final ? 1 : 0); } catch (err) { console.error('db write:', err.message); }
    return v;
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
  return p;
}

// Returns the cached value at once, even if expired (refreshing in the background). Only a cold miss waits.
function cached(k, ttl, build, isFinal) {
  const e = load(k);
  if (!e) return refresh(k, build, isFinal);
  if (!e.final && Date.now() - e.t >= ttl) refresh(k, build, isFinal).catch((err) => console.error('refresh', k, err.message));
  return Promise.resolve(e.v);
}

module.exports = { cached };
