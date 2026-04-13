// ============================================================
// APP.JS — State management, event wiring, entry point
// ============================================================

const App = (() => {

  // ── STATE ─────────────────────────────────────────────

  const state = {
    mode: null,           // 'analyzer' | 'comparison'
    parsedA: null,
    resultA: null,
    reasonsA: null,
    purchasePriceA: 0,
    parsedB: null,
    resultB: null,
    reasonsB: null,
    purchasePriceB: 0,
    filteredA: null,      // comparison: parsedA restricted to shared months
    filteredB: null,
    periodStart: null,    // last-used period indices (for price re-runs)
    periodEnd: null,
    propertyNameA: 'Asset A',
    propertyNameB: 'Asset B',
    materialFocus: false,
    sectionFilter: 'all',
    viewFilter: 'both',
    fileNameA: null,
    fileNameB: null,
    assetTypeA: 'Multifamily',
    assetTypeB: 'Multifamily',
    locationA: '',
    locationB: '',
    // enrichment
    selectedState: '',
    selectedCity: '',
    dataContext: null,
    _fetchingContext: null, // Promise<void> while in flight
    cloudHistory: null,
    summaryStats: null,
    ruleCandidates: [],
    isSaved: false,
    executiveResult: null,
    executiveCategoryResult: null,
    resultEA: null,
    propertyNameEA: '',
    stateEA: '',
    cityEA: '',
    dataContextEA: {},
  };

  // ── LOCATION STORAGE KEYS ─────────────────────────────
  const STORAGE_KEY_LOCATION = 'oaas_location';

  function saveLocation(stateAbbr, city) {
    try { localStorage.setItem(STORAGE_KEY_LOCATION, JSON.stringify({ stateAbbr, city })); } catch {}
  }
  function loadLocation() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_LOCATION) || 'null'); } catch { return null; }
  }

  // ── PROPERTY PRICE MEMORY ─────────────────────────────
  const PRICE_STORAGE_KEY = 'oaas_property_prices';

  function getSavedPrice(propertyName) {
    try {
      const saved = JSON.parse(localStorage.getItem(PRICE_STORAGE_KEY) || '{}');
      return saved[propertyName] || null;
    } catch(e) { return null; }
  }

  function savePrice(propertyName, price) {
    try {
      const saved = JSON.parse(localStorage.getItem(PRICE_STORAGE_KEY) || '{}');
      saved[propertyName] = price;
      localStorage.setItem(PRICE_STORAGE_KEY, JSON.stringify(saved));
    } catch(e) {}
  }

  // ── CITY → STATE LOOKUP ───────────────────────────────
  const CITY_STATE_MAP = {
    // New Jersey
    'Princeton Junction': 'NJ', 'Princeton Meadows': 'NJ', 'Middlesex': 'NJ',
    'Newark': 'NJ', 'Jersey City': 'NJ', 'Trenton': 'NJ', 'Camden': 'NJ',
    'Hoboken': 'NJ', 'Edison': 'NJ', 'Woodbridge': 'NJ', 'Lakewood': 'NJ',
    'Toms River': 'NJ', 'Hamilton': 'NJ', 'Clifton': 'NJ', 'Cherry Hill': 'NJ',
    'Paterson': 'NJ', 'Elizabeth': 'NJ', 'East Orange': 'NJ', 'Vineland': 'NJ',
    'New Brunswick': 'NJ', 'Parsippany': 'NJ', 'Hackensack': 'NJ',
    'Piscataway': 'NJ', 'Irvington': 'NJ', 'Plainfield': 'NJ',
    // Connecticut
    'Norwalk': 'CT', 'Bridgeport': 'CT', 'New Haven': 'CT', 'Hartford': 'CT',
    'Stamford': 'CT', 'Waterbury': 'CT', 'Danbury': 'CT', 'Meriden': 'CT',
    'New Britain': 'CT', 'West Haven': 'CT', 'Greenwich': 'CT', 'Fairfield': 'CT',
    // New York
    'New York': 'NY', 'Brooklyn': 'NY', 'Queens': 'NY', 'Bronx': 'NY',
    'Buffalo': 'NY', 'Rochester': 'NY', 'Yonkers': 'NY', 'Syracuse': 'NY',
    'Albany': 'NY', 'White Plains': 'NY', 'Hempstead': 'NY', 'Flushing': 'NY',
    // Pennsylvania
    'Philadelphia': 'PA', 'Pittsburgh': 'PA', 'Allentown': 'PA', 'Reading': 'PA',
    'Scranton': 'PA', 'Erie': 'PA', 'Bethlehem': 'PA', 'Lancaster': 'PA',
    // Florida
    'Miami': 'FL', 'Orlando': 'FL', 'Tampa': 'FL', 'Jacksonville': 'FL',
    'Fort Lauderdale': 'FL', 'Boca Raton': 'FL', 'West Palm Beach': 'FL',
    // Texas
    'Houston': 'TX', 'Dallas': 'TX', 'Austin': 'TX', 'San Antonio': 'TX',
    'Fort Worth': 'TX', 'El Paso': 'TX', 'Arlington': 'TX', 'Plano': 'TX',
    // California
    'Los Angeles': 'CA', 'San Francisco': 'CA', 'San Diego': 'CA', 'San Jose': 'CA',
    'Sacramento': 'CA', 'Oakland': 'CA', 'Irvine': 'CA', 'Anaheim': 'CA',
    // Other common states
    'Chicago': 'IL', 'Phoenix': 'AZ', 'Seattle': 'WA', 'Denver': 'CO',
    'Atlanta': 'GA', 'Boston': 'MA', 'Nashville': 'TN', 'Charlotte': 'NC',
    'Las Vegas': 'NV', 'Portland': 'OR', 'Minneapolis': 'MN', 'Baltimore': 'MD',
    'Washington': 'DC', 'Louisville': 'KY', 'Memphis': 'TN', 'Columbus': 'OH',
    'Cleveland': 'OH', 'Indianapolis': 'IN', 'Milwaukee': 'WI', 'Tucson': 'AZ',
    'Albuquerque': 'NM', 'Kansas City': 'MO', 'Omaha': 'NE', 'Raleigh': 'NC',
    'Virginia Beach': 'VA', 'Richmond': 'VA', 'Norfolk': 'VA',
    'Salt Lake City': 'UT', 'Boise': 'ID', 'Anchorage': 'AK', 'Honolulu': 'HI',
  };

  // ── STORAGE ───────────────────────────────────────────

  const STORAGE_KEY_PRICES = 'anomaly_price_history';
  const STORAGE_KEY_NAMES  = 'anomaly_name_history';
  const MAX_HISTORY = 10;

  function loadHistory(key) {
    try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; }
  }

  function saveHistory(key, val) {
    let hist = loadHistory(key).filter(v => String(v) !== String(val));
    hist.unshift(val);
    localStorage.setItem(key, JSON.stringify(hist.slice(0, MAX_HISTORY)));
  }

  // ── FILE HISTORY (localStorage) ──────────────────────

  const STORAGE_KEY_FILES = 'oaas_file_history';

  function saveFileToHistory(name, parsedData) {
    try {
      let hist = loadFileHistory().filter(f => f.name !== name);
      hist.unshift({ name, savedAt: Date.now(), data: parsedData });
      const serialised = JSON.stringify(hist.slice(0, MAX_HISTORY));
      localStorage.setItem(STORAGE_KEY_FILES, serialised);
      console.log('[FileHistory] saved:', name, '— total in history:', hist.length);
    } catch (e) {
      console.error('[FileHistory] SAVE FAILED:', e);
    }
  }

  function loadFileHistory() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY_FILES) || '[]'); } catch { return []; }
  }

  function showFileHistoryDropdown(btnEl, onSelect) {
    // Close any existing dropdown
    document.querySelectorAll('.history-dropdown').forEach(d => d.remove());

    const files = loadFileHistory();
    console.log('[FileHistory] dropdown opened, files in storage:', files.length, files.map(f => f.name));

    const drop = document.createElement('div');
    drop.className = 'history-dropdown';
    drop.style.minWidth = '260px';
    drop.style.position = 'fixed';
    drop.style.zIndex = '9999';

    if (!files.length) {
      drop.innerHTML = '<div class="history-item" style="color:#9e9e9e;cursor:default">No recent files — upload a file first</div>';
    } else {
      drop.innerHTML = files.map((f, i) => {
        const d = new Date(f.savedAt).toLocaleDateString();
        return `<div class="history-item" data-idx="${i}">
          <div style="font-weight:600">${f.name}</div>
          <div style="font-size:0.72rem;color:#9e9e9e">${d} · ${f.data.months?.length || 0} months · ${f.data.metrics?.length || 0} metrics</div>
        </div>`;
      }).join('');
      drop.querySelectorAll('.history-item').forEach(item => {
        item.addEventListener('click', e => {
          e.stopPropagation();
          const rec = files[parseInt(item.dataset.idx)];
          if (rec) onSelect(rec.name, rec.data);
          drop.remove();
        });
      });
    }

    // Position using fixed coords so no parent overflow can clip it
    document.body.appendChild(drop);
    const rect = btnEl.getBoundingClientRect();
    drop.style.top  = (rect.bottom + 4) + 'px';
    drop.style.left = rect.left + 'px';

    // Close on outside click
    setTimeout(() => {
      function closeHandler(e) {
        if (!drop.contains(e.target) && e.target !== btnEl) {
          drop.remove();
          document.removeEventListener('click', closeHandler);
        }
      }
      document.addEventListener('click', closeHandler);
    }, 50);
  }

  // ── ELEMENT RESOLUTION (mode-aware) ──────────────────

  /**
   * Resolve an element ID relative to the active screen.
   * For comparison screen, -comp suffix variants take priority.
   */
  function el(id) {
    if (state.mode === 'comparison') {
      const compEl = document.getElementById(id + '-comp');
      if (compEl) return compEl;
    }
    return document.getElementById(id);
  }

  // ── SCREEN SWITCHING ──────────────────────────────────

  function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const s = document.getElementById(id);
    if (s) s.classList.add('active');
  }

  // ── RESET ─────────────────────────────────────────────

  function resetState() {
    state.parsedA = null; state.resultA = null; state.reasonsA = null;
    state.parsedB = null; state.resultB = null; state.reasonsB = null;
    state.filteredA = null; state.filteredB = null;
    state.periodStart = null; state.periodEnd = null;
    state.purchasePriceA = 0; state.purchasePriceB = 0;
    state.materialFocus = false; state.sectionFilter = 'all'; state.viewFilter = 'both';
    state.propertyNameA = 'Asset A'; state.propertyNameB = 'Asset B';
    state.fileNameA = null; state.fileNameB = null;

    // Reset upload button labels
    setUploadLabel('upload-btn-a', 'Upload File');
    setUploadLabel('upload-btn-a-comp', 'Upload File A');
    setUploadLabel('upload-btn-b-comp', 'Upload File B');

    // Reset price/name inputs
    ['price-a', 'price-a-comp', 'price-b-comp'].forEach(id => {
      const e = document.getElementById(id); if (e) e.value = '';
    });
    ['prop-name-a', 'prop-name-b'].forEach(id => {
      const e = document.getElementById(id); if (e) e.value = '';
    });

    // Reset period pickers
    ['period-start', 'period-end'].forEach(id => {
      const e = document.getElementById(id);
      if (e) { e.value = ''; e.min = ''; e.max = ''; e.disabled = true; e.title = 'Upload a file first'; }
    });

    // Clear output areas (both screens)
    ['table-container', 'table-container-comp',
     'dashboard-container', 'dashboard-container-comp',
     'status-msg', 'status-msg-comp'].forEach(id => {
      const e = document.getElementById(id);
      if (e) { e.innerHTML = ''; e.classList.add('hidden'); }
    });
    ['detail-card', 'detail-card-comp', 'detail-card-ea'].forEach(id => {
      const e = document.getElementById(id);
      if (e) { e.innerHTML = '<button class="close-card" title="Close">✕</button>'; e.classList.remove('open'); }
    });
    const badgesEl = document.getElementById('summary-badges');
    if (badgesEl) { badgesEl.innerHTML = ''; badgesEl.classList.add('hidden'); }

    ['controls-bar', 'controls-bar-comp', 'legend', 'legend-comp'].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.add('hidden');
    });

    document.getElementById('save-analysis-btn')?.classList.add('hidden');
    state.isSaved = false;
    state.executiveResult = null;
    state.executiveCategoryResult = null;
    state.resultEA = null;
    state.propertyNameEA = '';
    state.stateEA = '';
    state.cityEA = '';
    state.dataContextEA = {};
    const runExecBtn = document.getElementById('btn-run-executive');
    if (runExecBtn) runExecBtn.disabled = true;
  }

  // ── FILE PARSING ──────────────────────────────────────

  async function readFileAsRows(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.html') || name.endsWith('.htm')) {
      return readHTMLFileAsRows(file);
    }
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          const data = new Uint8Array(e.target.result);
          const wb = XLSX.read(data, { type: 'array', cellText: false, cellDates: true });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: false });
          resolve(rows);
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    });
  }

  function readHTMLFileAsRows(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        try {
          resolve(Engine.parseHTMLToRows(e.target.result));
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsText(file, 'utf-8');
    });
  }

  // ── PERIOD FILTER UI ──────────────────────────────────

  const MONTH_ABBR_TO_NUM = {Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
    Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12'};
  const MONTH_NUM_TO_ABBR = Object.fromEntries(Object.entries(MONTH_ABBR_TO_NUM).map(([k,v])=>[v,k]));

  /** "Jan 2024" → "2024-01" */
  function monthLabelToInput(label) {
    const [abbr, yr] = label.split(' ');
    return `${yr}-${MONTH_ABBR_TO_NUM[abbr] || '01'}`;
  }

  /** "2024-01" → index in months[], or -1 */
  function inputValueToIdx(value, months) {
    if (!value) return -1;
    const [yr, mo] = value.split('-');
    const label = `${MONTH_NUM_TO_ABBR[mo]} ${yr}`;
    return months.indexOf(label);
  }

  function populatePeriodSelects(months) {
    // Last 2 months are always skipped; user cannot select them
    const validEnd = months.length - 3;
    if (validEnd < 0) return;

    const inStart = document.getElementById('period-start');
    const inEnd   = document.getElementById('period-end');
    if (!inStart || !inEnd) return;

    const minVal = monthLabelToInput(months[0]);
    const maxVal = monthLabelToInput(months[validEnd]);

    inStart.min   = minVal;
    inStart.max   = maxVal;
    inStart.value = minVal;
    inStart.disabled = false;
    inStart.title = '';

    inEnd.min   = minVal;
    inEnd.max   = maxVal;
    inEnd.value = maxVal;
    inEnd.disabled = false;
    inEnd.title = '';
  }

  // ── HISTORY DROPDOWN ──────────────────────────────────

  function buildHistoryDropdown(inputEl, histKey) {
    const hist = loadHistory(histKey);
    if (!hist.length) return;

    // Remove any existing
    const oldDrop = inputEl.parentElement.querySelector('.history-dropdown');
    if (oldDrop) { oldDrop.remove(); return; }

    const drop = document.createElement('div');
    drop.className = 'history-dropdown';
    drop.style.width = inputEl.offsetWidth + 'px';
    drop.innerHTML = hist.map(v => `<div class="history-item" data-val="${v}">${v}</div>`).join('');
    inputEl.parentElement.appendChild(drop);

    drop.querySelectorAll('.history-item').forEach(item => {
      item.addEventListener('click', () => { inputEl.value = item.dataset.val; drop.remove(); });
    });
    setTimeout(() => {
      document.addEventListener('click', function h(e) {
        if (!drop.contains(e.target)) { drop.remove(); document.removeEventListener('click', h); }
      });
    }, 10);
  }

  // ── STATUS MESSAGE ────────────────────────────────────

  function showMsg(msg, targetId) {
    const e = document.getElementById(targetId || 'status-msg');
    if (e) { e.textContent = msg; e.classList.remove('hidden'); }
  }

  function setUploadLabel(id, text) {
    const el = document.getElementById(id);
    if (!el) return;
    const sp = el.querySelector('span');
    if (sp) sp.textContent = text; else el.textContent = text;
  }

  // ── LOCATION DROPDOWNS ────────────────────────────────

  function populateStateDropdown(selectId) {
    const sel = document.getElementById(selectId);
    if (!sel) return;
    Context.STATES.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.abbr;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
  }

  // ── CITY AUTOCOMPLETE ─────────────────────────────────
  // Per-widget in-memory city lists keyed by input element id
  const _acCities = {};

  // Load (or reload) cities for a given autocomplete input.
  // Mirrors the old populateCityDropdown signature for easy call-site reuse.
  async function loadCityAutocomplete(inputId, listId, stateAbbr) {
    const inp = document.getElementById(inputId);
    const ul  = document.getElementById(listId);
    if (!inp) return;

    // Reset state immediately
    inp.value       = '';
    _acCities[inputId] = [];
    if (ul) { ul.innerHTML = ''; ul.hidden = true; }

    if (!stateAbbr) {
      inp.placeholder = 'Select a state first…';
      inp.disabled    = true;
      return;
    }

    const stateEntry = Context.STATES.find(s => s.abbr === stateAbbr || s.name === stateAbbr);
    const abbr = stateEntry?.abbr || stateAbbr;

    inp.placeholder = 'Loading…';
    inp.disabled    = true;

    let cities;
    try {
      cities = await Context.getCitiesForState(abbr);
    } catch (err) {
      console.error(`loadCityAutocomplete: failed for "${abbr}"`, err);
      inp.placeholder = 'Could not load cities';
      inp.disabled    = false;
      return;
    }

    _acCities[inputId] = cities;
    inp.placeholder    = 'Type to search city…';
    inp.disabled       = false;
  }

  function _renderCityList(inputId, listId) {
    const inp = document.getElementById(inputId);
    const ul  = document.getElementById(listId);
    if (!inp || !ul) return;
    const q       = inp.value.trim().toLowerCase();
    const cities  = _acCities[inputId] || [];
    const matches = q ? cities.filter(c => c.toLowerCase().startsWith(q)) : [];

    ul.innerHTML = '';
    if (!q || matches.length === 0) {
      if (q && cities.length > 0) {
        const li = document.createElement('li');
        li.textContent = 'No results';
        li.className   = 'city-ac-noresult';
        ul.appendChild(li);
        ul.hidden = false;
      } else {
        ul.hidden = true;
      }
      return;
    }
    matches.slice(0, 10).forEach(c => {
      const li = document.createElement('li');
      li.textContent = c;
      ul.appendChild(li);
    });
    ul.hidden = false;
  }

  // Wire input + list events once (called during init).
  // onSelect(cityName) fires when the user picks a city.
  function setupCityAutocomplete(inputId, listId, onSelect) {
    const inp = document.getElementById(inputId);
    const ul  = document.getElementById(listId);
    if (!inp || !ul) return;

    inp.addEventListener('input', () => _renderCityList(inputId, listId));

    inp.addEventListener('focus', () => {
      if (inp.value.trim()) _renderCityList(inputId, listId);
    });

    // mousedown fires before blur so we can read the target before the list hides
    ul.addEventListener('mousedown', e => {
      const li = e.target.closest('li');
      if (!li || li.classList.contains('city-ac-noresult')) return;
      e.preventDefault();               // prevent input blur
      inp.value = li.textContent;
      ul.hidden = true;
      onSelect(li.textContent);
    });

    inp.addEventListener('blur', () => {
      // Short delay lets mousedown complete first
      setTimeout(() => { ul.hidden = true; }, 150);
    });

    // Hide when clicking outside the wrapper
    document.addEventListener('click', e => {
      if (!inp.closest('.city-autocomplete-wrapper')?.contains(e.target)) {
        ul.hidden = true;
      }
    });
  }

  // ── CONTEXT FETCHING ──────────────────────────────────

  async function fetchContextIfReady(msgTargetId) {
    const months = state.parsedA?.months || state.parsedB?.months;
    if (!months || !state.selectedState || !state.selectedCity) return;

    state.dataContext = null;
    const msgId = msgTargetId || (state.mode === 'comparison' ? 'status-msg-comp' : 'status-msg');

    const promise = Context.fetchDataContext(
      state.selectedState,
      state.selectedCity,
      months,
      msg => showMsg(msg, msgId)
    ).then(ctx => {
      state.dataContext = ctx;
      // Clear the fetch status if still showing
      const e = document.getElementById(msgId);
      if (e && e.textContent.startsWith('Fetching economic')) { e.textContent = ''; e.classList.add('hidden'); }
    }).catch(() => {
      state.dataContext = null;
    }).finally(() => {
      state._fetchingContext = null;
    });

    state._fetchingContext = promise;
    return promise;
  }

  // ── PRICE PARSING ─────────────────────────────────────

  function parsePrice(str) {
    return parseFloat(String(str || '').replace(/[$,\s]/g, '')) || 0;
  }

  // ── ASSET INFO HELPERS ────────────────────────────────

  function getAssetInfo(suffix) {
    if (suffix === 'a') return { type: state.assetTypeA, location: state.locationA };
    return { type: state.assetTypeB, location: state.locationB };
  }

  // ── ANALYZER: RUN ANALYSIS ────────────────────────────

  async function runAnalysis() {
    if (!state.parsedA) { alert('Please upload a file first.'); return; }

    // Location is required
    if (!state.selectedState || !state.selectedCity) {
      showMsg('Please select a State and City before running analysis.', 'status-msg');
      document.getElementById('state-select')?.focus();
      return;
    }

    const inStart = document.getElementById('period-start');
    const inEnd   = document.getElementById('period-end');
    const pStart = inputValueToIdx(inStart?.value, state.parsedA.months);
    const pEnd   = inputValueToIdx(inEnd?.value,   state.parsedA.months);
    state.periodStart = pStart >= 0 ? pStart : null;
    state.periodEnd   = pEnd   >= 0 ? pEnd   : null;

    // Fetch external data FIRST, directly — do not go through fetchContextIfReady()
    showMsg(`Fetching market data for ${state.selectedCity}, ${state.selectedState}…`, 'status-msg');
    try {
      state.dataContext = await Context.fetchDataContext(
        state.selectedState,
        state.selectedCity,
        state.parsedA.months,
        msg => showMsg(msg, 'status-msg')
      );
    } catch (e) {
      console.error('fetchDataContext failed:', e);
      state.dataContext = null;
    }
    _runAnalysisCore();
    document.getElementById('controls-bar')?.classList.remove('hidden');
  }

  /** Re-run analysis with the current price (called when price input changes). */
  function rerunAnalysisWithPrice() {
    if (!state.parsedA || !state.resultA) return;
    _runAnalysisCore();
  }

  // ── CLOUD HISTORY ─────────────────────────────────────

  async function fetchCloudHistory(groupId, metricName) {
    const params = new URLSearchParams();
    if (state.selectedState) params.set('stateAbbr',   state.selectedState);
    if (groupId)             params.set('groupId',     groupId);
    if (metricName)          params.set('metricName',  metricName);
    params.set('limit', '100');

    try {
      const res  = await fetch(`/api/get-history?${params}`);
      const data = await res.json();
      return {
        anomalies: data.anomalies || [],
        patterns:  data.patterns  || [],
        summary:   data.summary   || {},
      };
    } catch (err) {
      console.warn('[Cloud] history fetch failed:', err);
      return { anomalies: [], patterns: [], summary: {} };
    }
  }

  // ── CLOUD SAVE ────────────────────────────────────────

  function saveAnalysisToCloud(resultA, reasonsA, dataContext) {
    if (!resultA || !reasonsA) return;

    // ── Property ────────────────────────────────────────
    const property = {
      name:      state.propertyNameA || 'Unknown Property',
      stateAbbr: state.selectedState || '',
      city:      state.selectedCity  || '',
      assetType: state.assetTypeA    || 'Multifamily',
    };

    // ── Analysis ────────────────────────────────────────
    const months = resultA.months || [];
    const analysis = {
      fileName:      state.fileNameA    || '',
      monthCount:    months.length,
      periodStart:   months[0]                     || '',
      periodEnd:     months[months.length - 1]     || '',
      purchasePrice: state.purchasePriceA           || 0,
    };

    // ── Helpers ─────────────────────────────────────────
    const MONTH_ABBRS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    function parseMon(label) {
      const parts = (label || '').split(' ');
      const num   = MONTH_ABBRS.indexOf((parts[0] || '').toLowerCase()) + 1; // 1-12, or 0 if unrecognised
      const year  = parseInt(parts[1], 10) || 0;
      return { monthNum: num, monthYear: year };
    }

    function totalNOIForIdx(idx) {
      return (resultA.metrics || [])
        .filter(m => m.section === 'INCOME')
        .reduce((sum, m) => sum + (m.values?.[idx] || 0), 0);
    }

    // ── Anomalies ───────────────────────────────────────
    const anomalies = (reasonsA.results || []).map(r => {
      const metric = (resultA.metrics || []).find(m => m.id === r.metricId);

      let dollarDeviation = 0;
      if (metric) {
        if (typeof Engine.getMaterialDeviation === 'function') {
          dollarDeviation = Engine.getMaterialDeviation(metric, r.monthIdx);
        } else {
          dollarDeviation = r.effectiveZ * (metric.stdDev || 0);
        }
      }

      const useIdx = r.absMonthIdx ?? r.monthIdx;
      const noi    = totalNOIForIdx(useIdx);
      const pctOfNoi = noi > 0 ? (Math.abs(dollarDeviation) / noi) * 100 : 0;

      const rPrimary  = r.reasonerResult?.primary;
      const groupId   = rPrimary?.groupId   || r.primary?.groupId   || '';
      const groupName = rPrimary?.groupName || r.primary?.groupName || '';
      const signalCount = rPrimary?.signalCount ?? r.primary?.evidenceSignals ?? 0;
      const anomalyType = metric?.zScores?.[r.monthIdx]?.anomalyType || '';
      const { monthNum, monthYear } = parseMon(r.monthLabel);

      return {
        metricName:      r.metricName,
        section:         r.section,
        monthLabel:      r.monthLabel,
        monthYear,
        monthNum,
        effectiveZ:      r.effectiveZ,
        anomalyType,
        pnl:             r.pnl,
        dollarDeviation,
        pctOfNoi,
        groupId,
        groupName,
        generatedBy:     r.generatedBy || 'fallback',
        signalCount,
      };
    });

    // ── Patterns ────────────────────────────────────────
    const patternMap = new Map(); // keyed by groupId|monthLabel — deduplicates

    (reasonsA.results || []).forEach(r => {
      if (r.generatedBy !== 'data_pattern') return;
      const rPrimary = r.reasonerResult?.primary;
      if (!rPrimary?.groupId) return;

      const key = `${rPrimary.groupId}|${r.monthLabel}`;
      if (patternMap.has(key)) return;

      const matched = rPrimary.matchedMetrics || [];

      // avgZ: mean of abs(effectiveZ) for each matched metric at this monthIdx
      const zVals = matched
        .map(mName => {
          const m = (resultA.metrics || []).find(mx => mx.name === mName);
          const z = m?.zScores?.[r.monthIdx];
          return z ? Math.abs(z.effectiveZ) : null;
        })
        .filter(v => v !== null);
      const avgZ = zVals.length
        ? zVals.reduce((s, v) => s + v, 0) / zVals.length
        : 0;

      const { monthNum, monthYear } = parseMon(r.monthLabel);

      patternMap.set(key, {
        groupId:        rPrimary.groupId,
        groupName:      rPrimary.groupName || '',
        monthLabel:     r.monthLabel,
        monthYear,
        monthNum,
        matchCount:     rPrimary.signalCount || matched.length,
        matchedMetrics: matched,
        avgZ,
      });
    });

    const patterns = Array.from(patternMap.values());

    // ── POST ─────────────────────────────────────────────
    return fetch('/api/save-analysis', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ property, analysis, anomalies, patterns }),
    }).then(async res => {
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.warn('[Cloud] save failed:', res.status, body);
        return;
      }
    }).catch(err => console.warn('[Cloud] save failed:', err));
  }

  async function detectPatternsInCloud(resultA, reasonsA) {
    try {
      const anomalies = [];
      (resultA.metrics || []).forEach(metric => {
        (metric.anomalies || []).forEach(relIdx => {
          const rd = metric.reasonData?.[relIdx];
          if (!rd) return;
          const sp = rd.situationProfile;
          if (!sp) return;
          anomalies.push({
            metricName: metric.name,
            section: metric.section,
            monthLabel: rd.monthLabel,
            angle: sp.angle,
            propertyName: state.propertyNameA || 'unknown',
            effectiveZ: rd.effectiveZ || 0,
            stateAbbr: state.selectedState || '',
          });
        });
      });
      if (anomalies.length === 0) return;
      await fetch('/api/detect-patterns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ anomalies }),
      });
    } catch (err) {
      console.warn('[Patterns] detection failed:', err.message);
    }
  }

  async function fetchRuleCandidates() {
    try {
      const res = await fetch('/api/get-rule-candidates');
      const data = await res.json();
      if (data.success) {
        state.ruleCandidates = data.candidates || [];
      }
    } catch (err) {
      console.warn('[Rules] failed to fetch candidates:', err.message);
    }
  }

  function showRuleCandidates() {
    const onApprove = async (candidateId, ruleText) => {
      await fetch('/api/save-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', candidateId, ruleText }),
      });
      state.ruleCandidates = state.ruleCandidates.filter(c => c.id !== candidateId);
      UI.renderRuleCandidates(state.ruleCandidates, onApprove, onDismiss);
    };
    const onDismiss = async (candidateId) => {
      await fetch('/api/save-rule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', candidateId }),
      });
      state.ruleCandidates = state.ruleCandidates.filter(c => c.id !== candidateId);
      UI.renderRuleCandidates(state.ruleCandidates, onApprove, onDismiss);
    };
    UI.renderRuleCandidates(state.ruleCandidates, onApprove, onDismiss);
  }

  function _runAnalysisCore() {
    state.propertyNameA = document.getElementById('analyzer-property-name')?.value.trim() || 'Unknown Property';

    const price = parsePrice(document.getElementById('price-a')?.value) || 0;
    if (price) saveHistory(STORAGE_KEY_PRICES, price);
    state.purchasePriceA = price;
    if (price && state.propertyNameA) savePrice(state.propertyNameA, document.getElementById('price-a')?.value);

    try {
      state.resultA  = Engine.analyse(state.parsedA, price, state.periodStart, state.periodEnd);
      window._debugResult = state.resultA;
      state.reasonsA = RuleEngine.analyse(state.resultA.metrics, state.resultA.months, getAssetInfo('a'));
      // Enrich rule output with real-world data (no-op if context is null)
      state.reasonsA = Enrichment.enrichAll(state.resultA, state.reasonsA, state.dataContext, state.cloudHistory);
      window._debugReasons = state.reasonsA;

      (state.resultA.metrics || []).forEach(metric => {
        (metric.anomalies || []).forEach(relIdx => {
          if (!metric.reasonData?.[relIdx]) return;
          const coMovers = metric.reasonData[relIdx]?.reasonerResult?.primary?.matchedMetrics || [];
          metric.reasonData[relIdx].anomalyProfile = Enricher.enrichAnomaly(
            metric,
            relIdx,
            state.resultA.metrics,
            state.resultA.months,
            coMovers,
            state.cloudHistory
          );
          const situationProfile = Narrator.profile(
            metric.reasonData[relIdx], metric, state.dataContext
          );
          const narrativeResult = Composer.compose(
            metric.reasonData[relIdx], metric, state.dataContext, situationProfile
          );
          metric.reasonData[relIdx].situationProfile = situationProfile;
          metric.reasonData[relIdx].narrativeResult = narrativeResult;

          if (narrativeResult?.narrative) {
            const hasCoMovers =
              metric.reasonData[relIdx].anomalyProfile?.causalityChain?.likelyCause !== null ||
              (metric.reasonData[relIdx].anomalyProfile?.causalityChain?.effects?.length || 0) > 0;
            if (narrativeResult.angle !== 'ANOMALY_ALERT' || hasCoMovers) {
              metric.reasonData[relIdx].enrichedPrimary = narrativeResult.narrative;
            }
          }

          // Generate alt narratives using ranked angles (always 2–4)
          if (situationProfile?.rankedAngles) {
            const altAngles = situationProfile.rankedAngles.slice(1); // skip dominant — already used
            const existingAlts = metric.reasonData[relIdx].alternatives || [];
            const paddedAngles = [...altAngles];
            while (paddedAngles.length < 2) paddedAngles.push('ANOMALY_ALERT');
            metric.reasonData[relIdx].enrichedAlternatives = paddedAngles
              .map((altAngle, i) => {
                const altResult = Composer.compose(
                  metric.reasonData[relIdx], metric, state.dataContext, situationProfile, altAngle
                );
                return altResult || { narrative: existingAlts[i] || '', angle: altAngle };
              })
              .filter(result => result?.angle !== 'ANOMALY_ALERT')
              .slice(0, 4)
              .map(result => result.narrative || '');
          }
        });
      });

      // Compute summary stats for badge display (seasonal takes priority; no double-counting)
      state.summaryStats = { totalMaterial: 0, incomeAnomalies: 0, expenseAnomalies: 0, seasonalAnomalies: 0 };
      (state.resultA.metrics || []).forEach(metric => {
        (metric.materialAnomalies || []).forEach(relIdx => {
          const isSeasonal = metric.reasonData?.[relIdx]?.situationProfile?.angle === 'SEASONAL_VARIANCE';
          if (isSeasonal) {
            state.summaryStats.seasonalAnomalies++;
          } else if (metric.section === 'INCOME') {
            state.summaryStats.incomeAnomalies++;
          } else if (metric.section === 'EXPENSES') {
            state.summaryStats.expenseAnomalies++;
          }
        });
      });
      state.summaryStats.totalMaterial =
        state.summaryStats.incomeAnomalies +
        state.summaryStats.expenseAnomalies +
        state.summaryStats.seasonalAnomalies;

      renderAnalyzerTable();
      const _saveBtn = document.getElementById('save-analysis-btn');
      if (_saveBtn) {
        _saveBtn.textContent = '💾 Save';
        _saveBtn.disabled = false;
        _saveBtn.classList.remove('hidden');
      }
    } catch (err) {
      console.error(err);
      alert('Analysis error: ' + err.message);
    }

    fetchCloudHistory().then(history => {
      state.cloudHistory = history;
      console.log('[Cloud] history loaded:', history.summary);
    });
  }

  function renderAnalyzerTable() {
    const tableEl = document.getElementById('table-container');
    if (!tableEl || !state.resultA) return;
    const { html, rowCount } = UI.renderTable(state.resultA, {
      materialFocus: state.materialFocus,
      sectionFilter: state.sectionFilter,
    });
    tableEl.innerHTML = html;
    attachCellClicks(tableEl, state.resultA);
    tableEl.classList.remove('hidden');

    const total = state.resultA.metrics.filter(m => m.type !== 'all_zero').length;
    const countEl = document.getElementById('row-count');
    if (countEl) countEl.textContent = `${rowCount} of ${total} rows`;

    const badgesEl = document.getElementById('summary-badges');
    if (badgesEl && state.summaryStats) {
      badgesEl.innerHTML = UI.renderSummaryBadges(state.summaryStats);
      badgesEl.classList.remove('hidden');
    }

    document.getElementById('legend')?.classList.remove('hidden');
  }

  // ── COMPARISON: RUN ───────────────────────────────────

  async function runComparison() {
    if (!state.parsedA || !state.parsedB) { alert('Please upload both files.'); return; }

    if (!state.selectedState || !state.selectedCity) {
      showMsg('Please select a Market Location before running comparison.', 'status-msg-comp');
      document.getElementById('state-select-comp')?.focus();
      return;
    }

    // Fetch external data FIRST, directly — do not go through fetchContextIfReady()
    showMsg(`Fetching market data for ${state.selectedCity}, ${state.selectedState}…`, 'status-msg-comp');
    try {
      const months = state.parsedA?.months || state.parsedB?.months;
      state.dataContext = await Context.fetchDataContext(
        state.selectedState,
        state.selectedCity,
        months,
        msg => showMsg(msg, 'status-msg-comp')
      );
    } catch (e) {
      console.error('fetchDataContext failed:', e);
      state.dataContext = null;
    }
    const nameA = document.getElementById('prop-name-a')?.value.trim() || 'Asset A';
    const nameB = document.getElementById('prop-name-b')?.value.trim() || 'Asset B';
    state.propertyNameA = nameA;
    state.propertyNameB = nameB;
    if (nameA) saveHistory(STORAGE_KEY_NAMES, nameA);
    if (nameB) saveHistory(STORAGE_KEY_NAMES, nameB);

    try {
      const sharedLabels = Engine.findSharedMonths(state.parsedA.months, state.parsedB.months);
      if (sharedLabels.length < 3) {
        alert('Files share fewer than 3 months in common. Cannot compare.'); return;
      }
      state.filteredA = filterToShared(state.parsedA, sharedLabels);
      state.filteredB = filterToShared(state.parsedB, sharedLabels);

      _runComparisonCore();
      document.getElementById('controls-bar-comp')?.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      alert('Comparison error: ' + err.message);
    }
  }

  /** Re-run comparison with the current prices (called when a price input changes). */
  function rerunComparisonWithPrices() {
    if (!state.filteredA || !state.filteredB) return;
    _runComparisonCore();
  }

  function _runComparisonCore() {
    const priceA = parsePrice(document.getElementById('price-a-comp')?.value) || 0;
    const priceB = parsePrice(document.getElementById('price-b-comp')?.value) || 0;
    if (priceA) saveHistory(STORAGE_KEY_PRICES, priceA);
    if (priceB) saveHistory(STORAGE_KEY_PRICES, priceB);
    state.purchasePriceA = priceA;
    state.purchasePriceB = priceB;

    state.resultA  = Engine.analyse(state.filteredA, priceA, null, null);
    state.resultB  = Engine.analyse(state.filteredB, priceB, null, null);
    state.reasonsA = RuleEngine.analyse(state.resultA.metrics, state.resultA.months, getAssetInfo('a'));
    state.reasonsB = RuleEngine.analyse(state.resultB.metrics, state.resultB.months, getAssetInfo('b'));
    state.reasonsA = Enrichment.enrichAll(state.resultA, state.reasonsA, state.dataContext);
    state.reasonsB = Enrichment.enrichAll(state.resultB, state.reasonsB, state.dataContext);

    [
      { result: state.resultA },
      { result: state.resultB },
    ].forEach(({ result }) => {
      (result.metrics || []).forEach(metric => {
        (metric.anomalies || []).forEach(relIdx => {
          if (!metric.reasonData?.[relIdx]) return;
          const coMovers = metric.reasonData[relIdx]?.reasonerResult?.primary?.matchedMetrics || [];
          metric.reasonData[relIdx].anomalyProfile = Enricher.enrichAnomaly(
            metric,
            relIdx,
            result.metrics,
            result.months,
            coMovers,
            state.cloudHistory
          );
          const situationProfile = Narrator.profile(
            metric.reasonData[relIdx], metric, state.dataContext
          );
          const narrativeResult = Composer.compose(
            metric.reasonData[relIdx], metric, state.dataContext, situationProfile
          );
          metric.reasonData[relIdx].situationProfile = situationProfile;
          metric.reasonData[relIdx].narrativeResult = narrativeResult;

          if (narrativeResult?.narrative) {
            const hasCoMovers =
              metric.reasonData[relIdx].anomalyProfile?.causalityChain?.likelyCause !== null ||
              (metric.reasonData[relIdx].anomalyProfile?.causalityChain?.effects?.length || 0) > 0;
            if (narrativeResult.angle !== 'ANOMALY_ALERT' || hasCoMovers) {
              metric.reasonData[relIdx].enrichedPrimary = narrativeResult.narrative;
            }
          }

          // Generate alt narratives using ranked angles (always 2–4)
          if (situationProfile?.rankedAngles) {
            const altAngles = situationProfile.rankedAngles.slice(1); // skip dominant — already used
            const existingAlts = metric.reasonData[relIdx].alternatives || [];
            const paddedAngles = [...altAngles];
            while (paddedAngles.length < 2) paddedAngles.push('ANOMALY_ALERT');
            metric.reasonData[relIdx].enrichedAlternatives = paddedAngles
              .map((altAngle, i) => {
                const altResult = Composer.compose(
                  metric.reasonData[relIdx], metric, state.dataContext, situationProfile, altAngle
                );
                return altResult || { narrative: existingAlts[i] || '', angle: altAngle };
              })
              .filter(result => result?.angle !== 'ANOMALY_ALERT')
              .slice(0, 4)
              .map(result => result.narrative || '');
          }
        });
      });
    });

    renderComparisonView();
  }

  function filterToShared(parsed, sharedLabels) {
    const sharedSet = new Set(sharedLabels);
    const indices = parsed.months.map((m, i) => sharedSet.has(m) ? i : -1).filter(i => i >= 0);
    return {
      months: indices.map(i => parsed.months[i]),
      metrics: parsed.metrics.map(m => ({
        ...m, values: indices.map(i => m.values[i] || 0),
      })),
    };
  }

  function renderComparisonView() {
    if (!state.resultA || !state.resultB) return;

    // Dashboard
    const dashEl = document.getElementById('dashboard-container-comp');
    if (dashEl) {
      dashEl.innerHTML =
        UI.renderDashboard(state.resultA, state.propertyNameA) +
        UI.renderDashboard(state.resultB, state.propertyNameB);
      dashEl.classList.remove('hidden');
    }

    // Delta rows
    const deltasMap = {}, deltaAnomaliesMap = {};
    state.resultA.metrics.forEach(mA => {
      const mB = state.resultB.metrics.find(m => m.name === mA.name);
      if (!mB) return;
      const { deltas, deltaAnomalies } = Engine.calcDeltaRow(
        mA.displayValues || mA.values,
        mB.displayValues || mB.values,
        state.resultA.activeMonths
      );
      deltasMap[mA.name] = deltas;
      deltaAnomaliesMap[mA.name] = deltaAnomalies;
    });

    const tableEl = document.getElementById('table-container-comp');
    if (tableEl) {
      const { html, rowCount } = UI.renderComparisonTable(
        state.resultA, state.resultB, deltasMap, deltaAnomaliesMap,
        { materialFocus: state.materialFocus, sectionFilter: state.sectionFilter, viewFilter: state.viewFilter }
      );
      tableEl.innerHTML = html;
      attachCellClicks(tableEl, state.resultA);
      attachCellClicks(tableEl, state.resultB);
      tableEl.classList.remove('hidden');

      const totalA = state.resultA.metrics.filter(m => m.type !== 'all_zero').length;
      const totalB = state.resultB.metrics.filter(m => m.type !== 'all_zero').length;
      const total = Math.max(totalA, totalB);
      const countEl = document.getElementById('row-count-comp');
      if (countEl) countEl.textContent = `${rowCount} of ${total} metric groups`;

      document.getElementById('legend-comp')?.classList.remove('hidden');
    }
  }

  // ── CELL CLICK → DETAIL CARD ──────────────────────────

  function attachCellClicks(container, result) {
    container.querySelectorAll('[data-anomaly="1"]').forEach(cell => {
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        const metricId = cell.dataset.metric;
        const ri = parseInt(cell.dataset.ri);
        const metric = result.metrics.find(m => m.id === metricId);
        if (!metric) return;

        const dispIdx = result.displayMonths ? result.displayMonths[ri] : ri;
        const monthLabel = result.months[dispIdx] || '';
        const reasonData = metric.reasonData && metric.reasonData[ri];

        // Find correct detail card (active screen)
        const cardId = state.mode === 'comparison' ? 'detail-card-comp' : 'detail-card';
        const cardEl = document.getElementById(cardId);
        if (cardEl) {
          cardEl.innerHTML = '<button class="close-card" title="Close">✕</button>' +
            UI.renderAnomalyCard(reasonData, metric, monthLabel);
          cardEl.classList.add('open');
        }
      });
    });
  }

  // ── MATERIAL FOCUS & FILTERS ──────────────────────────

  function toggleMaterialFocus(btnEl) {
    state.materialFocus = !state.materialFocus;
    if (btnEl) {
      btnEl.classList.toggle('active', state.materialFocus);
      btnEl.textContent = state.materialFocus ? '✦ Material Focus ON' : 'Material Focus';
    }
    if (state.mode === 'analyzer') renderAnalyzerTable();
    else renderComparisonView();
  }

  // ── EVENT WIRING ──────────────────────────────────────

  function init() {

    // ── Populate location dropdowns ──
    populateStateDropdown('state-select');
    populateStateDropdown('state-select-comp');
    populateStateDropdown('state-ea');

    // Wire city autocomplete widgets
    setupCityAutocomplete('city-input', 'city-dropdown-list', city => {
      state.selectedCity = city;
      const compInp = document.getElementById('city-input-comp');
      if (compInp) compInp.value = city;
      if (state.selectedState && city) {
        saveLocation(state.selectedState, city);
        fetchContextIfReady();
      }
    });
    setupCityAutocomplete('city-input-comp', 'city-dropdown-list-comp', city => {
      state.selectedCity = city;
      const inp = document.getElementById('city-input');
      if (inp) inp.value = city;
      if (state.selectedState && city) {
        saveLocation(state.selectedState, city);
        fetchContextIfReady('status-msg-comp');
      }
    });

    setupCityAutocomplete('city-ea', 'city-dropdown-list-ea', city => {
      state.cityEA = city;
    });

    // Restore last-used location
    const savedLoc = loadLocation();
    if (savedLoc?.stateAbbr) {
      const ss = document.getElementById('state-select');
      if (ss) ss.value = savedLoc.stateAbbr;
      state.selectedState = savedLoc.stateAbbr;
      loadCityAutocomplete('city-input', 'city-dropdown-list', savedLoc.stateAbbr).then(() => {
        if (savedLoc.city) {
          const inp = document.getElementById('city-input');
          if (inp) inp.value = savedLoc.city;
          state.selectedCity = savedLoc.city;
        }
      });
      const ssc = document.getElementById('state-select-comp');
      if (ssc) ssc.value = savedLoc.stateAbbr;
      loadCityAutocomplete('city-input-comp', 'city-dropdown-list-comp', savedLoc.stateAbbr).then(() => {
        if (savedLoc.city) {
          const compInp = document.getElementById('city-input-comp');
          if (compInp) compInp.value = savedLoc.city;
        }
      });
    }

    // State change → reload cities for both screens
    document.getElementById('state-select')?.addEventListener('change', async e => {
      const abbr = e.target.value;
      state.selectedState = abbr;
      state.selectedCity  = '';
      state.dataContext   = null;
      const ssc = document.getElementById('state-select-comp');
      if (ssc) ssc.value = abbr;
      await Promise.all([
        loadCityAutocomplete('city-input',      'city-dropdown-list',      abbr),
        loadCityAutocomplete('city-input-comp', 'city-dropdown-list-comp', abbr),
      ]);
    });

    // Comp state change → reload cities for both screens
    document.getElementById('state-select-comp')?.addEventListener('change', async e => {
      const abbr = e.target.value;
      state.selectedState = abbr;
      state.selectedCity  = '';
      state.dataContext   = null;
      const ss = document.getElementById('state-select');
      if (ss) ss.value = abbr;
      await Promise.all([
        loadCityAutocomplete('city-input-comp', 'city-dropdown-list-comp', abbr),
        loadCityAutocomplete('city-input',      'city-dropdown-list',      abbr),
      ]);
    });

    // EA state change → reload EA cities
    document.getElementById('state-ea')?.addEventListener('change', async e => {
      const abbr = e.target.value;
      state.stateEA = abbr;
      state.cityEA  = '';
      await loadCityAutocomplete('city-ea', 'city-dropdown-list-ea', abbr);
    });

    // Mode selection (onclick on the cards already handles this via
    // oaasSelectMode; these listeners are an additional layer)
    document.getElementById('btn-analyzer')?.addEventListener('click', () => selectMode('analyzer'));
    document.getElementById('btn-comparison')?.addEventListener('click', () => selectMode('comparison'));
    document.getElementById('nav-executive')?.addEventListener('click', () => selectMode('executive'));

    // Back buttons
    document.querySelectorAll('.btn-back').forEach(btn => {
      btn.addEventListener('click', () => { resetState(); showScreen('screen-home'); });
    });

    // ── Analyzer file upload ──
    document.getElementById('file-a')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = ''; // reset so same file can be re-selected
      state.fileNameA = file.name;
      setUploadLabel('upload-btn-a', '📂 ' + file.name);
      // Auto-extract property name from file name pattern:
      // "12_Month_Cash_Flow_[PropertyName]_Accrual.xlsx"
      const nameMatch = file.name.match(/Cash_Flow_(.+?)_Accrual/i);
      if (nameMatch && nameMatch[1]) {
        const extractedName = nameMatch[1].replace(/_/g, ' ').trim();
        const propNameInput = document.getElementById('analyzer-property-name');
        if (propNameInput) propNameInput.value = extractedName;
        const savedPrice = getSavedPrice(extractedName);
        if (savedPrice) { const priceInput = document.getElementById('price-a'); if (priceInput) priceInput.value = savedPrice; }
      }
      try {
        const rows = await readFileAsRows(file);
        state.parsedA = Engine.parseSheet(rows);
        if (state.parsedA.extractedCity) {
          const city = state.parsedA.extractedCity;
          const stateAbbr = CITY_STATE_MAP[city];
          if (stateAbbr) {
            state.selectedState = stateAbbr;
            const ss = document.getElementById('state-select');
            if (ss) ss.value = stateAbbr;
          }
          loadCityAutocomplete('city-input', 'city-dropdown-list', stateAbbr || state.selectedState).then(() => {
            const inp = document.getElementById('city-input');
            if (inp) inp.value = city;
            state.selectedCity = city;
          });
        }
        populatePeriodSelects(state.parsedA.months);
        showMsg(`Loaded: ${state.parsedA.months.length} months · ${state.parsedA.metrics.length} metrics`);
        saveFileToHistory(file.name, state.parsedA);
        state.isSaved = false;
        document.getElementById('save-analysis-btn')?.classList.add('hidden');
        // Auto-fetch context if location already selected
        if (state.selectedState && state.selectedCity) fetchContextIfReady();
      } catch (err) { console.error(err); alert('Error reading file: ' + err.message); }
    });

    // ── Recent file buttons ──
    document.getElementById('file-hist-btn-a')?.addEventListener('click', function() {
      showFileHistoryDropdown(this, (name, data) => {
        state.parsedA = data; state.fileNameA = name;
        setUploadLabel('upload-btn-a', '📂 ' + name);
        const nameMatch = name.match(/Cash_Flow_(.+?)_Accrual/i);
        if (nameMatch && nameMatch[1]) {
          const extractedName = nameMatch[1].replace(/_/g, ' ').trim();
          const propNameInput = document.getElementById('analyzer-property-name');
          if (propNameInput) propNameInput.value = extractedName;
          const savedPrice = getSavedPrice(extractedName);
          if (savedPrice) { const priceInput = document.getElementById('price-a'); if (priceInput) priceInput.value = savedPrice; }
        }
        if (data.extractedCity) {
          const city = data.extractedCity;
          const stateAbbr = CITY_STATE_MAP[city];
          if (stateAbbr) {
            state.selectedState = stateAbbr;
            const ss = document.getElementById('state-select');
            if (ss) ss.value = stateAbbr;
          }
          loadCityAutocomplete('city-input', 'city-dropdown-list', stateAbbr || state.selectedState).then(() => {
            const inp = document.getElementById('city-input');
            if (inp) inp.value = city;
            state.selectedCity = city;
          });
        }
        populatePeriodSelects(data.months);
        showMsg(`Restored: ${data.months.length} months · ${data.metrics.length} metrics`);
        if (state.selectedState && state.selectedCity) fetchContextIfReady();
      });
    });

    // ── Comparison file uploads ──
    document.getElementById('file-a-comp')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      state.fileNameA = file.name;
      setUploadLabel('upload-btn-a-comp', '📂 ' + file.name);
      try {
        const rows = await readFileAsRows(file);
        state.parsedA = Engine.parseSheet(rows);
        showMsg('Asset A loaded: ' + state.parsedA.months.length + ' months', 'status-msg-comp');
        saveFileToHistory(file.name, state.parsedA);
        if (state.selectedState && state.selectedCity) fetchContextIfReady('status-msg-comp');
      } catch (err) { alert('Error reading File A: ' + err.message); }
    });

    document.getElementById('file-b-comp')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      state.fileNameB = file.name;
      setUploadLabel('upload-btn-b-comp', '📂 ' + file.name);
      try {
        const rows = await readFileAsRows(file);
        state.parsedB = Engine.parseSheet(rows);
        showMsg('Asset B loaded: ' + state.parsedB.months.length + ' months', 'status-msg-comp');
        saveFileToHistory(file.name, state.parsedB);
        if (state.selectedState && state.selectedCity) fetchContextIfReady('status-msg-comp');
      } catch (err) { alert('Error reading File B: ' + err.message); }
    });

    document.getElementById('file-hist-btn-a-comp')?.addEventListener('click', function() {
      showFileHistoryDropdown(this, (name, data) => {
        state.parsedA = data; state.fileNameA = name;
        setUploadLabel('upload-btn-a-comp', '📂 ' + name);
        showMsg('Asset A restored: ' + data.months.length + ' months', 'status-msg-comp');
        if (state.selectedState && state.selectedCity) fetchContextIfReady('status-msg-comp');
      });
    });

    document.getElementById('file-hist-btn-b-comp')?.addEventListener('click', function() {
      showFileHistoryDropdown(this, (name, data) => {
        state.parsedB = data; state.fileNameB = name;
        setUploadLabel('upload-btn-b-comp', '📂 ' + name);
        showMsg('Asset B restored: ' + data.months.length + ' months', 'status-msg-comp');
        if (state.selectedState && state.selectedCity) fetchContextIfReady('status-msg-comp');
      });
    });

    // ── Executive Analysis file upload ──
    document.getElementById('file-ea')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      e.target.value = '';
      setUploadLabel('ea-upload-label', '📂 ' + file.name);
      const nameMatch = file.name.match(/Cash_Flow_(.+?)_Accrual/i);
      if (nameMatch && nameMatch[1]) {
        const extractedName = nameMatch[1].replace(/_/g, ' ').trim();
        const propNameInput = document.getElementById('ea-property-name');
        if (propNameInput) propNameInput.value = extractedName;
        const savedPrice = getSavedPrice(extractedName);
        if (savedPrice) { const priceInput = document.getElementById('price-ea'); if (priceInput) priceInput.value = savedPrice; }
      }
      try {
        const rows = await readFileAsRows(file);
        state.resultEA = Engine.parseSheet(rows);
        if (state.resultEA.extractedCity) {
          const city = state.resultEA.extractedCity;
          const stateAbbr = CITY_STATE_MAP[city];
          if (stateAbbr) {
            state.stateEA = stateAbbr;
            const ss = document.getElementById('state-ea');
            if (ss) ss.value = stateAbbr;
          }
          loadCityAutocomplete('city-ea', 'city-dropdown-list-ea', stateAbbr || state.stateEA).then(() => {
            const inp = document.getElementById('city-ea');
            if (inp) inp.value = city;
            state.cityEA = city;
          });
        }
        saveFileToHistory(file.name, state.resultEA);
        const runExecBtn = document.getElementById('btn-run-executive');
        if (runExecBtn) runExecBtn.disabled = false;
      } catch (err) { console.error(err); alert('Error reading file: ' + err.message); }
    });

    document.getElementById('file-hist-btn-ea')?.addEventListener('click', function() {
      showFileHistoryDropdown(this, (name, data) => {
        state.resultEA = data;
        setUploadLabel('ea-upload-label', '📂 ' + name);
        const nameMatch = name.match(/Cash_Flow_(.+?)_Accrual/i);
        if (nameMatch && nameMatch[1]) {
          const extractedName = nameMatch[1].replace(/_/g, ' ').trim();
          const propNameInput = document.getElementById('ea-property-name');
          if (propNameInput) propNameInput.value = extractedName;
          const savedPrice = getSavedPrice(extractedName);
          if (savedPrice) { const priceInput = document.getElementById('price-ea'); if (priceInput) priceInput.value = savedPrice; }
        }
        if (data.extractedCity) {
          const city = data.extractedCity;
          const stateAbbr = CITY_STATE_MAP[city];
          if (stateAbbr) {
            state.stateEA = stateAbbr;
            const ss = document.getElementById('state-ea');
            if (ss) ss.value = stateAbbr;
          }
          loadCityAutocomplete('city-ea', 'city-dropdown-list-ea', stateAbbr || state.stateEA).then(() => {
            const inp = document.getElementById('city-ea');
            if (inp) inp.value = city;
            state.cityEA = city;
          });
        }
        const runExecBtn = document.getElementById('btn-run-executive');
        if (runExecBtn) runExecBtn.disabled = false;
      });
    });

    // ── Price inputs: re-run analysis on any value change ──
    let _priceATimer, _priceCompTimer;
    const priceA = document.getElementById('price-a');
    if (priceA) {
      priceA.addEventListener('input', () => { clearTimeout(_priceATimer); _priceATimer = setTimeout(rerunAnalysisWithPrice, 500); });
      priceA.addEventListener('blur', rerunAnalysisWithPrice);
    }
    ['price-a-comp', 'price-b-comp'].forEach(id => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => { clearTimeout(_priceCompTimer); _priceCompTimer = setTimeout(rerunComparisonWithPrices, 500); });
        el.addEventListener('blur', rerunComparisonWithPrices);
      }
    });

    // ── Price history buttons ──
    document.getElementById('price-hist-btn-a')?.addEventListener('click', () => {
      buildHistoryDropdown(document.getElementById('price-a'), STORAGE_KEY_PRICES);
    });
    document.getElementById('price-hist-btn-a-comp')?.addEventListener('click', () => {
      buildHistoryDropdown(document.getElementById('price-a-comp'), STORAGE_KEY_PRICES);
    });
    document.getElementById('price-hist-btn-b-comp')?.addEventListener('click', () => {
      buildHistoryDropdown(document.getElementById('price-b-comp'), STORAGE_KEY_PRICES);
    });

    // ── Name history buttons ──
    document.getElementById('name-hist-btn-a')?.addEventListener('click', () => {
      buildHistoryDropdown(document.getElementById('prop-name-a'), STORAGE_KEY_NAMES);
    });
    document.getElementById('name-hist-btn-b')?.addEventListener('click', () => {
      buildHistoryDropdown(document.getElementById('prop-name-b'), STORAGE_KEY_NAMES);
    });

    // ── Analyze button ──
    document.getElementById('btn-analyze')?.addEventListener('click', runAnalysis);

    // ── Period filter apply ──
    document.getElementById('btn-apply-period')?.addEventListener('click', runAnalysis);

    // ── Compare button ──
    document.getElementById('btn-compare')?.addEventListener('click', runComparison);

    // ── Analyzer controls ──
    document.getElementById('btn-material-focus')?.addEventListener('click', function() {
      toggleMaterialFocus(this);
    });

    document.getElementById('save-analysis-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('save-analysis-btn');
      btn.disabled = true;
      btn.textContent = '💾 Saving...';
      try {
        await saveAnalysisToCloud(state.resultA, state.reasonsA, state.dataContext);
        detectPatternsInCloud(state.resultA, state.reasonsA); // fire-and-forget
        await fetchRuleCandidates();
        if (state.ruleCandidates.length > 0) showRuleCandidates();
        btn.textContent = '✅ Saved';
        state.isSaved = true;
      } catch (err) {
        btn.textContent = '❌ Failed';
        btn.disabled = false;
      }
    });
    document.getElementById('btn-run-executive')?.addEventListener('click', async () => {
      if (!state.resultEA) return;

      state.propertyNameEA = document.getElementById('ea-property-name')?.value.trim() || 'Unknown Property';

      const priceRaw = document.getElementById('price-ea')?.value?.replace(/[^0-9.]/g, '');
      const purchasePrice = parseFloat(priceRaw) || 0;
      if (purchasePrice && state.propertyNameEA) savePrice(state.propertyNameEA, document.getElementById('price-ea')?.value);

      if (!purchasePrice) {
        alert('Please enter a purchase price.');
        return;
      }

      state.executiveResult = Executive.analyseCategories(
        state.resultEA.metrics,
        state.resultEA.months,
        purchasePrice
      );
      state.executiveResult.metrics      = state.resultEA.metrics;
      state.executiveResult.months       = state.resultEA.months;
      state.executiveResult.stateAbbr    = state.stateEA;
      state.executiveResult.city         = state.cityEA;
      state.executiveResult.propertyName = state.propertyNameEA;
      state.executiveResult.purchasePrice = purchasePrice;
      state.executiveResult.fema = state.dataContextEA?.fema || [];
      UI.renderEACards(state.executiveResult);
    });

    document.getElementById('section-filter')?.addEventListener('change', e => {
      state.sectionFilter = e.target.value;
      if (state.mode === 'analyzer') renderAnalyzerTable();
    });

    // ── Dark / light mode toggle ──
    function applyTheme(dark) {
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      const icon = dark ? '🌙' : '☀️';
      document.querySelectorAll('.btn-theme-toggle').forEach(btn => btn.textContent = icon);
      localStorage.setItem('oaas-theme', dark ? 'dark' : 'light');
    }
    function toggleTheme() { applyTheme(document.documentElement.getAttribute('data-theme') !== 'dark'); }
    document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);
    document.getElementById('btn-theme-toggle-comp')?.addEventListener('click', toggleTheme);
    // Restore saved preference
    applyTheme(localStorage.getItem('oaas-theme') === 'dark');

    // ── Comparison controls ──
    document.getElementById('btn-material-focus-comp')?.addEventListener('click', function() {
      toggleMaterialFocus(this);
    });
    document.getElementById('section-filter-comp')?.addEventListener('change', e => {
      state.sectionFilter = e.target.value;
      renderComparisonView();
    });
    document.getElementById('view-filter-comp')?.addEventListener('change', e => {
      state.viewFilter = e.target.value;
      renderComparisonView();
    });

    // ── Export ──
    function wireExport(btnId, menuId, htmlFullId, htmlFiltId, excelId) {
      document.getElementById(btnId)?.addEventListener('click', () => {
        document.getElementById(menuId)?.classList.toggle('hidden');
      });
      document.getElementById(htmlFullId)?.addEventListener('click', () => {
        document.getElementById(menuId)?.classList.add('hidden');
        if (state.mode === 'comparison') {
          const tEl = document.getElementById('table-container-comp');
          const dEl = document.getElementById('dashboard-container-comp');
          Exporter.exportComparisonHTML(tEl?.innerHTML || '', dEl?.innerHTML || '', state.propertyNameA, state.propertyNameB);
        } else {
          const tEl = document.getElementById('table-container');
          Exporter.exportHTML(tEl?.innerHTML || '', state.fileNameA || 'Anomaly Report');
        }
      });
      document.getElementById(htmlFiltId)?.addEventListener('click', () => {
        document.getElementById(menuId)?.classList.add('hidden');
        const tElId = state.mode === 'comparison' ? 'table-container-comp' : 'table-container';
        Exporter.exportHTML(document.getElementById(tElId)?.innerHTML || '', state.fileNameA || 'Report');
      });
      document.getElementById(excelId)?.addEventListener('click', () => {
        document.getElementById(menuId)?.classList.add('hidden');
        if (state.resultA) Exporter.exportExcel(state.resultA, state.fileNameA || 'report', state.purchasePriceA, state.materialFocus, state.reasonsA);
      });
    }

    wireExport('export-btn', 'export-menu', 'export-html-full', 'export-html-filtered', 'export-excel-full');
    wireExport('export-btn-comp', 'export-menu-comp', 'export-html-full-comp', 'export-html-filtered-comp', 'export-excel-full-comp');

    // ── Detail card close ──
    ['detail-card', 'detail-card-comp', 'detail-card-ea'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', e => {
        if (e.target.classList.contains('close-card')) {
          e.stopPropagation();
          document.getElementById(id)?.classList.remove('open');
        }
      });
    });

    // Close export menus and detail panels when clicking outside
    document.addEventListener('click', e => {
      ['export-menu', 'export-menu-comp'].forEach(id => {
        const menu = document.getElementById(id);
        const btn  = document.getElementById(id.replace('menu', 'btn'));
        if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
          menu.classList.add('hidden');
        }
      });
      ['detail-card', 'detail-card-comp', 'detail-card-ea'].forEach(id => {
        const panel = document.getElementById(id);
        if (panel && panel.classList.contains('open') && !panel.contains(e.target)) {
          panel.classList.remove('open');
        }
      });
    });
  }

  // ── SELECT MODE ───────────────────────────────────────
  // Also exposed globally via window.oaasSelectMode for onclick fallback

  function selectMode(mode) {
    state.mode = mode;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const s = document.getElementById('screen-' + mode);
    if (s) s.classList.add('active');
  }

  return { init, selectMode, _state: state };
})();

// Global fallback — used by onclick attributes on mode cards (guarantees
// navigation even if addEventListener wiring fails for any reason).
window.oaasSelectMode = function(mode) { App.selectMode(mode); };

// Warn before leaving if analysis is unsaved
window.addEventListener('beforeunload', (e) => {
  if (App._state?.resultA && !App._state?.isSaved) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// Scripts live at the bottom of <body> so the DOM is fully built.
// Call init() directly — DOMContentLoaded may have already fired.
try { App.init(); } catch (e) { console.error('OAAS init error:', e); }
