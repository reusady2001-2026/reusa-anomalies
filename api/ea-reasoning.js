const FRED_KEY = process.env.FRED_KEY;

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

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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

const STATE_REGIONS = {
  Northeast: ['ME','NH','VT','MA','RI','CT','NY','NJ','PA'],
  Southeast: ['DE','MD','VA','WV','NC','SC','GA','FL','AL','MS','TN','KY','AR','LA'],
  Midwest: ['OH','IN','IL','MI','WI','MN','IA','MO','ND','SD','NE','KS'],
  Southwest: ['TX','OK','NM','AZ'],
  West: ['CO','WY','MT','ID','WA','OR','CA','NV','UT','AK','HI'],
};

function getRegion(stateAbbr) {
  for (const [region, states] of Object.entries(STATE_REGIONS)) {
    if (states.includes(stateAbbr)) return region;
  }
  return 'Unknown';
}

function parseMonthLabel(label) {
  // "Oct 2025" → { month: 10, year: 2025, date: Date }
  const parts = (label || '').split(' ');
  const mo = MONTH_NAMES.indexOf(parts[0]);
  const yr = parseInt(parts[1]);
  if (mo < 0 || isNaN(yr)) return null;
  return { month: mo + 1, year: yr, date: new Date(yr, mo, 1) };
}

async function fetchFREDSeries(seriesId, startDate, endDate) {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&observation_start=${startDate}&observation_end=${endDate}&api_key=${FRED_KEY}&file_type=json`;
    const res = await fetch(url);
    const data = await res.json();
    const result = {};
    (data.observations || []).forEach(o => {
      const d = new Date(o.date);
      const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      result[label] = parseFloat(o.value);
    });
    return result;
  } catch(e) { return {}; }
}

const FRED_UR_MAP = {
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

function generateReasoning(data) {
  const {
    categoryName, section, monthLabel, stateAbbr,
    dominantDriver, dominantPct, topDrivers, compositionType,
    trendType, oaContext, portfolioContext, externalContext,
    seasonalPattern, flag,
  } = data;

  const isIncome = section === 'INCOME';
  const isUp = flag.direction === 'up';
  const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString();
  const sentences = [];

  // ── Property-first: dominant driver ──────────────────────────────────────
  if (dominantDriver) {
    const driverDir = dominantDriver.direction === 'up' ? 'increased' : 'decreased';
    if (dominantPct && Math.abs(dominantPct) >= 60) {
      sentences.push(`${dominantDriver.name} ${driverDir} ${fmt(dominantDriver.absMovement)} vs the prior quarter, accounting for ${Math.abs(dominantPct)}% of the category movement.`);
    } else if (topDrivers.length >= 2) {
      const second = topDrivers[1];
      const secondDir = second.direction === 'up' ? 'up' : 'down';
      sentences.push(`${dominantDriver.name} ${driverDir} ${fmt(dominantDriver.absMovement)} while ${second.name} moved ${secondDir} ${fmt(second.absMovement)} — the two primary drivers of this category shift.`);
    } else {
      sentences.push(`${dominantDriver.name} ${driverDir} ${fmt(dominantDriver.absMovement)} vs the prior quarter.`);
    }
  }

  // ── Composition ───────────────────────────────────────────────────────────
  if (compositionType === 'mixed' && topDrivers.length >= 2) {
    const ups = topDrivers.filter(m => m.direction === 'up');
    const downs = topDrivers.filter(m => m.direction === 'down');
    if (ups.length > 0 && downs.length > 0) {
      sentences.push(`Movement is partially offset — ${ups.map(m => m.name).join(', ')} ${ups.length > 1 ? 'are' : 'is'} up while ${downs.map(m => m.name).join(', ')} ${downs.length > 1 ? 'are' : 'is'} down.`);
    }
  }

  // ── Trend ─────────────────────────────────────────────────────────────────
  if (trendType === 'accelerating') {
    sentences.push(`This movement is accelerating — each recent quarter has shown a larger shift than the prior one.`);
  } else if (trendType === 'decelerating') {
    sentences.push(`The trend is decelerating — movement is slowing compared to prior quarters.`);
  }

  // ── Seasonal ──────────────────────────────────────────────────────────────
  if (seasonalPattern?.recurring) {
    sentences.push(`This pattern has recurred in ${MONTH_NAMES[new Date(monthLabel).getMonth()] || monthLabel.split(' ')[0]} in ${seasonalPattern.years.join(', ')} — suggesting a seasonal component.`);
  }

  // ── Portfolio context ─────────────────────────────────────────────────────
  const sameState = portfolioContext.filter(p => p.locationProximity === 'same-state');
  const sameRegion = portfolioContext.filter(p => p.locationProximity === 'same-region');
  if (sameState.length >= 2) {
    sentences.push(`${sameState.length} other ${stateAbbr} properties show similar movement this month — suggesting a state-level driver.`);
  } else if (sameRegion.length >= 2) {
    sentences.push(`${sameRegion.length} properties in the same region show similar movement — consistent with a regional trend.`);
  }

  // ── External context (market as last resort) ──────────────────────────────
  const { fedfunds, rentCPI, stateUR, energyCPI, mortgage30, hdd, cdd } = externalContext || {};

  // Only add market context if we don't already have a strong property explanation
  if (sentences.length < 2) {
    if (isIncome && stateUR != null) {
      const laborContext = stateUR < 4 ? 'a tight labor market supporting rental demand'
        : stateUR > 6 ? 'elevated unemployment that may be pressuring demand'
        : `${stateUR.toFixed(1)}% state unemployment`;
      sentences.push(`Market context: ${laborContext}${mortgage30 ? ` with 30yr mortgage at ${mortgage30.toFixed(2)}%` : ''}.`);
    } else if (!isIncome && hdd != null && hdd > 400) {
      sentences.push(`Weather context: ${hdd} heating degree days in ${stateAbbr} — elevated cold-weather operating costs expected.`);
    } else if (!isIncome && cdd != null && cdd > 150) {
      sentences.push(`Weather context: ${cdd} cooling degree days — elevated summer utility and maintenance demand.`);
    } else if (!isIncome && energyCPI != null) {
      sentences.push(`Energy CPI at ${energyCPI.toFixed(1)} nationally may be contributing to cost pressure.`);
    }
  }

  // ── OA context (use internally to refine, not quote) ──────────────────────
  if (oaContext.length > 0) {
    const angles = [...new Set(oaContext.map(o => o.angle))];
    // If OA identified seasonal variance for metrics in this category, note it
    if (angles.includes('SEASONAL_VARIANCE') && !seasonalPattern?.recurring) {
      sentences.push(`Operational analysis identified seasonal patterns in individual metrics within this category this month.`);
    }
    // If OA identified market pressure, reinforce or soften based on property data
    if (angles.includes('MARKET_PRESSURE') && sentences.length < 3) {
      sentences.push(`Individual metric analysis also points to market-driven factors for components of this category.`);
    }
  }

  // ── Trim to 75 words ──────────────────────────────────────────────────────
  let result = sentences.join(' ');
  const words = result.split(' ');
  if (words.length > 80) {
    result = words.slice(0, 75).join(' ') + '…';
  }

  return result || `${categoryName} moved ${fmt(Math.abs(flag.T3_current - flag.T3_prior))} vs the prior quarter in ${monthLabel}. No dominant single driver identified — review individual metric breakdown above for details.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const {
    categoryName,
    section,
    monthLabel,
    metricBreakdown,   // [{name, T3_current, T3_prior, T12, values}]
    flag,              // full flag object
    stateAbbr,
    city,
    propertyName,
    purchasePrice,
    recentCategoryT3,  // last 3 months of category T3: [{monthLabel, T3}]
  } = req.body;

  const parsed = parseMonthLabel(monthLabel);
  if (!parsed) return res.status(400).json({ error: 'Invalid monthLabel' });

  const startDate = `${parsed.year - 1}-${String(parsed.month).padStart(2,'0')}-01`;
  const endDate = `${parsed.year}-${String(parsed.month).padStart(2,'0')}-01`;

  // ── Step 1: Dominant driver ──────────────────────────────────────────────
  const metricMovements = (metricBreakdown || [])
    .map(m => ({
      name: m.name,
      movement: (m.T3_current || 0) - (m.T3_prior || 0),
      absMovement: Math.abs((m.T3_current || 0) - (m.T3_prior || 0)),
      direction: (m.T3_current || 0) >= (m.T3_prior || 0) ? 'up' : 'down',
      T3_current: m.T3_current,
      T3_prior: m.T3_prior,
      T12: m.T12,
    }))
    .filter(m => m.absMovement > 0)
    .sort((a, b) => b.absMovement - a.absMovement);

  const totalMovement = (flag.T3_current || 0) - (flag.T3_prior || 0);
  const topDrivers = metricMovements.slice(0, 3);
  const dominantDriver = topDrivers[0] || null;
  const dominantPct = dominantDriver && totalMovement !== 0
    ? Math.round((dominantDriver.movement / totalMovement) * 100)
    : null;

  // ── Step 2: Composition analysis ────────────────────────────────────────
  const upCount = metricMovements.filter(m => m.direction === 'up').length;
  const downCount = metricMovements.filter(m => m.direction === 'down').length;
  let compositionType;
  if (upCount === 0 || downCount === 0) compositionType = 'broad-based';
  else if (dominantPct && Math.abs(dominantPct) >= 60) compositionType = 'single-driver';
  else compositionType = 'mixed';

  // ── Step 3: Trend acceleration ───────────────────────────────────────────
  let trendType = 'unknown';
  if (recentCategoryT3 && recentCategoryT3.length >= 2) {
    const movements = recentCategoryT3.map((r, i) => {
      if (i === 0) return null;
      return r.T3 - recentCategoryT3[i-1].T3;
    }).filter(Boolean);
    const isAccelerating = movements.every((m, i) => i === 0 || Math.abs(m) >= Math.abs(movements[i-1]));
    const isDecelerating = movements.every((m, i) => i === 0 || Math.abs(m) <= Math.abs(movements[i-1]));
    if (isAccelerating) trendType = 'accelerating';
    else if (isDecelerating) trendType = 'decelerating';
    else trendType = 'volatile';
  }

  // ── Step 4: OA context from Supabase ────────────────────────────────────
  let oaContext = [];
  try {
    const oaRes = await sbFetch(
      SUPABASE_URL, SUPABASE_ANON_KEY,
      `/analyses?property_name=eq.${encodeURIComponent(propertyName)}&select=anomalies,property_name&limit=10`,
      { method: 'GET' }
    );
    const analyses = oaRes.ok ? await oaRes.json() : null;

    if (analyses) {
      analyses.forEach(analysis => {
        const anomalies = typeof analysis.anomalies === 'string'
          ? JSON.parse(analysis.anomalies) : (analysis.anomalies || []);
        anomalies.forEach(a => {
          if (a.monthLabel === monthLabel &&
              (metricBreakdown || []).some(m => m.name === a.metricName)) {
            oaContext.push({
              metricName: a.metricName,
              angle: a.angle,
              primaryLabel: a.primary?.label || '',
              section: a.section,
            });
          }
        });
      });
    }
  } catch(e) {}

  // ── Step 5: Portfolio context from Supabase ──────────────────────────────
  let portfolioContext = [];
  try {
    const portRes = await sbFetch(
      SUPABASE_URL, SUPABASE_ANON_KEY,
      `/analyses?property_name=neq.${encodeURIComponent(propertyName)}&select=anomalies,property_name,state_abbr&limit=50`,
      { method: 'GET' }
    );
    const allAnalyses = portRes.ok ? await portRes.json() : null;

    if (allAnalyses) {
      const propertyRegion = getRegion(stateAbbr);
      allAnalyses.forEach(analysis => {
        const anomalies = typeof analysis.anomalies === 'string'
          ? JSON.parse(analysis.anomalies) : (analysis.anomalies || []);
        const matchingAnomalies = anomalies.filter(a =>
          a.monthLabel === monthLabel &&
          (metricBreakdown || []).some(m => m.name === a.metricName)
        );
        if (matchingAnomalies.length > 0) {
          const propRegion = getRegion(analysis.state_abbr || '');
          const locationProximity = analysis.state_abbr === stateAbbr ? 'same-state'
            : propRegion === propertyRegion ? 'same-region' : 'different-region';
          portfolioContext.push({
            propertyName: analysis.property_name,
            stateAbbr: analysis.state_abbr,
            locationProximity,
            anomalyCount: matchingAnomalies.length,
            directions: matchingAnomalies.map(a => a.direction || ''),
          });
        }
      });
    }
  } catch(e) {}

  // ── Step 6: External context ─────────────────────────────────────────────
  const externalContext = {};
  try {
    const [fedfunds, rentCPI, stateUR, energyCPI, mortgage30] = await Promise.all([
      fetchFREDSeries('FEDFUNDS', startDate, endDate),
      fetchFREDSeries('CUUR0000SEHA', startDate, endDate),
      fetchFREDSeries(FRED_UR_MAP[stateAbbr] || 'UNRATE', startDate, endDate),
      fetchFREDSeries('CUUR0000SEHE', startDate, endDate),
      fetchFREDSeries('MORTGAGE30US', startDate, endDate),
    ]);
    externalContext.fedfunds = fedfunds[monthLabel];
    externalContext.rentCPI = rentCPI[monthLabel];
    externalContext.stateUR = stateUR[monthLabel];
    externalContext.energyCPI = energyCPI[monthLabel];
    externalContext.mortgage30 = mortgage30[monthLabel];
  } catch(e) {}

  // Fetch weather
  try {
    const coords = STATE_CENTROIDS[stateAbbr];
    if (coords) {
      const weatherRes = await fetch(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${coords[0]}&longitude=${coords[1]}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min&timezone=auto&temperature_unit=fahrenheit`
      );
      const weatherData = await weatherRes.json();
      const dates = weatherData?.daily?.time || [];
      const maxT = weatherData?.daily?.temperature_2m_max || [];
      const minT = weatherData?.daily?.temperature_2m_min || [];
      let hdd = 0, cdd = 0, count = 0;
      dates.forEach((dateStr, i) => {
        const d = new Date(dateStr);
        const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
        if (label === monthLabel) {
          const avg = ((maxT[i]||0) + (minT[i]||0)) / 2;
          hdd += Math.max(0, 65 - avg);
          cdd += Math.max(0, avg - 65);
          count++;
        }
      });
      externalContext.hdd = Math.round(hdd);
      externalContext.cdd = Math.round(cdd);
    }
  } catch(e) {}

  // ── Step 7: Seasonal check ───────────────────────────────────────────────
  let seasonalPattern = null;
  try {
    const seasonRes = await sbFetch(
      SUPABASE_URL, SUPABASE_ANON_KEY,
      `/analyses?property_name=eq.${encodeURIComponent(propertyName)}&select=anomalies&limit=20`,
      { method: 'GET' }
    );
    const historicalAnalyses = seasonRes.ok ? await seasonRes.json() : null;

    if (historicalAnalyses) {
      const sameMonthPriorYears = [];
      historicalAnalyses.forEach(analysis => {
        const anomalies = typeof analysis.anomalies === 'string'
          ? JSON.parse(analysis.anomalies) : (analysis.anomalies || []);
        anomalies.forEach(a => {
          const aParsed = parseMonthLabel(a.monthLabel);
          if (aParsed && aParsed.month === parsed.month && aParsed.year < parsed.year &&
              (metricBreakdown || []).some(m => m.name === a.metricName)) {
            sameMonthPriorYears.push({ year: aParsed.year, metricName: a.metricName });
          }
        });
      });
      if (sameMonthPriorYears.length >= 2) {
        seasonalPattern = {
          recurring: true,
          occurrences: sameMonthPriorYears.length,
          years: [...new Set(sameMonthPriorYears.map(s => s.year))].sort(),
        };
      }
    }
  } catch(e) {}

  // ── Return structured reasoning data ─────────────────────────────────────
  const reasoning = generateReasoning({
    categoryName, section, monthLabel, stateAbbr,
    dominantDriver, dominantPct, topDrivers, compositionType,
    trendType, oaContext, portfolioContext, externalContext,
    seasonalPattern, flag,
  });

  return res.status(200).json({
    categoryName,
    section,
    monthLabel,
    stateAbbr,
    propertyName,
    dominantDriver,
    dominantPct,
    topDrivers,
    compositionType,
    trendType,
    oaContext,
    portfolioContext,
    externalContext,
    seasonalPattern,
    flag,
    reasoning,
  });
}
