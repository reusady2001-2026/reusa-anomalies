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

const MONTH_ABBR_TO_NUM = {
  Jan:1, Feb:2, Mar:3, Apr:4,  May:5,  Jun:6,
  Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12,
};

function generateSuggestedRules(metricName, section, patternType, typicalMonths) {
  const isIncome  = section === 'INCOME';
  const isExpense = section === 'EXPENSES';
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthStr = (typicalMonths || []).map(m => monthNames[m - 1]).filter(Boolean).join(', ');

  switch (patternType) {
    case 'seasonal_spike':
      return [
        `${metricName} consistently spikes in ${monthStr || 'recurring months'} across the portfolio — treat as expected seasonal behavior and do not flag as material anomaly during these months.`,
        `${metricName} seasonal pattern is portfolio-wide — when spike occurs in ${monthStr || 'seasonal months'}, reduce narrative priority to informational and note it as recurring.`,
        `Flag ${metricName} spikes in ${monthStr || 'seasonal months'} as seasonal variance only — suppress material anomaly classification unless deviation exceeds 2x the seasonal norm.`,
      ];

    case 'operational_drift':
      if (isIncome) return [
        `${metricName} has consistently drifted below baseline across the portfolio — treat as a structural income gap requiring portfolio-level review, not a property-specific anomaly.`,
        `${metricName} recurring drift suggests a systemic income shortfall pattern — flag once at portfolio level and reduce per-property anomaly priority.`,
        `When ${metricName} shows sustained drift below baseline across 3+ properties, escalate to asset management review rather than operational investigation.`,
      ];
      if (isExpense) return [
        `${metricName} has consistently run above baseline across the portfolio — likely reflects vendor contract escalation or usage creep. Treat as a known cost trend and monitor for acceleration rather than flagging as anomaly.`,
        `${metricName} recurring drift above baseline is a portfolio-wide cost pattern — lower narrative priority and trigger a vendor contract review recommendation instead.`,
        `When ${metricName} drifts above baseline for 3+ consecutive months across multiple properties, classify as cost trend rather than anomaly and recommend contract renegotiation.`,
      ];
      return [
        `${metricName} shows a recurring drift pattern across the portfolio — classify as a known structural trend rather than an anomaly.`,
        `${metricName} drift is portfolio-wide — reduce per-property anomaly priority and monitor at portfolio level.`,
      ];

    case 'cost_shock':
      return [
        `${metricName} shows recurring sudden cost spikes across the portfolio — classify as a recurring cost shock pattern and escalate for vendor contract review rather than one-time investigation.`,
        `When ${metricName} spikes suddenly across multiple properties in the same period, treat as a market-driven cost event rather than a property-specific anomaly.`,
        `${metricName} recurring cost shocks suggest a systemic vendor or market pricing issue — flag for portfolio-wide procurement review.`,
      ];

    case 'market_pressure':
      return [
        `${metricName} consistently moves with market conditions across the portfolio — when broad market indicators are elevated, treat movement as market-driven and reduce property-specific investigation priority.`,
        `${metricName} market pressure pattern is portfolio-wide — correlate with FRED macro indicators before flagging as property-specific anomaly.`,
        `When ${metricName} anomaly coincides with elevated Fed Funds Rate or CPI, classify as market-driven and lower anomaly severity tier.`,
      ];

    case 'unexplained':
      if (isIncome) return [
        `${metricName} shows recurring unexplained income anomalies across the portfolio — escalate to asset management for lease audit rather than operational investigation.`,
        `${metricName} recurring unexplained drops suggest a systematic lease or billing issue — trigger a portfolio-wide lease review recommendation.`,
      ];
      if (isExpense) return [
        `${metricName} shows recurring unexplained expense spikes across the portfolio — trigger a vendor invoice audit recommendation rather than classifying as one-time anomaly.`,
        `${metricName} recurring unexplained spikes suggest a billing or coding error pattern — recommend invoice reconciliation across all properties.`,
      ];
      return [
        `${metricName} shows a recurring unexplained pattern across the portfolio — escalate for manual review at portfolio level.`,
      ];

    default:
      return [
        `${metricName} shows a recurring ${patternType.replace(/_/g, ' ')} pattern across the portfolio — review and classify appropriately.`,
      ];
  }
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
    // ── Pre-compute typical months per (metricName, pattern_type) ─────────────
    const monthFreq = new Map(); // key -> Map<monthNum, count>
    for (const a of anomalies) {
      const pt = ANGLE_TO_PATTERN[a.angle];
      if (!pt) continue;
      const key = `${a.metricName}|${pt}`;
      const monthNum = MONTH_ABBR_TO_NUM[(a.monthLabel || '').split(' ')[0]];
      if (!monthNum) continue;
      if (!monthFreq.has(key)) monthFreq.set(key, new Map());
      const freq = monthFreq.get(key);
      freq.set(monthNum, (freq.get(monthNum) || 0) + 1);
    }
    function getTypicalMonths(key) {
      const freq = monthFreq.get(key);
      if (!freq) return [];
      return [...freq.entries()]
        .sort((a, b) => b[1] - a[1] || a[0] - b[0])
        .slice(0, 3)
        .map(([m]) => m);
    }

    let processed = 0;

    for (const anomaly of anomalies) {
      const { metricName, angle, propertyName, section } = anomaly;

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

      const typicalMonths   = getTypicalMonths(`${metricName}|${pattern_type}`);
      const suggested_rules = generateSuggestedRules(metricName, section, pattern_type, typicalMonths);

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
            suggested_rules,
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
              suggested_rules,
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
