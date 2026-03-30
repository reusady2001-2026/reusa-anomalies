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

function computeTypicalMonths(historyArray) {
  const freq = new Map();
  for (const h of historyArray) {
    const monthNum = MONTH_ABBR_TO_NUM[(h.monthLabel || '').split(' ')[0]];
    if (monthNum) freq.set(monthNum, (freq.get(monthNum) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 3)
    .map(([m]) => m);
}

function generatePatternDescription(metricName, section, patternType, anomaliesForKey, typicalMonths) {
  // ── Data computation ───────────────────────────────────────────────────────
  const properties = [...new Set((anomaliesForKey || []).map(a => a.propertyName).filter(Boolean))];
  const years = [...new Set(
    (anomaliesForKey || [])
      .map(a => (a.monthLabel || '').split(' ')[1])
      .filter(Boolean)
  )].sort();
  const zScores = (anomaliesForKey || []).map(a => Math.abs(a.effectiveZ || 0)).filter(z => z > 0);
  const avgZ = zScores.length
    ? (zScores.reduce((s, z) => s + z, 0) / zScores.length).toFixed(1)
    : '?';
  const maxZ = zScores.length ? Math.max(...zScores).toFixed(1) : '?';
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthStr = (typicalMonths || []).map(m => monthNames[m - 1]).filter(Boolean).join(', ');
  const anomalies = anomaliesForKey || [];

  const lines = [];

  switch (patternType) {
    case 'seasonal_spike':
      lines.push(`${metricName} spikes every year during ${monthStr || 'specific months'} — this has happened ${anomalies.length} times across ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} (${properties.join(', ')}) over ${years.length} year(s) (${years.join(', ')}).`);
      lines.push(`The average statistical deviation is ${avgZ}x the baseline, peaking at ${maxZ}x — a strong, consistent signal.`);
      lines.push(`This is not a problem. This is your business cycle.`);
      lines.push(`${section === 'INCOME' ? 'This income metric follows a predictable seasonal revenue pattern that repeats across your entire portfolio.' : 'This expense category follows a predictable seasonal cost pattern that repeats across your entire portfolio.'}`);
      lines.push(`The engine is currently flagging this as an anomaly every time it occurs — meaning it competes for your attention alongside real problems.`);
      lines.push(`Adding a rule here tells the engine: "I already know about this. Stop flagging it as an anomaly during these months, and focus my attention on deviations that exceed the seasonal norm instead."`);
      lines.push(`Without this rule: every summer/winter you will see these flagged as anomalies, burying actual issues in noise.`);
      lines.push(`With this rule: only unexpected deviations from the seasonal pattern will surface — the engine works harder for you.`);
      break;

    case 'operational_drift':
      lines.push(`${metricName} has been gradually drifting ${section === 'INCOME' ? 'below' : 'above'} baseline across ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} (${properties.join(', ')}) for ${years.length} year(s) (${years.join(', ')}).`);
      lines.push(`This has occurred ${anomalies.length} times with an average deviation of ${avgZ}x baseline, peaking at ${maxZ}x.`);
      lines.push(`${section === 'INCOME'
        ? 'A drift this persistent across multiple properties is not a random fluctuation — it suggests a structural revenue gap. This could mean lease terms below market rate, a systematic billing issue, or a portfolio-wide income leak that no one has addressed because it moves slowly.'
        : 'A drift this persistent across multiple properties is not a random fluctuation — it suggests vendor contract escalation, usage creep, or an unreviewed recurring charge that has been quietly growing for years.'}`);
      lines.push(`The engine is currently treating each occurrence as a separate anomaly — ${anomalies.length} individual flags for what is actually one ongoing pattern.`);
      lines.push(`Adding a rule here changes the response: instead of ${anomalies.length} individual property-level flags, the engine escalates this once at the portfolio level and recommends a ${section === 'INCOME' ? 'lease audit' : 'vendor contract review'}.`);
      lines.push(`Without this rule: the drift continues to generate noise across all properties with no clear action path.`);
      lines.push(`With this rule: the engine identifies this as a portfolio-level structural issue and directs your attention to the right fix.`);
      break;

    case 'cost_shock':
      lines.push(`${metricName} has spiked suddenly ${anomalies.length} times across ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} (${properties.join(', ')}) over ${years.length} year(s) (${years.join(', ')}).`);
      lines.push(`Average deviation: ${avgZ}x baseline. Peak deviation: ${maxZ}x baseline.`);
      lines.push(`Recurring cost shocks on the same metric are rarely random — they usually indicate a vendor with unpredictable billing, an irregular service cycle, or an unmanaged variable cost that spikes when triggered.`);
      lines.push(`The fact that this has happened ${anomalies.length} times across ${properties.length} properties means this is a known risk, not a surprise. Yet the engine treats each spike as a new anomaly requiring fresh investigation.`);
      lines.push(`Adding a rule here changes the response: when ${metricName} spikes, the engine immediately flags it for vendor contract review rather than generic investigation — saving you the time of rediscovering the same root cause repeatedly.`);
      lines.push(`Without this rule: every spike triggers a full anomaly investigation that likely reaches the same conclusion each time.`);
      lines.push(`With this rule: the engine routes directly to the right action — vendor review — and tracks whether the pattern is getting better or worse over time.`);
      break;

    case 'market_pressure':
      lines.push(`${metricName} has moved with broader market conditions ${anomalies.length} times across ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} (${properties.join(', ')}) over ${years.length} year(s).`);
      lines.push(`Average deviation: ${avgZ}x baseline. Peak: ${maxZ}x. These movements correlate with elevated CPI, Fed Funds Rate, or mortgage rate environments.`);
      lines.push(`When a metric moves because the entire market moved, investigating it at the property level is wasted effort — there is nothing a property manager can do about national interest rates.`);
      lines.push(`The engine is currently flagging these as property-level anomalies, implying there is something wrong at the property that needs fixing. There isn't.`);
      lines.push(`Adding a rule here tells the engine: "When macro indicators explain this movement, classify it as market-driven and lower the investigation priority. Only flag it if the movement exceeds what market conditions would predict."`);
      lines.push(`Without this rule: your team investigates market-driven movements as if they were property problems — wasting time and creating false urgency.`);
      lines.push(`With this rule: the engine distinguishes between market noise and genuine property-level issues, making every flag more meaningful.`);
      break;

    case 'unexplained':
      lines.push(`${metricName} has shown ${anomalies.length} unexplained anomalies across ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} (${properties.join(', ')}) over ${years.length} year(s).`);
      lines.push(`Average deviation: ${avgZ}x baseline. Peak: ${maxZ}x. The engine cannot identify a causal pattern from available data.`);
      lines.push(`${section === 'INCOME'
        ? 'Recurring unexplained income anomalies that the engine cannot explain are a red flag. When the same income metric drops repeatedly with no identifiable cause, it often points to a lease audit issue, a systematic billing error, or a tenant arrangement that is not being captured in the data.'
        : 'Recurring unexplained expense anomalies that the engine cannot explain are a red flag. When the same cost spikes repeatedly with no identifiable cause, it often points to invoice coding errors, a vendor billing irregularity, or an unreviewed contract with automatic escalation clauses.'}`);
      lines.push(`The engine has flagged this ${anomalies.length} times and reached the same conclusion each time: unknown cause, manual review recommended. That recommendation has clearly not led to a resolution.`);
      lines.push(`Adding a rule here escalates the response: instead of repeating the same "manual review" flag, the engine triggers a ${section === 'INCOME' ? 'lease audit recommendation' : 'vendor invoice reconciliation'} and tracks whether the pattern resolves after that action.`);
      lines.push(`Without this rule: the engine keeps flagging and recommending manual review with no progress.`);
      lines.push(`With this rule: the engine escalates to the right action and monitors for resolution.`);
      break;

    default:
      lines.push(`${metricName} shows a recurring ${patternType.replace(/_/g, ' ')} pattern across ${properties.length} propert${properties.length === 1 ? 'y' : 'ies'} — ${anomalies.length} occurrences over ${years.length} year(s). Average deviation: ${avgZ}x baseline.`);
  }

  return lines.join('\n\n');
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
    // ── Pre-compute per-key data ───────────────────────────────────────────────
    const monthFreq     = new Map(); // key -> Map<monthNum, count>
    const anomaliesByKey = new Map(); // key -> anomaly[]
    for (const a of anomalies) {
      const pt = ANGLE_TO_PATTERN[a.angle];
      if (!pt) continue;
      const key = `${a.metricName}|${pt}`;
      // month frequency
      const monthNum = MONTH_ABBR_TO_NUM[(a.monthLabel || '').split(' ')[0]];
      if (monthNum) {
        if (!monthFreq.has(key)) monthFreq.set(key, new Map());
        const freq = monthFreq.get(key);
        freq.set(monthNum, (freq.get(monthNum) || 0) + 1);
      }
      // anomalies by key
      if (!anomaliesByKey.has(key)) anomaliesByKey.set(key, []);
      anomaliesByKey.get(key).push(a);
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

      const anomaliesForKey   = anomaliesByKey.get(`${metricName}|${pattern_type}`) || [];
      const typicalMonths     = getTypicalMonths(`${metricName}|${pattern_type}`);
      const pattern_description = generatePatternDescription(metricName, section, pattern_type, anomaliesForKey, typicalMonths);

      // Current anomaly entry for history accumulation
      const currentEntry = {
        metricName,
        section,
        monthLabel: anomaly.monthLabel || '',
        propertyName: propertyName || '',
        effectiveZ: anomaly.effectiveZ || 0,
        patternType: pattern_type,
      };

      // ── Fetch existing row ─────────────────────────────────────────────────
      const fetchRes = await sbFetch(
        SUPABASE_URL, SUPABASE_ANON_KEY,
        `/rule_candidates?metric_name=eq.${encodeURIComponent(metricName)}&pattern_type=eq.${encodeURIComponent(pattern_type)}&select=id,status,dismissal_count,total_occurrences,occurrences_since_last_dismissal,distinct_properties,anomaly_history&limit=1`,
        { method: 'GET' }
      );

      if (!fetchRes.ok) {
        const txt = await fetchRes.text();
        throw new Error(`rule_candidates fetch failed (${fetchRes.status}): ${txt}`);
      }

      const rows = await fetchRes.json();
      const existing = rows && rows.length > 0 ? rows[0] : null;

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
            anomaly_history:                  JSON.stringify([currentEntry]),
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

        // Build full accumulated history and recompute descriptions from it
        const existingHistory = existing.anomaly_history
          ? (typeof existing.anomaly_history === 'string'
              ? JSON.parse(existing.anomaly_history)
              : existing.anomaly_history)
          : [];
        const newHistory = [...existingHistory, currentEntry];
        const newTypicalMonths = computeTypicalMonths(newHistory);
        const newPatternDescription = generatePatternDescription(metricName, section, pattern_type, newHistory, newTypicalMonths);
        const newSuggestedRules = generateSuggestedRules(metricName, section, pattern_type, newTypicalMonths);

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
              pattern_description:              newPatternDescription,
              suggested_rules:                  newSuggestedRules,
              anomaly_history:                  JSON.stringify(newHistory),
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
