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
    state.purchasePriceA = 0; state.purchasePriceB = 0;
    state.materialFocus = false; state.sectionFilter = 'all'; state.viewFilter = 'both';
    state.propertyNameA = 'Asset A'; state.propertyNameB = 'Asset B';
    state.fileNameA = null; state.fileNameB = null;

    // Reset upload button labels
    ['upload-btn-a', 'upload-btn-a-comp', 'upload-btn-b-comp'].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.textContent = id.includes('b') ? 'Upload File B' : 'Upload File';
    });

    // Reset price/name inputs
    ['price-a', 'price-a-comp', 'price-b-comp'].forEach(id => {
      const e = document.getElementById(id); if (e) e.value = '';
    });
    ['prop-name-a', 'prop-name-b'].forEach(id => {
      const e = document.getElementById(id); if (e) e.value = '';
    });

    // Reset period selects
    ['period-start', 'period-end'].forEach(id => {
      const e = document.getElementById(id); if (e) e.innerHTML = '';
    });

    // Clear output areas (both screens)
    ['table-container', 'table-container-comp',
     'dashboard-container', 'dashboard-container-comp',
     'detail-card', 'detail-card-comp',
     'status-msg', 'status-msg-comp'].forEach(id => {
      const e = document.getElementById(id);
      if (e) { e.innerHTML = ''; e.classList.add('hidden'); }
    });

    ['controls-bar', 'controls-bar-comp'].forEach(id => {
      const e = document.getElementById(id);
      if (e) e.classList.add('hidden');
    });
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

  function runAnalysis() {
    if (!state.parsedA) { alert('Please upload a file first.'); return; }

    const price = parsePrice(document.getElementById('price-a')?.value);
    if (!price) { alert('Please enter a valid purchase price.'); return; }
    state.purchasePriceA = price;
    saveHistory(STORAGE_KEY_PRICES, price);

    const inStart = document.getElementById('period-start');
    const inEnd   = document.getElementById('period-end');
    const pStart = inputValueToIdx(inStart?.value, state.parsedA.months);
    const pEnd   = inputValueToIdx(inEnd?.value,   state.parsedA.months);
    // Fall back to full range if picker values don't map to a known month
    const resolvedStart = pStart >= 0 ? pStart : null;
    const resolvedEnd   = pEnd   >= 0 ? pEnd   : null;

    try {
      state.resultA = Engine.analyse(state.parsedA, price, resolvedStart, resolvedEnd);
      state.reasonsA = RuleEngine.analyse(state.resultA.metrics, state.resultA.months, getAssetInfo('a'));
      renderAnalyzerTable();
      document.getElementById('controls-bar')?.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      alert('Analysis error: ' + err.message);
    }
  }

  function renderAnalyzerTable() {
    const tableEl = document.getElementById('table-container');
    if (!tableEl || !state.resultA) return;
    tableEl.innerHTML = UI.renderTable(state.resultA, {
      materialFocus: state.materialFocus,
      sectionFilter: state.sectionFilter,
    });
    attachCellClicks(tableEl, state.resultA);
    tableEl.classList.remove('hidden');
  }

  // ── COMPARISON: RUN ───────────────────────────────────

  function runComparison() {
    if (!state.parsedA || !state.parsedB) { alert('Please upload both files.'); return; }

    const priceA = parsePrice(document.getElementById('price-a-comp')?.value);
    const priceB = parsePrice(document.getElementById('price-b-comp')?.value);
    if (!priceA) { alert('Enter a valid purchase price for Asset A.'); return; }
    if (!priceB) { alert('Enter a valid purchase price for Asset B.'); return; }

    state.purchasePriceA = priceA;
    state.purchasePriceB = priceB;
    saveHistory(STORAGE_KEY_PRICES, priceA);
    saveHistory(STORAGE_KEY_PRICES, priceB);

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

      const filteredA = filterToShared(state.parsedA, sharedLabels);
      const filteredB = filterToShared(state.parsedB, sharedLabels);

      state.resultA = Engine.analyse(filteredA, priceA, null, null);
      state.resultB = Engine.analyse(filteredB, priceB, null, null);
      state.reasonsA = RuleEngine.analyse(state.resultA.metrics, state.resultA.months, getAssetInfo('a'));
      state.reasonsB = RuleEngine.analyse(state.resultB.metrics, state.resultB.months, getAssetInfo('b'));

      renderComparisonView();
      document.getElementById('controls-bar-comp')?.classList.remove('hidden');
    } catch (err) {
      console.error(err);
      alert('Comparison error: ' + err.message);
    }
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
      tableEl.innerHTML = UI.renderComparisonTable(
        state.resultA, state.resultB, deltasMap, deltaAnomaliesMap,
        { materialFocus: state.materialFocus, sectionFilter: state.sectionFilter, viewFilter: state.viewFilter }
      );
      attachCellClicks(tableEl, state.resultA);
      attachCellClicks(tableEl, state.resultB);
      tableEl.classList.remove('hidden');
    }
  }

  // ── CELL CLICK → DETAIL CARD ──────────────────────────

  function attachCellClicks(container, result) {
    container.querySelectorAll('[data-anomaly="1"]').forEach(cell => {
      cell.style.cursor = 'pointer';
      cell.addEventListener('click', () => {
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
          cardEl.classList.remove('hidden');
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

    // Mode selection (onclick on the cards already handles this via
    // oaasSelectMode; these listeners are an additional layer)
    document.getElementById('btn-analyzer')?.addEventListener('click', () => selectMode('analyzer'));
    document.getElementById('btn-comparison')?.addEventListener('click', () => selectMode('comparison'));

    // Back buttons
    document.querySelectorAll('.btn-back').forEach(btn => {
      btn.addEventListener('click', () => { resetState(); showScreen('screen-home'); });
    });

    // ── Analyzer file upload ──
    document.getElementById('file-a')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      state.fileNameA = file.name;
      document.getElementById('upload-btn-a').textContent = '📂 ' + file.name;
      try {
        const rows = await readFileAsRows(file);
        state.parsedA = Engine.parseSheet(rows);
        populatePeriodSelects(state.parsedA.months);
        showMsg(`Loaded: ${state.parsedA.months.length} months · ${state.parsedA.metrics.length} metrics`);
      } catch (err) { console.error(err); alert('Error reading file: ' + err.message); }
    });

    // ── Comparison file uploads ──
    document.getElementById('file-a-comp')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      state.fileNameA = file.name;
      document.getElementById('upload-btn-a-comp').textContent = '📂 ' + file.name;
      try {
        const rows = await readFileAsRows(file);
        state.parsedA = Engine.parseSheet(rows);
        showMsg('Asset A loaded: ' + state.parsedA.months.length + ' months', 'status-msg-comp');
      } catch (err) { alert('Error reading File A: ' + err.message); }
    });

    document.getElementById('file-b-comp')?.addEventListener('change', async e => {
      const file = e.target.files[0]; if (!file) return;
      state.fileNameB = file.name;
      document.getElementById('upload-btn-b-comp').textContent = '📂 ' + file.name;
      try {
        const rows = await readFileAsRows(file);
        state.parsedB = Engine.parseSheet(rows);
        showMsg('Asset B loaded: ' + state.parsedB.months.length + ' months', 'status-msg-comp');
      } catch (err) { alert('Error reading File B: ' + err.message); }
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
    document.getElementById('section-filter')?.addEventListener('change', e => {
      state.sectionFilter = e.target.value;
      if (state.mode === 'analyzer') renderAnalyzerTable();
    });

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
        if (state.resultA) Exporter.exportExcel(state.resultA, state.fileNameA || 'report', state.purchasePriceA, state.materialFocus);
      });
    }

    wireExport('export-btn', 'export-menu', 'export-html-full', 'export-html-filtered', 'export-excel-full');
    wireExport('export-btn-comp', 'export-menu-comp', 'export-html-full-comp', 'export-html-filtered-comp', 'export-excel-full-comp');

    // ── Detail card close ──
    ['detail-card', 'detail-card-comp'].forEach(id => {
      document.getElementById(id)?.addEventListener('click', e => {
        if (e.target.classList.contains('close-card')) {
          document.getElementById(id)?.classList.add('hidden');
        }
      });
    });

    // Close export menus when clicking outside
    document.addEventListener('click', e => {
      ['export-menu', 'export-menu-comp'].forEach(id => {
        const menu = document.getElementById(id);
        const btn  = document.getElementById(id.replace('menu', 'btn'));
        if (menu && btn && !menu.contains(e.target) && !btn.contains(e.target)) {
          menu.classList.add('hidden');
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

  return { init, selectMode };
})();

// Global fallback — used by onclick attributes on mode cards (guarantees
// navigation even if addEventListener wiring fails for any reason).
window.oaasSelectMode = function(mode) { App.selectMode(mode); };

// Scripts live at the bottom of <body> so the DOM is fully built.
// Call init() directly — DOMContentLoaded may have already fired.
try { App.init(); } catch (e) { console.error('OAAS init error:', e); }
