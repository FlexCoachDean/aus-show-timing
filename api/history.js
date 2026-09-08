// Shared team learning pool.
//
// GET  /api/history  -> { records: [...] }   every coach's logged timings
// POST /api/history  -> merges the posted records into the pool
//
// Storage: Vercel KV (Upstash Redis). Add it from your Vercel project
// dashboard: Storage -> Create -> KV. That injects KV_REST_API_URL and
// KV_REST_API_TOKEN automatically, and this file picks them up.
//
// If those env vars are absent the endpoint returns an empty pool rather
// than erroring, so the app still runs locally with no setup.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const KEY = 'flex_timing_history';
const MAX_RECORDS = 20000;

async function kv(command) {
  const res = await fetch(`${KV_URL}/${command.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  if (!res.ok) throw new Error(`KV ${res.status}`);
  return res.json();
}

async function kvSet(value) {
  const res = await fetch(`${KV_URL}/set/${KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
  });
  if (!res.ok) throw new Error(`KV set ${res.status}`);
  return res.json();
}

function signature(r) {
  return `${r.key}|${r.ts}|${r.actualMinutes}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (!KV_URL || !KV_TOKEN) {
    // Not configured yet — behave as an empty pool instead of failing.
    if (req.method === 'POST') return res.status(200).json({ ok: true, stored: 0, note: 'KV not configured' });
    return res.status(200).json({ records: [], note: 'KV not configured' });
  }

  try {
    let existing = [];
    try {
      const got = await kv(['get', KEY]);
      if (got && got.result) {
        const parsed = typeof got.result === 'string' ? JSON.parse(got.result) : got.result;
        if (Array.isArray(parsed)) existing = parsed;
      }
    } catch (e) {
      // treat a read failure as an empty pool rather than losing the write
      existing = [];
    }

    if (req.method === 'GET') {
      return res.status(200).json({ records: existing });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const incoming = (body && body.records) || [];
      if (!Array.isArray(incoming)) return res.status(400).json({ error: 'records must be an array' });

      const seen = new Set(existing.map(signature));
      let added = 0;
      for (const r of incoming) {
        const sig = signature(r);
        if (seen.has(sig)) continue;
        seen.add(sig);
        existing.push(r);
        added++;
      }
      if (existing.length > MAX_RECORDS) existing = existing.slice(-MAX_RECORDS);
      if (added > 0) await kvSet(existing);
      return res.status(200).json({ ok: true, added, total: existing.length });
    }

    return res.status(405).json({ error: 'method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: String(err.message || err) });
  }
}
