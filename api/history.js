// Shared team learning pool, backed by Supabase.
//
// GET  /api/history  -> { records: [...] }  every coach's logged timings
// POST /api/history  -> merges posted records into the pool (duplicates ignored)
//
// Setup:
//   1. Run the SQL in README.md against your Supabase project (SQL Editor).
//   2. In Vercel -> Settings -> Environment Variables, add:
//        SUPABASE_URL                 (Supabase -> Project Settings -> Data API)
//        SUPABASE_SERVICE_ROLE_KEY    (same page, "service_role" secret)
//      Never put the service_role key in client-side code - it bypasses RLS.
//      It is safe here because this file only ever runs on the server.
//
// If the env vars are missing the endpoint degrades to an empty pool rather
// than erroring, so the app keeps working standalone.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TABLE = 'timing_records';

// Optional write gate. Set CONTRIBUTOR_KEY in Vercel env vars and only browsers
// holding that key may add to the pool; everyone else still reads it. Leave it
// unset and any user of the site can contribute.
const CONTRIBUTOR_KEY = process.env.CONTRIBUTOR_KEY;

function signature(r) {
  return `${r.key}|${r.ts}|${r.actualMinutes}`;
}

// app record -> database row
function toRow(r) {
  return {
    signature: signature(r),
    record_key: r.key,
    bucket: r.bucket,
    discipline: r.discipline,
    class_name: r.className,
    formula_type: r.formulaType,
    competitors: r.competitors,
    routines: r.routines,
    est_minutes: r.estMinutes,
    actual_minutes: r.actualMinutes,
    ts: r.ts
  };
}

// database row -> app record
function toRecord(row) {
  return {
    key: row.record_key,
    bucket: row.bucket,
    discipline: row.discipline,
    className: row.class_name,
    formulaType: row.formula_type,
    competitors: row.competitors,
    routines: row.routines,
    estMinutes: Number(row.est_minutes),
    actualMinutes: Number(row.actual_minutes),
    ts: Number(row.ts)
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!SUPABASE_URL || !SERVICE_KEY) {
    if (req.method === 'POST') {
      return res.status(200).json({ ok: true, added: 0, note: 'Supabase not configured' });
    }
    return res.status(200).json({ records: [], note: 'Supabase not configured' });
  }

  const base = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${TABLE}`;
  const auth = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    if (req.method === 'GET') {
      const r = await fetch(`${base}?select=*&order=ts.asc&limit=20000`, { headers: auth });
      if (!r.ok) throw new Error(`Supabase read ${r.status}: ${await r.text()}`);
      const rows = await r.json();
      return res.status(200).json({ records: rows.map(toRecord) });
    }

    if (req.method === 'POST') {
      if (CONTRIBUTOR_KEY) {
        const supplied = req.headers['x-contributor-key'];
        if (supplied !== CONTRIBUTOR_KEY) {
          return res.status(403).json({ error: 'read-only: contributor key required' });
        }
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const incoming = (body && body.records) || [];
      if (!Array.isArray(incoming)) {
        return res.status(400).json({ error: 'records must be an array' });
      }
      if (incoming.length === 0) {
        return res.status(200).json({ ok: true, added: 0 });
      }

      // Deduplicate within the batch first, then let the primary key on
      // `signature` ignore anything already in the pool.
      const seen = new Set();
      const rows = [];
      for (const rec of incoming) {
        const sig = signature(rec);
        if (seen.has(sig)) continue;
        seen.add(sig);
        rows.push(toRow(rec));
      }

      const r = await fetch(base, {
        method: 'POST',
        headers: {
          ...auth,
          Prefer: 'resolution=ignore-duplicates,return=representation'
        },
        body: JSON.stringify(rows)
      });
      if (!r.ok) throw new Error(`Supabase write ${r.status}: ${await r.text()}`);
      const inserted = await r.json();
      return res.status(200).json({
        ok: true,
        added: Array.isArray(inserted) ? inserted.length : 0,
        submitted: rows.length
      });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
