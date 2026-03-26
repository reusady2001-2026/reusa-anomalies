// Vercel serverless function — no external dependencies, native fetch only.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
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

  const { property, analysis, anomalies = [], patterns = [] } = req.body;

  try {
    // ── 1. Upsert property ─────────────────────────────────────────────────
    //   Match on name + state_abbr + city. Supabase upsert with onConflict
    //   returns the existing row via Prefer: resolution=merge-duplicates.
    const propUpsert = await sbFetch(SUPABASE_URL, SUPABASE_ANON_KEY, '/properties', {
      method: 'POST',
      headers: {
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify({
        name:        property.name,
        state_abbr:  property.stateAbbr,
        city:        property.city,
        asset_type:  property.assetType,
      }),
    });

    if (!propUpsert.ok) {
      const txt = await propUpsert.text();
      throw new Error(`Property upsert failed (${propUpsert.status}): ${txt}`);
    }

    const propRows = await propUpsert.json();
    const propertyId = Array.isArray(propRows) ? propRows[0]?.id : propRows?.id;
    if (!propertyId) throw new Error('Property upsert returned no id');

    // ── 2. Insert analysis ─────────────────────────────────────────────────
    const analysisInsert = await sbFetch(SUPABASE_URL, SUPABASE_ANON_KEY, '/analyses', {
      method: 'POST',
      headers: { 'Prefer': 'return=representation' },
      body: JSON.stringify({
        property_id:    propertyId,
        file_name:      analysis.fileName,
        month_count:    analysis.monthCount,
        period_start:   analysis.periodStart,
        period_end:     analysis.periodEnd,
        purchase_price: analysis.purchasePrice,
      }),
    });

    if (!analysisInsert.ok) {
      const txt = await analysisInsert.text();
      throw new Error(`Analysis insert failed (${analysisInsert.status}): ${txt}`);
    }

    const analysisRows = await analysisInsert.json();
    const analysisId = Array.isArray(analysisRows) ? analysisRows[0]?.id : analysisRows?.id;
    if (!analysisId) throw new Error('Analysis insert returned no id');

    // ── 3. Insert anomalies ────────────────────────────────────────────────
    if (anomalies.length > 0) {
      const anomalyRows = anomalies.map(a => ({
        property_id:      propertyId,
        analysis_id:      analysisId,
        metric_name:      a.metricName,
        section:          a.section,
        month_label:      a.monthLabel,
        month_year:       a.monthYear,
        month_num:        a.monthNum,
        effective_z:      a.effectiveZ,
        anomaly_type:     a.anomalyType,
        pnl:              a.pnl,
        dollar_deviation: a.dollarDeviation,
        pct_of_noi:       a.pctOfNoi,
        group_id:         a.groupId,
        group_name:       a.groupName,
        generated_by:     a.generatedBy,
        signal_count:     a.signalCount,
      }));

      const anomalyInsert = await sbFetch(SUPABASE_URL, SUPABASE_ANON_KEY, '/anomalies', {
        method: 'POST',
        body:   JSON.stringify(anomalyRows),
      });

      if (!anomalyInsert.ok) {
        const txt = await anomalyInsert.text();
        throw new Error(`Anomalies insert failed (${anomalyInsert.status}): ${txt}`);
      }
    }

    // ── 4. Insert patterns ─────────────────────────────────────────────────
    if (patterns.length > 0) {
      const patternRows = patterns.map(p => ({
        property_id:     propertyId,
        analysis_id:     analysisId,
        group_id:        p.groupId,
        group_name:      p.groupName,
        month_label:     p.monthLabel,
        month_year:      p.monthYear,
        month_num:       p.monthNum,
        match_count:     p.matchCount,
        matched_metrics: p.matchedMetrics,
        avg_z:           p.avgZ,
      }));

      const patternInsert = await sbFetch(SUPABASE_URL, SUPABASE_ANON_KEY, '/patterns', {
        method: 'POST',
        body:   JSON.stringify(patternRows),
      });

      if (!patternInsert.ok) {
        const txt = await patternInsert.text();
        throw new Error(`Patterns insert failed (${patternInsert.status}): ${txt}`);
      }
    }

    // ── 5. Success ─────────────────────────────────────────────────────────
    res.status(200).json({ success: true, propertyId, analysisId });

  } catch (err) {
    console.error('[save-analysis] error:', err);
    res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
}
