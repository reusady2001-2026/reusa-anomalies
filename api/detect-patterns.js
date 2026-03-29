// Vercel serverless function — no external dependencies, native fetch only.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const ANGLE_TO_PATTERN = {
  SEASONAL_VARIANCE:  'seasonal_spike',
  COST_SHOCK:         'cost_shock',
  MARKET_PRESSURE:    'market_pressure',
  OPERATIONAL_DRIFT:  'operational_drift',
  RECOVERY_STORY:     'recovery',
  PORTFOLIO_PATTERN:  'portfolio_pattern',
  ANOMALY_ALERT:      'unexplained',
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

  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: 'Method not allowed' });
    return;
  }

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ success: false, error: 'Supabase env vars not configured' });
    return;
  }

  const { anomalies = [] } = req.body;

  if (!Array.isArray(anomalies) || anomalies.length === 0) {
    res.status(200).json({ success: true, processed: 0 });
    return;
  }

  try {
    let processed = 0;

    for (const anomaly of anomalies) {
      const { metricName, angle, propertyName } = anomaly;

      const pattern_type = ANGLE_TO_PATTERN[angle];
      if (!pattern_type) continue;

      const pattern_description = `${metricName} shows ${pattern_type} pattern`;

      // ── Fetch existing row ─────────────────────────────────────────────────
      const fetchRes = await sbFetch(
        SUPABASE_URL, SUPABASE_ANON_KEY,
        `/rule_candidates?metric_name=eq.${encodeURIComponent(metricName)}&pattern_type=eq.${encodeURIComponent(pattern_type)}&select=id,status,dismissal_count,total_occurrences,occurrences_since_last_dismissal,distinct_properties&limit=1`,
        { method: 'GET' }
      );

      if (!fetchRes.ok) {
        const txt = await fetchRes.text();
        throw new Error(`rule_candidates fetch failed (${fetchRes.status}): ${txt}`);
      }

      const rows = await fetchRes.json();
      const existing = rows && rows.length > 0 ? rows[0] : null;

      if (!existing) {
        // ── Insert new row ───────────────────────────────────────────────────
        const insertRes = await sbFetch(SUPABASE_URL, SUPABASE_ANON_KEY, '/rule_candidates', {
          method: 'POST',
          body: JSON.stringify({
            metric_name:                      metricName,
            pattern_type,
            pattern_description,
            total_occurrences:                1,
            occurrences_since_last_dismissal: 1,
            distinct_properties:              propertyName ? [propertyName] : [],
            distinct_property_count:          propertyName ? 1 : 0,
            status:                           'candidate',
            dismissal_count:                  0,
          }),
        });

        if (!insertRes.ok) {
          const txt = await insertRes.text();
          throw new Error(`rule_candidates insert failed (${insertRes.status}): ${txt}`);
        }
      } else {
        // ── Skip retired or over-dismissed rows ──────────────────────────────
        if (existing.status === 'retired' || existing.dismissal_count >= 5) continue;

        // Deduplicate distinct_properties
        const prevProps = Array.isArray(existing.distinct_properties)
          ? existing.distinct_properties
          : [];
        const newProps = propertyName && !prevProps.includes(propertyName)
          ? [...prevProps, propertyName]
          : prevProps;

        const patchRes = await sbFetch(
          SUPABASE_URL, SUPABASE_ANON_KEY,
          `/rule_candidates?id=eq.${existing.id}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              total_occurrences:                (existing.total_occurrences || 0) + 1,
              occurrences_since_last_dismissal: (existing.occurrences_since_last_dismissal || 0) + 1,
              distinct_properties:              newProps,
              distinct_property_count:          newProps.length,
              pattern_description,
              updated_at:                       new Date().toISOString(),
            }),
          }
        );

        if (!patchRes.ok) {
          const txt = await patchRes.text();
          throw new Error(`rule_candidates patch failed (${patchRes.status}): ${txt}`);
        }
      }

      processed++;
    }

    res.status(200).json({ success: true, processed });

  } catch (err) {
    console.error('[detect-patterns] error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
}
