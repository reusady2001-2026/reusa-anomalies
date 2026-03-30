// Vercel serverless function — no external dependencies, native fetch only.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function sbFetch(supabaseUrl, anonKey, path, opts = {}) {
  return fetch(`${supabaseUrl}/rest/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        anonKey,
      'Authorization': `Bearer ${anonKey}`,
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, res) {
  // ── Preflight ────────────────────────────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    res.writeHead(200, CORS_HEADERS);
    res.end();
    return;
  }

  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'GET') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ success: false, error: 'Supabase env vars not configured' });
    return;
  }

  try {
    const fetchRes = await sbFetch(
      SUPABASE_URL, SUPABASE_ANON_KEY,
      '/rule_candidates' +
        '?status=eq.candidate' +
        '&distinct_property_count=gte.3' +
        '&occurrences_since_last_dismissal=gte.20' +
        '&dismissal_count=lt.5' +
        '&select=id,metric_name,section,pattern_type,pattern_description,total_occurrences,distinct_property_count,dismissal_count,suggested_rules' +
        '&order=total_occurrences.desc' +
        '&limit=5',
      { method: 'GET' }
    );

    if (!fetchRes.ok) {
      const txt = await fetchRes.text();
      throw new Error(`rule_candidates fetch failed (${fetchRes.status}): ${txt}`);
    }

    const candidates = await fetchRes.json();
    res.status(200).json({ success: true, candidates: candidates || [] });

  } catch (err) {
    console.error('[get-rule-candidates] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
