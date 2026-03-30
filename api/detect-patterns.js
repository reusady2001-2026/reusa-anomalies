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

async function fetchContextForPattern(stateAbbr, months) {
  const FRED_KEY = process.env.FRED_KEY;
  const STATE_CENTROIDS = {
    'AL':[32.8,-86.8],'AK':[64.2,-153.4],'AZ':[34.3,-111.1],'AR':[34.9,-92.4],
    'CA':[36.8,-119.4],'CO':[39.0,-105.5],'CT':[41.6,-72.7],'DE':[39.0,-75.5],
    'FL':[28.7,-82.5],'GA':[32.2,-83.4],'HI':[20.3,-156.4],'ID':[44.4,-114.6],
    'IL':[40.0,-89.2],'IN':[39.8,-86.1],'IA':[42.1,-93.5],'KS':[38.5,-98.4],
    'KY':[37.5,-85.3],'LA':[31.1,-91.9],'ME':[45.4,-69.2],'MD':[39.1,-76.8],
    'MA':[42.2,-71.5],'MI':[44.3,-85.4],'MN':[46.4,-93.1],'MS':[32.7,-89.7],
    'MO':[38.5,-92.5],'MT':[47.0,-109.6],'NE':[41.5,-99.9],'NV':[39.3,-116.6],
    'NH':[43.7,-71.6],'NJ':[40.1,-74.7],'NM':[34.4,-106.1],'NY':[42.9,-75.5],
    'NC':[35.5,-79.8],'ND':[47.5,-100.5],'OH':[40.4,-82.8],'OK':[35.6,-96.9],
    'OR':[44.6,-122.1],'PA':[40.6,-77.2],'RI':[41.7,-71.5],'SC':[33.9,-80.9],
    'SD':[44.4,-100.2],'TN':[35.8,-86.3],'TX':[31.5,-99.3],'UT':[39.3,-111.1],
    'VT':[44.1,-72.7],'VA':[37.8,-78.2],'WA':[47.4,-120.4],'WV':[38.6,-80.6],
    'WI':[44.3,-89.8],'WY':[43.0,-107.6]
  };

  const FRED_UR = {
    'NJ':'NJUR','NY':'NYUR','CA':'CAUR','TX':'TXUR','FL':'FLUR','PA':'PAUR',
    'IL':'ILUR','OH':'OHUR','GA':'GAUR','NC':'NCUR','MI':'MIUR','VA':'VAUR',
    'WA':'WAUR','AZ':'AZUR','MA':'MAUR','TN':'TNUR','IN':'INUR','MO':'MOUR',
    'MD':'MDUR','WI':'WIUR','CO':'COUR','MN':'MNUR','SC':'SCUR','AL':'ALUR',
    'LA':'LAUR','KY':'KYUR','OR':'ORUR','OK':'OKUR','CT':'CTUR','IA':'IAUR',
    'UT':'UTUR','NV':'NVUR','AR':'ARUR','MS':'MSUR','KS':'KSUR','NM':'NMUR',
    'NE':'NEUR','WV':'WVUR','ID':'IDUR','HI':'HIUR','NH':'NHUR','ME':'MEUR',
    'RI':'RIUR','MT':'MTUR','DE':'DEUR','SD':'SDUR','ND':'NDUR','AK':'AKUR',
    'VT':'VTUR','WY':'WYUR',
  };

  // Get date range from months array
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const parsedDates = months.map(m => {
    const parts = m.split(' ');
    const mo = monthNames.indexOf(parts[0]);
    const yr = parseInt(parts[1]);
    return mo >= 0 && !isNaN(yr) ? new Date(yr, mo, 1) : null;
  }).filter(Boolean).sort((a,b) => a-b);

  if (parsedDates.length === 0) return {};

  const startDate = `${parsedDates[0].getFullYear()}-${String(parsedDates[0].getMonth()+1).padStart(2,'0')}-01`;
  const lastDate = parsedDates[parsedDates.length-1];
  const endDate = `${lastDate.getFullYear()}-${String(lastDate.getMonth()+1).padStart(2,'0')}-01`;

  const results = {};

  try {
    // Fetch rent CPI
    const rentRes = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=CUUR0000SEHA&observation_start=${startDate}&observation_end=${endDate}&api_key=${FRED_KEY}&file_type=json`);
    const rentData = await rentRes.json();
    results.rentCPI = {};
    (rentData.observations || []).forEach(o => {
      const d = new Date(o.date);
      results.rentCPI[`${monthNames[d.getMonth()]} ${d.getFullYear()}`] = parseFloat(o.value);
    });
  } catch(e) {}

  try {
    // Fetch state unemployment
    const urCode = FRED_UR[stateAbbr];
    if (urCode) {
      const urRes = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=${urCode}&observation_start=${startDate}&observation_end=${endDate}&api_key=${FRED_KEY}&file_type=json`);
      const urData = await urRes.json();
      results.stateUR = {};
      (urData.observations || []).forEach(o => {
        const d = new Date(o.date);
        results.stateUR[`${monthNames[d.getMonth()]} ${d.getFullYear()}`] = parseFloat(o.value);
      });
    }
  } catch(e) {}

  try {
    // Fetch weather HDD/CDD
    const coords = STATE_CENTROIDS[stateAbbr];
    if (coords) {
      const weatherRes = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${coords[0]}&longitude=${coords[1]}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min&timezone=auto&temperature_unit=fahrenheit`);
      const weatherData = await weatherRes.json();
      const dates = weatherData?.daily?.time || [];
      const maxT = weatherData?.daily?.temperature_2m_max || [];
      const minT = weatherData?.daily?.temperature_2m_min || [];
      results.hdd = {};
      results.cdd = {};
      dates.forEach((dateStr, i) => {
        const d = new Date(dateStr);
        const label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
        const avg = ((maxT[i]||0) + (minT[i]||0)) / 2;
        results.hdd[label] = (results.hdd[label] || 0) + Math.max(0, 65 - avg);
        results.cdd[label] = (results.cdd[label] || 0) + Math.max(0, avg - 65);
      });
    }
  } catch(e) {}

  return results;
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

function generateReason(metricName, section, patternType, typicalMonths, anomalyHistory, context) {
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthLabels = (typicalMonths || []).map(m => monthNames[m-1]).filter(Boolean);

  const candidates = []; // { score, text }

  // Weather — only for expenses
  if (section === 'EXPENSES' && (patternType === 'seasonal_spike' || patternType === 'operational_drift')) {
    const avgHDD = monthLabels.reduce((sum, m) => {
      const vals = Object.entries(context.hdd || {})
        .filter(([k]) => k.startsWith(m)).map(([,v]) => v);
      return sum + (vals.length > 0 ? vals.reduce((a,b)=>a+b,0)/vals.length : 0);
    }, 0) / (monthLabels.length || 1);

    const avgCDD = monthLabels.reduce((sum, m) => {
      const vals = Object.entries(context.cdd || {})
        .filter(([k]) => k.startsWith(m)).map(([,v]) => v);
      return sum + (vals.length > 0 ? vals.reduce((a,b)=>a+b,0)/vals.length : 0);
    }, 0) / (monthLabels.length || 1);

    if (avgHDD > 600) candidates.push({ score: 3, text: `Weather data strongly supports this: heating degree days average ${Math.round(avgHDD)} during ${monthLabels.join(', ')} — well above the 65°F baseline, driving elevated heating demand and related maintenance costs.` });
    else if (avgHDD > 400) candidates.push({ score: 2, text: `Weather data supports this: heating degree days average ${Math.round(avgHDD)} during ${monthLabels.join(', ')} — above the 65°F baseline, consistent with elevated heating and weatherization demand.` });

    if (avgCDD > 300) candidates.push({ score: 3, text: `Weather data strongly supports this: cooling degree days average ${Math.round(avgCDD)} during ${monthLabels.join(', ')} — consistent with peak cooling demand, pool operations, and summer maintenance costs.` });
    else if (avgCDD > 150) candidates.push({ score: 2, text: `Weather data supports this: cooling degree days average ${Math.round(avgCDD)} during ${monthLabels.join(', ')} — above baseline, consistent with elevated cooling demand.` });
  }

  // Rent CPI — only for income
  if (section === 'INCOME' && context.rentCPI) {
    const spikePeriodVals = Object.entries(context.rentCPI)
      .filter(([k]) => monthLabels.some(m => k.startsWith(m))).map(([,v]) => v).filter(Boolean);
    const nonSpikePeriodVals = Object.entries(context.rentCPI)
      .filter(([k]) => !monthLabels.some(m => k.startsWith(m))).map(([,v]) => v).filter(Boolean);

    if (spikePeriodVals.length > 0 && nonSpikePeriodVals.length > 0) {
      const avgSpike = spikePeriodVals.reduce((a,b)=>a+b,0)/spikePeriodVals.length;
      const avgNon = nonSpikePeriodVals.reduce((a,b)=>a+b,0)/nonSpikePeriodVals.length;
      const diff = ((avgSpike - avgNon) / Math.abs(avgNon) * 100);
      if (Math.abs(diff) > 2) {
        const score = Math.abs(diff) > 5 ? 3 : 2;
        candidates.push({ score, text: `Rent CPI during ${monthLabels.join(', ')} averaged ${avgSpike.toFixed(1)} vs. ${avgNon.toFixed(1)} in other months (${diff > 0 ? '+' : ''}${diff.toFixed(1)}% ${diff > 0 ? 'higher' : 'lower'}) — ${diff > 0 ? 'market rents are measurably higher in these months, supporting the seasonal income pattern' : 'market rents are slightly softer in these months, suggesting the income movement has a property-specific driver'}.` });
      }
    }
  }

  // Lease cycle — only for income, specific months
  if (section === 'INCOME') {
    const hasSep = typicalMonths?.includes(9);
    const hasOct = typicalMonths?.includes(10);
    const hasJan = typicalMonths?.includes(1);
    const hasFeb = typicalMonths?.includes(2);

    if ((hasSep || hasOct) && (hasJan || hasFeb)) {
      candidates.push({ score: 3, text: `The spike months align with the academic lease cycle: September/October mark the start of new leases, and January/February mark common renewal or step-up dates. In markets like New Jersey with large university and corporate populations, this creates a predictable annual income rhythm.` });
    } else if (hasSep || hasOct) {
      candidates.push({ score: 2, text: `September/October align with the start of the academic year — a peak leasing period in most US markets, particularly in states with large university populations. New leases signed at higher rates drive income spikes in these months.` });
    } else if (hasJan || hasFeb) {
      candidates.push({ score: 2, text: `January/February are common lease renewal months — many leases signed in September/October come up for renewal or step-up, which can drive income movement at the start of the calendar year.` });
    }
  }

  // Unemployment context — only add if no strong explanation found yet
  if (context.stateUR) {
    const urVals = Object.entries(context.stateUR)
      .filter(([k]) => monthLabels.some(m => k.startsWith(m)))
      .map(([,v]) => v).filter(Boolean);
    if (urVals.length > 0) {
      const avgUR = (urVals.reduce((a,b)=>a+b,0)/urVals.length);
      const topScore = candidates.length > 0 ? Math.max(...candidates.map(c => c.score)) : 0;
      // Only add unemployment context if no strong explanation found yet
      if (topScore < 3) {
        if (avgUR < 3.5) candidates.push({ score: 1, text: `State unemployment averaged ${avgUR.toFixed(1)}% during these months — an exceptionally tight labor market that strongly supports rental demand and may explain income strength.` });
        else if (avgUR > 6) candidates.push({ score: 1, text: `State unemployment averaged ${avgUR.toFixed(1)}% during these months — elevated unemployment that may be creating rental demand pressure worth monitoring.` });
      }
    }
  }

  // Sort by score descending, take top 2 max
  candidates.sort((a,b) => b.score - a.score);
  const selected = candidates.slice(0, 2);

  if (selected.length === 0) {
    return `No clear external factor identified from available market data. The pattern's consistency across ${[...new Set((anomalyHistory || []).map(a => a.propertyName))].length} properties and ${[...new Set((anomalyHistory || []).map(a => a.monthLabel?.split(' ')?.[1]))].filter(Boolean).length} years suggests it reflects a structural characteristic of your portfolio.`;
  }

  return selected.map(c => c.text).join('\n\n');
}

function generatePatternDescription(metricName, section, patternType, anomaliesForKey, typicalMonths, context) {
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

  // Per-property breakdown
  const propMonthMap = {};
  anomalies.forEach(a => {
    if (!a.propertyName || !a.monthLabel) return;
    const mo = a.monthLabel.split(' ')[0]; // e.g. "Jan"
    if (!propMonthMap[a.propertyName]) propMonthMap[a.propertyName] = new Set();
    propMonthMap[a.propertyName].add(mo);
  });

  const propBreakdown = Object.entries(propMonthMap)
    .map(([prop, months]) => `  • ${prop}: spikes in ${[...months].join(', ')}`)
    .join('\n');

  if (propBreakdown) {
    lines.push('');
    lines.push('Per-property breakdown:');
    lines.push(propBreakdown);
  }

  // Check if months form a coherent seasonal pattern
  const WINTER_MONTHS = new Set([12, 1, 2]);
  const SPRING_MONTHS = new Set([3, 4, 5]);
  const SUMMER_MONTHS = new Set([6, 7, 8]);
  const FALL_MONTHS = new Set([9, 10, 11]);

  const seasons = {
    winter: (typicalMonths || []).filter(m => WINTER_MONTHS.has(m)).length,
    spring: (typicalMonths || []).filter(m => SPRING_MONTHS.has(m)).length,
    summer: (typicalMonths || []).filter(m => SUMMER_MONTHS.has(m)).length,
    fall: (typicalMonths || []).filter(m => FALL_MONTHS.has(m)).length,
  };

  const dominantSeason = Object.entries(seasons).sort((a,b) => b[1]-a[1])[0];
  const totalMonths = (typicalMonths || []).length;
  const isCoherent = totalMonths <= 3 && dominantSeason[1] >= totalMonths - 1;
  const isSpread = totalMonths >= 4 ||
    Object.values(seasons).filter(v => v > 0).length >= 3;

  if (isSpread) {
    lines.push('');
    lines.push('⚠ Note: The spike months span multiple seasons (' +
      Object.entries(seasons).filter(([,v]) => v > 0).map(([s,v]) => `${v} in ${s}`).join(', ') +
      '). This may indicate the pattern is not purely seasonal — it could reflect a recurring operational cycle, billing pattern, or data artifact. Review the per-property breakdown above to see if different properties are driving different months.');
  }

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

  if (context) {
    const reason = generateReason(metricName, section, patternType, typicalMonths, anomaliesForKey, context);
    if (reason) {
      lines.push('');
      lines.push('Why this pattern occurs:');
      lines.push('');
      lines.push(reason);
    }
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

    const allMonthLabels = [...new Set(anomalies.map(a => a.monthLabel).filter(Boolean))];
    const stateAbbrForContext = anomalies[0]?.stateAbbr || 'NJ';
    const externalContext = await fetchContextForPattern(stateAbbrForContext, allMonthLabels);

    let processed = 0;

    for (const anomaly of anomalies) {
      const { metricName, angle, propertyName, section, monthLabel, effectiveZ, stateAbbr } = anomaly;

      const pattern_type = ANGLE_TO_PATTERN[angle];
      if (!pattern_type) continue;

      const anomaliesForKey   = anomaliesByKey.get(`${metricName}|${pattern_type}`) || [];
      const typicalMonths     = getTypicalMonths(`${metricName}|${pattern_type}`);
      const pattern_description = generatePatternDescription(metricName, section, pattern_type, anomaliesForKey, typicalMonths, externalContext);

      // Current anomaly entry for history accumulation
      const currentEntry = {
        metricName,
        section,
        monthLabel: monthLabel || '',
        propertyName: propertyName || '',
        effectiveZ: effectiveZ || 0,
        patternType: pattern_type,
        stateAbbr: stateAbbr || '',
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
            state_abbr:                       stateAbbr || '',
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
        const newPatternDescription = generatePatternDescription(metricName, section, pattern_type, newHistory, newTypicalMonths, externalContext);
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
              state_abbr:                       stateAbbr || '',
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
