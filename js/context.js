// ============================================================
// CONTEXT.JS — Location selector data, API fetching, caching
// ============================================================

const Context = (() => {

  // ── API KEYS ──────────────────────────────────────────
  const FRED_KEY     = '85a8199d1263218d54ad0b86cfaf26db';
  const CONGRESS_KEY = 'WV28fUlsauhfLvzLwSUKTeNEZ1KJNteeY69AfbPP';

  // ── CORS PROXY ────────────────────────────────────────
  // All external API calls are routed through a CORS proxy when the app is
  // running from a browser origin that the API servers don't whitelist.
  const CORS_PROXY = 'https://corsproxy.io/?url=';
  function proxied(url) {
    try {
      const host = new URL(url).hostname;
      if (host === location.hostname || host === 'localhost' || host === '127.0.0.1') return url;
    } catch (_) { return url; }
    return CORS_PROXY + encodeURIComponent(url);
  }

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

  // ── CITY LOOKUP (GeoNames API, cached) ───────────────
  const _cityCache = {};

  async function fetchCitiesForState(stateAbbr) {
    const url = `https://secure.geonames.org/searchJSON?country=US&featureClass=P&adminCode1=${stateAbbr}&maxRows=1000&username=demo`;
    const res  = await fetch(url);
    const data = await res.json();
    return (data.geonames || [])
      .map(p => p.name)
      .filter(Boolean)
      .sort();
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
      if (!entry || Date.now() - entry.ts > CACHE_TTL) return null;
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

  // ── FETCH HELPER ──────────────────────────────────────
  function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms || 9000);
    return fetch(proxied(url), { signal: ctrl.signal }).finally(() => clearTimeout(tid));
  }

  // ── FRED API ──────────────────────────────────────────
  async function fetchFREDSeries(seriesId, startDate, endDate) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&observation_start=${startDate}&observation_end=${endDate}&api_key=${FRED_KEY}&file_type=json`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) throw new Error(`FRED ${seriesId}: HTTP ${resp.status}`);
    const json = await resp.json();
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
    const filter = `state%20eq%20'${stateAbbr}'%20and%20declarationDate%20ge%20'${startDate}'%20and%20declarationDate%20le%20'${endDate}'`;
    const url = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=${filter}&$orderby=declarationDate%20desc&$top=50&$format=json`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) throw new Error(`FEMA: HTTP ${resp.status}`);
    const json = await resp.json();
    return (json.DisasterDeclarationsSummaries || []).map(d => ({
      title: d.declarationTitle || '',
      date:  (d.declarationDate || '').slice(0, 10),
      type:  d.incidentType || '',
      number: String(d.disasterNumber || ''),
    }));
  }

  // ── CONGRESS.GOV API ──────────────────────────────────
  async function fetchCongress(startDate, endDate) {
    const terms = 'housing rent "real estate" multifamily "property tax" mortgage eviction zoning';
    const q = encodeURIComponent(JSON.stringify({ query: terms }));
    const url = `https://api.congress.gov/v3/bill?q=${q}&sort=date+asc&limit=20&format=json&api_key=${CONGRESS_KEY}`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) throw new Error(`Congress: HTTP ${resp.status}`);
    const json = await resp.json();
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
    const q = encodeURIComponent('rent landlord tenant property tax eviction zoning');
    const url = `https://v3.openstates.org/bills?jurisdiction=${encodeURIComponent(stateName)}&q=${q}&sort=updated_at&page=1&per_page=15`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) throw new Error(`OpenStates: HTTP ${resp.status}`);
    const json = await resp.json();
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
    const vars = 'B01003_001E,B19013_001E,B25003_002E,B25003_001E';
    const url = `https://api.census.gov/data/2022/acs/acs5?get=NAME,${vars}&for=place:*&in=state:${fips}`;
    const resp = await fetchWithTimeout(url, 10000);
    if (!resp.ok) throw new Error(`Census: HTTP ${resp.status}`);
    const rows = await resp.json();
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
    const url = `https://www.huduser.gov/hudapi/public/fmr/statedata/${stateAbbr}`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) throw new Error(`HUD: HTTP ${resp.status}`);
    const json = await resp.json();
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
  async function fetchDataContext(stateAbbr, city, months, onProgress) {
    const ck = _cacheKey(stateAbbr, city, months);
    const cached = loadCache(ck);
    if (cached) return cached;

    const { startDate, endDate } = getDateRange(months);
    if (!startDate || !endDate) return {};

    const stateName = Object.entries(STATE_ABBR).find(([, a]) => a === stateAbbr)?.[0] || stateAbbr;

    if (onProgress) onProgress(`Fetching economic context for ${city}, ${stateAbbr}…`);

    const [fredR, femaR, congressR, osR, censusR, hudR] = await Promise.allSettled([
      fetchFRED(stateAbbr, startDate, endDate),
      fetchFEMA(stateAbbr, startDate, endDate),
      fetchCongress(startDate, endDate),
      fetchOpenStates(stateName, startDate, endDate),
      fetchCensus(stateAbbr, city),
      fetchHUD(stateAbbr),
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
      hud:        hudR.status        === 'fulfilled' ? hudR.value        : {},
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
