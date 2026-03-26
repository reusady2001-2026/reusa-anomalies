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
  // ── Preflight ──────────────────────────────────────────────────────────────
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

  const { groupId, metricName, stateAbbr, monthNum, limit = '50' } = req.query;
  const maxRows = Math.min(parseInt(limit, 10) || 50, 500);

  try {
    // ── Anomalies query ────────────────────────────────────────────────────
    // Supabase PostgREST: embed properties via foreign key using select=
    // anomalies!inner(…),properties!inner(…) — or use the embedded resource
    // syntax anomalies(col,...,properties(col,...)) with an inner join.

    const anomalySelect = [
      'metric_name',
      'section',
      'month_label',
      'month_year',
      'month_num',
      'effective_z',
      'pnl',
      'dollar_deviation',
      'group_id',
      'group_name',
      'generated_by',
      'signal_count',
      'properties(name,state_abbr,city,asset_type)',
    ].join(',');

    const anomalyParams = new URLSearchParams({
      select: anomalySelect,
      limit:  String(maxRows),
      order:  'month_year.desc,month_num.desc',
    });
    if (groupId)    anomalyParams.set('group_id',    `eq.${groupId}`);
    if (metricName) anomalyParams.set('metric_name', `eq.${metricName}`);
    if (monthNum)   anomalyParams.set('month_num',   `eq.${monthNum}`);
    // stateAbbr filters on the embedded properties table
    if (stateAbbr)  anomalyParams.set('properties.state_abbr', `eq.${stateAbbr}`);

    const anomalyRes = await sbFetch(
      SUPABASE_URL, SUPABASE_ANON_KEY,
      `/anomalies?${anomalyParams}`,
      { headers: { 'Prefer': 'count=none' } }
    );

    if (!anomalyRes.ok) {
      const txt = await anomalyRes.text();
      throw new Error(`Anomalies query failed (${anomalyRes.status}): ${txt}`);
    }

    const rawAnomalies = await anomalyRes.json();

    // ── Patterns query ─────────────────────────────────────────────────────
    const patternSelect = [
      'group_id',
      'group_name',
      'month_label',
      'month_year',
      'month_num',
      'match_count',
      'matched_metrics',
      'avg_z',
      'properties(name,state_abbr,city,asset_type)',
    ].join(',');

    const patternParams = new URLSearchParams({
      select: patternSelect,
      limit:  String(maxRows),
      order:  'month_year.desc,month_num.desc',
    });
    if (groupId)   patternParams.set('group_id',  `eq.${groupId}`);
    if (monthNum)  patternParams.set('month_num', `eq.${monthNum}`);
    if (stateAbbr) patternParams.set('properties.state_abbr', `eq.${stateAbbr}`);

    const patternRes = await sbFetch(
      SUPABASE_URL, SUPABASE_ANON_KEY,
      `/patterns?${patternParams}`,
      { headers: { 'Prefer': 'count=none' } }
    );

    if (!patternRes.ok) {
      const txt = await patternRes.text();
      throw new Error(`Patterns query failed (${patternRes.status}): ${txt}`);
    }

    const rawPatterns = await patternRes.json();

    // ── Summary ────────────────────────────────────────────────────────────
    const propertyNames = new Set([
      ...rawAnomalies.map(r => r.properties?.name).filter(Boolean),
      ...rawPatterns.map(r => r.properties?.name).filter(Boolean),
    ]);

    res.status(200).json({
      anomalies: rawAnomalies,
      patterns:  rawPatterns,
      summary: {
        totalAnomalies:  rawAnomalies.length,
        totalPatterns:   rawPatterns.length,
        propertiesCount: propertyNames.size,
      },
    });

  } catch (err) {
    console.error('[get-history]', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
