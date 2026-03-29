// ============================================================
// CONTEXT.JS — Location selector data, API fetching, caching
// ============================================================

const Context = (() => {

  // ── STATE ABBREVIATION MAP ────────────────────────────
  const STATE_ABBR = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
    'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
    'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA',
    'Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD',
    'Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO',
    'Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ',
    'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH',
    'Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
    'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
    'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  };

  // FRED unemployment series per state
  const FRED_UR = {
    'AL':'ALUR','AK':'AKUR','AZ':'AZUR','AR':'ARUR','CA':'CAUR','CO':'COUR','CT':'CTUR',
    'DE':'DEUR','FL':'FLUR','GA':'GAUR','HI':'HIUR','ID':'IDUR','IL':'ILUR','IN':'INUR',
    'IA':'IAUR','KS':'KSUR','KY':'KYUR','LA':'LAUR','ME':'MEUR','MD':'MDUR','MA':'MAUR',
    'MI':'MIUR','MN':'MNUR','MS':'MSUR','MO':'MOUR','MT':'MTUR','NE':'NEUR','NV':'NVUR',
    'NH':'NHUR','NJ':'NJUR','NM':'NMUR','NY':'NYUR','NC':'NCUR','ND':'NDUR','OH':'OHUR',
    'OK':'OKUR','OR':'ORUR','PA':'PAUR','RI':'RIUR','SC':'SCUR','SD':'SDUR','TN':'TNUR',
    'TX':'TXUR','UT':'UTUR','VT':'VTUR','VA':'VAUR','WA':'WAUR','WV':'WVUR','WI':'WIUR',
    'WY':'WYUR',
  };

  // Census state FIPS codes
  const STATE_FIPS = {
    'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10',
    'FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19','KS':'20',
    'KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27','MS':'28',
    'MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35','NY':'36',
    'NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','RI':'44','SC':'45',
    'SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54',
    'WI':'55','WY':'56',
  };

  // ── CITY LOOKUP (countriesnow.space API, cached) ─────
  const _cityCache = {};

  async function fetchCitiesForState(stateAbbr) {
    // Convert abbr to full state name using STATE_ABBR (invert the map)
    const stateName = Object.keys(STATE_ABBR).find(
      name => STATE_ABBR[name] === stateAbbr
    );
    if (!stateName) return [];

    const url = 'https://countriesnow.space/api/v0.1/countries/state/cities';
    console.log('[Cities] fetching for:', stateName);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: 'United States', state: stateName })
    });
    console.log('[Cities] response status:', res.status);
    const data = await res.json();
    if (data.error || !Array.isArray(data.data)) {
      console.error('[Cities] unexpected response:', data);
      return [];
    }
    return data.data.sort();
  }

  async function getCitiesForState(stateAbbr) {
    if (_cityCache[stateAbbr]) return _cityCache[stateAbbr];
    const cities = await fetchCitiesForState(stateAbbr);
    _cityCache[stateAbbr] = cities;
    return cities;
  }

  const STATES = Object.entries(STATE_ABBR)
    .map(([name, abbr]) => ({ name, abbr }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── CACHE ─────────────────────────────────────────────
  const CACHE_KEY = 'oaas_context_v3'; // bumped to bust stale empty-FRED caches from pre-proxy era
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  function _cacheKey(stateAbbr, city, months) {
    const start = (months || [])[0] || '';
    const end   = (months || [])[(months || []).length - 1] || '';
    return `${stateAbbr}_${(city || '').replace(/\s+/g,'_')}_${start}_${end}`;
  }

  function loadCache(key) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const entry = all[key];
      if (!entry || Date.now() - entry.ts > 60 * 60 * 1000) return null;
      // Reject entries where FRED is entirely empty — cached during CORS failures
      const fred = entry.data?.fred || {};
      const hasFredData = Object.values(fred).some(map => Object.keys(map || {}).length > 0);
      if (!hasFredData) return null;
      return entry.data;
    } catch { return null; }
  }

  function saveCache(key, data) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      all[key] = { ts: Date.now(), data };
      const keys = Object.keys(all).sort((a, b) => (all[b].ts || 0) - (all[a].ts || 0));
      keys.slice(10).forEach(k => delete all[k]);
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch {}
  }

  // ── DATE UTILITIES ────────────────────────────────────
  const MO_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function monthLabelToDate(label) {
    if (!label) return null;
    const parts = String(label).split(' ');
    const m = MO_ABBR.indexOf(parts[0]);
    const y = parseInt(parts[1]);
    if (m < 0 || isNaN(y)) return null;
    return new Date(y, m, 1);
  }

  function dateToMonthLabel(d) {
    return `${MO_ABBR[d.getMonth()]} ${d.getFullYear()}`;
  }

  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dy}`;
  }

  function getDateRange(months) {
    if (!months || months.length === 0) return {};
    const first = monthLabelToDate(months[0]);
    const last  = monthLabelToDate(months[months.length - 1]);
    if (!first || !last) return {};
    // 13-month lookback so YoY calcs work
    const lookback = new Date(first.getFullYear(), first.getMonth() - 13, 1);
    const endDate  = new Date(last.getFullYear(), last.getMonth() + 1, 0); // last day
    return { startDate: toISO(lookback), endDate: toISO(endDate) };
  }

  // ── PROXY FETCH HELPER ────────────────────────────────
  async function proxyFetch(source, params, timeoutMs) {
    const qs   = new URLSearchParams({ source, ...params }).toString();
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), timeoutMs || 9000);
    try {
      const res = await fetch(`/api/proxy?${qs}`, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`proxy ${source}: HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(tid);
    }
  }

  // ── FRED API ──────────────────────────────────────────
  async function fetchFREDSeries(seriesId, startDate, endDate) {
    const json = await proxyFetch('fred', {
      series_id:         seriesId,
      observation_start: startDate,
      observation_end:   endDate,
    });
    if (json.error_message) throw new Error(`FRED ${seriesId}: ${json.error_message}`);
    const map = {};
    (json.observations || []).forEach(obs => {
      if (!obs.value || obs.value === '.') return;
      const d = new Date(obs.date + 'T00:00:00');
      map[dateToMonthLabel(d)] = parseFloat(obs.value);
    });
    return map;
  }

  async function fetchFRED(stateAbbr, startDate, endDate) {
    const urCode = FRED_UR[stateAbbr];
    const series = [
      ['FEDFUNDS',       'fedfunds'],
      ['CPIAUCSL',       'cpi'],
      ['CUUR0000SEHC',   'rentCPI'],
      ['HOUST',          'housingStarts'],
      ['MORTGAGE30US',   'mortgage30'],
      ['CUUR0000SAE',    'energyCPI'],
      ['CUUR0000SAM',    'medicalCPI'],
      ['CUUR0000SAH',    'housingCPI'],
      ['CUUR0000SAGL',   'transportCPI'],
      ['CES0500000003',  'avgHourlyEarnings'],
      ['WPUIP2311001',   'insurancePPI'],
      ['DGS10',          'treasury10y'],
      ['DGS2',           'treasury2y'],
      ['DPRIME',         'primeLoanRate'],
      ['COMREPUSQ159N',  'crePrice'],
    ];
    if (urCode) series.push([urCode, 'stateUR']);

    const settled = await Promise.allSettled(
      series.map(([id]) => fetchFREDSeries(id, startDate, endDate))
    );
    const out = {};
    series.forEach(([, key], i) => {
      out[key] = settled[i].status === 'fulfilled' ? settled[i].value : {};
    });
    return out;
  }

  // ── FEMA API ──────────────────────────────────────────
  async function fetchFEMA(stateAbbr, startDate, endDate) {
    const json = await proxyFetch('fema', { state: stateAbbr, startDate, endDate });
    return (json.DisasterDeclarationsSummaries || []).map(d => ({
      title: d.declarationTitle || '',
      date:  (d.declarationDate || '').slice(0, 10),
      type:  d.incidentType || '',
      number: String(d.disasterNumber || ''),
    }));
  }

  // ── CONGRESS.GOV API ──────────────────────────────────
  async function fetchCongress(startDate, endDate) {
    const json = await proxyFetch('congress', { startDate, endDate });
    const start = new Date(startDate);
    const end   = new Date(endDate);
    return (json.bills || [])
      .filter(b => {
        const d = new Date(b.introducedDate || '');
        return d >= start && d <= end;
      })
      .map(b => ({
        title:      b.title || '',
        number:     `${b.type || ''} ${b.number || ''}`.trim(),
        introduced: (b.introducedDate || '').slice(0, 10),
        congress:   String(b.congress || ''),
      }));
  }

  // ── OPENSTATES API ────────────────────────────────────
  async function fetchOpenStates(stateName, startDate, endDate) {
    const json = await proxyFetch('openstates', { stateName });
    const start = new Date(startDate);
    const end   = new Date(endDate);
    return (json.results || [])
      .filter(b => {
        const d = new Date(b.firstActionDate || b.createdAt || '');
        return isNaN(d) || (d >= start && d <= end);
      })
      .map(b => ({
        title:      b.title || '',
        id:         b.id || '',
        introduced: (b.firstActionDate || b.createdAt || '').slice(0, 10),
        session:    b.session || '',
      }));
  }

  // ── CENSUS ACS API ────────────────────────────────────
  async function fetchCensus(stateAbbr, city) {
    const fips = STATE_FIPS[stateAbbr];
    if (!fips) return {};
    const rows = await proxyFetch('census', { fips }, 10000);
    if (!Array.isArray(rows) || rows.length < 2) return {};
    const header = rows[0]; // ['NAME', 'B01003_001E', ...]
    const cityL  = city.toLowerCase().replace(/\s*city\s*$/i, '').trim();
    const match  = rows.slice(1).find(r => {
      const name = (r[0] || '').toLowerCase().replace(/\s*city\s*,.*/, '').trim();
      return name.includes(cityL) || cityL.includes(name);
    });
    if (!match) return {};
    const get = key => { const i = header.indexOf(key); return i >= 0 ? parseInt(match[i]) || null : null; };
    const renters = get('B25003_002E'), total = get('B25003_001E');
    return {
      population:         get('B01003_001E'),
      medianIncome:       get('B19013_001E'),
      renterUnits:        renters,
      totalHousingUnits:  total,
      renterRatio:        (renters && total) ? renters / total : null,
    };
  }

  // ── HUD FAIR MARKET RENTS ─────────────────────────────
  async function fetchHUD(stateAbbr) {
    const json = await proxyFetch('hud', { state: stateAbbr });
    const rows = (json.data || []).slice(0, 5);
    return { year: json.year || null, rows };
  }

  // ── MAIN ENTRY POINT ──────────────────────────────────
  /**
   * Fetches all data sources for the given location + file period.
   * Caches the result in localStorage.
   * Never throws — any failed source is silently skipped.
   * @param {string} stateAbbr  e.g. 'CA'
   * @param {string} city       e.g. 'Los Angeles'
   * @param {string[]} months   e.g. ['Jan 2022', 'Feb 2022', ...]
   * @param {function} onProgress  optional callback(msg)
   * @returns {Promise<Object>} dataContext
   */
  // ── OPEN-METEO WEATHER ────────────────────────────────
  async function fetchWeather(stateAbbr, startDate, endDate) {
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
      'WI':[44.3,-89.8],'WY':[43.0,-107.6],
    };

    const coords = STATE_CENTROIDS[stateAbbr];
    if (!coords) return {};

    try {
      const data = await proxyFetch('openmeteo', {
        lat: coords[0], lon: coords[1], startDate, endDate,
      });

      const dates    = data?.daily?.time                || [];
      const maxTemps = data?.daily?.temperature_2m_max  || [];
      const minTemps = data?.daily?.temperature_2m_min  || [];
      const precip   = data?.daily?.precipitation_sum   || [];

      const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

      const hdd = {}, cdd = {}, rain = {}, avgHigh = {}, avgLow = {}, counts = {};

      dates.forEach((dateStr, i) => {
        const d     = new Date(dateStr + 'T00:00:00');
        const label = `${MO[d.getMonth()]} ${d.getFullYear()}`;
        if (!counts[label]) { counts[label] = 0; hdd[label] = 0; cdd[label] = 0; rain[label] = 0; avgHigh[label] = 0; avgLow[label] = 0; }
        counts[label]++;
        const avgTemp = ((maxTemps[i] || 0) + (minTemps[i] || 0)) / 2;
        hdd[label]     += Math.max(0, 65 - avgTemp);
        cdd[label]     += Math.max(0, avgTemp - 65);
        rain[label]    += precip[i] || 0;
        avgHigh[label] += maxTemps[i] || 0;
        avgLow[label]  += minTemps[i] || 0;
      });

      Object.keys(counts).forEach(label => {
        avgHigh[label] = Math.round(avgHigh[label] / counts[label]);
        avgLow[label]  = Math.round(avgLow[label]  / counts[label]);
        hdd[label]     = Math.round(hdd[label]);
        cdd[label]     = Math.round(cdd[label]);
        rain[label]    = Math.round(rain[label] * 10) / 10;
      });

      return { heatingDegreeDays: hdd, coolingDegreeDays: cdd, precipitation: rain, avgHighTemp: avgHigh, avgLowTemp: avgLow };
    } catch {
      return {};
    }
  }

  async function fetchDataContext(stateAbbr, city, months, onProgress) {
    const ck = _cacheKey(stateAbbr, city, months);
    const cached = loadCache(ck);
    if (cached) return cached;

    const { startDate, endDate } = getDateRange(months);
    if (!startDate || !endDate) return {};

    const stateName = Object.entries(STATE_ABBR).find(([, a]) => a === stateAbbr)?.[0] || stateAbbr;

    if (onProgress) onProgress(`Fetching economic context for ${city}, ${stateAbbr}…`);

    const [fredR, femaR, congressR, osR, censusR, weatherR] = await Promise.allSettled([
      fetchFRED(stateAbbr, startDate, endDate),
      fetchFEMA(stateAbbr, startDate, endDate),
      fetchCongress(startDate, endDate),
      fetchOpenStates(stateName, startDate, endDate),
      fetchCensus(stateAbbr, city),
      fetchWeather(stateAbbr, startDate, endDate),
    ]);

    const ctx = {
      stateAbbr, stateName, city,
      startDate, endDate,
      fetchedAt: Date.now(),
      fred:       fredR.status       === 'fulfilled' ? fredR.value       : {},
      fema:       femaR.status       === 'fulfilled' ? femaR.value       : [],
      congress:   congressR.status   === 'fulfilled' ? congressR.value   : [],
      openStates: osR.status         === 'fulfilled' ? osR.value         : [],
      census:     censusR.status     === 'fulfilled' ? censusR.value     : {},
      weather:    weatherR.status    === 'fulfilled' ? weatherR.value    : {},
    };

    saveCache(ck, ctx);
    return ctx;
  }

  // ── PUBLIC ────────────────────────────────────────────
  return {
    STATES,
    STATE_ABBR,
    getCitiesForState,
    fetchCitiesForState,
    fetchDataContext,
    monthLabelToDate,
    dateToMonthLabel,
  };

})();
