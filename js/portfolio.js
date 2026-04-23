const Portfolio = (() => {

  // ── State ────────────────────────────────────────────────────────────────
  const state = {
    properties: [], // { name, fileName, stateAbbr, city, purchasePrice, result, eaResult, dataContext }
    mode: 'oa',    // 'oa' or 'ea'
    analysisRun: false,
    eaMonthMap: new Map(),
  };

  // ── Add property ─────────────────────────────────────────────────────────
  function addProperty(parsed, fileName, propertyName, stateAbbr, city, purchasePrice) {
    // Check for duplicate
    if (state.properties.find(p => p.name === propertyName)) {
      return { error: 'Property already loaded' };
    }
    state.properties.push({
      name: propertyName,
      fileName,
      stateAbbr,
      city,
      purchasePrice: parseFloat((purchasePrice || '0').toString().replace(/[^0-9.]/g, '')) || 0,
      parsed,
      result: null,
      eaResult: null,
      dataContext: null,
    });
    state.analysisRun = false;
    return { success: true };
  }

  // ── Remove property ───────────────────────────────────────────────────────
  function removeProperty(propertyName) {
    state.properties = state.properties.filter(p => p.name !== propertyName);
    state.analysisRun = false;
  }

  // ── Update property field ─────────────────────────────────────────────────
  function updateProperty(propertyName, field, value) {
    const prop = state.properties.find(p => p.name === propertyName);
    if (!prop) return;
    if (field === 'purchasePrice') {
      prop.purchasePrice = parseFloat(value.replace(/[^0-9.]/g, '')) || 0;
      if (window.savePrice) window.savePrice(propertyName, value);
    } else {
      prop[field] = value;
    }
  }

  // ── Set mode ──────────────────────────────────────────────────────────────
  function setMode(mode) {
    state.mode = mode;
  }

  // ── Run OA analysis for all properties ────────────────────────────────────
  async function runOAAnalysis(onProgress) {
    for (let i = 0; i < state.properties.length; i++) {
      const prop = state.properties[i];
      if (onProgress) onProgress(i + 1, state.properties.length, prop.name);

      try {
        // Run engine
        const result = Engine.analyse(prop.parsed, prop.purchasePrice, null, null);
        prop.result = result;

        // Fetch context if location available
        if (prop.stateAbbr && prop.city) {
          prop.dataContext = await Context.fetchDataContext(prop.stateAbbr, prop.city, result.months);
        }

        // Run enrichment
        const reasons = RuleEngine.analyse(result.metrics, result.months, {
          purchasePrice: prop.purchasePrice,
          stateAbbr: prop.stateAbbr,
          city: prop.city,
          name: prop.name,
        });
        prop.reasons = Enrichment.enrichAll(result, reasons, prop.dataContext || {}, {});
        _runNarratorPipeline(result, prop.dataContext || {}, {});

      } catch(e) {
        console.error(`[Portfolio] Error analysing ${prop.name}:`, e);
      }
    }
    state.analysisRun = true;
  }

  // ── Run EA analysis for all properties ────────────────────────────────────
  async function runEAAnalysis(onProgress) {
    for (let i = 0; i < state.properties.length; i++) {
      const prop = state.properties[i];
      if (onProgress) onProgress(i + 1, state.properties.length, prop.name);

      try {
        if (!prop.result) {
          prop.result = Engine.analyse(prop.parsed, prop.purchasePrice, null, null);
        }
        prop.eaResult = Executive.analyseCategories(
          prop.result.metrics,
          prop.result.months,
          prop.purchasePrice
        );
        prop.eaResult.metrics = prop.result.metrics;
        prop.eaResult.months = prop.result.months;
        prop.eaResult.stateAbbr = prop.stateAbbr;
        prop.eaResult.city = prop.city;
        prop.eaResult.propertyName = prop.name;
        prop.eaResult.purchasePrice = prop.purchasePrice;
      } catch(e) {
        console.error(`[Portfolio] Error running EA for ${prop.name}:`, e);
      }
    }

    // Build eaMonthMap keyed by "categoryName||monthLabel"
    const monthMap = new Map();

    state.properties.forEach(prop => {
      if (!prop.eaResult?.flags) return;
      prop.eaResult.flags.forEach(flag => {
        const key = `${flag.categoryName}||${flag.monthLabel}`;
        if (!monthMap.has(key)) {
          monthMap.set(key, {
            key,
            categoryName: flag.categoryName,
            monthLabel: flag.monthLabel,
            totalMovement: 0,
            propertyCount: 0,
            properties: [],
          });
        }
        const entry = monthMap.get(key);
        entry.totalMovement += flag.maxMovement;
        console.log('[EA debug]', prop.name, flag.categoryName, flag.monthLabel, 'maxMovement:', flag.maxMovement, 'direction:', flag.direction, 'running totalMovement:', entry.totalMovement);
        entry.propertyCount += 1;
        entry.properties.push({
          name: prop.name,
          purchasePrice: prop.purchasePrice,
          eaResult: prop.eaResult,
          flag,
        });
      });
    });

    // Sort by absolute totalMovement descending
    state.eaMonthMap = new Map(
      [...monthMap.entries()].sort((a, b) => Math.abs(b[1].totalMovement) - Math.abs(a[1].totalMovement))
    );
  }

  // ── Get combined OA metric list ───────────────────────────────────────────
  function getCombinedOAMetrics() {
    // Collect all unique metric names across all properties
    const metricMap = {}; // metricName → { name, section, properties: [...] }
    const metricOrder = []; // first-seen order (preserves source file metric order)

    state.properties.forEach(prop => {
      if (!prop.result) return;
      prop.result.metrics.forEach(metric => {
        if (!metric.anomalies || metric.anomalies.length === 0) return;
        if (!metricMap[metric.name]) {
          metricMap[metric.name] = {
            name: metric.name,
            section: metric.section,
            properties: [],
            totalAnomalies: 0,
          };
          metricOrder.push(metric.name);
        }
        metricMap[metric.name].properties.push({
          propertyName: prop.name,
          stateAbbr: prop.stateAbbr,
          anomalies: metric.anomalies,       // display-indexed
          reasonData: metric.reasonData,
          months: prop.result.months,         // full months array (absolute)
          displayMonths: metric.displayMonths, // absolute indices of display window
          values: metric.values,              // absolute-indexed
          zScores: metric.zScores,            // display-indexed
        });
        metricMap[metric.name].totalAnomalies += metric.anomalies.length;
      });
    });

    // Return in file order (first appearance across all properties)
    return metricOrder.map(name => metricMap[name]);
  }

  // ── Get combined EA month cards ───────────────────────────────────────────
  function getCombinedEAMonths() {
    // Collect all flagged months across all properties and categories
    const monthMap = {}; // monthLabel → { monthLabel, totalFlags, properties: [{ propertyName, flags: [flagObj] }] }

    state.properties.forEach(prop => {
      if (!prop.eaResult) return;
      prop.eaResult.flags.forEach(flag => {
        if (!monthMap[flag.monthLabel]) {
          monthMap[flag.monthLabel] = {
            monthLabel: flag.monthLabel,
            totalFlags: 0,
            properties: {},
          };
        }
        if (!monthMap[flag.monthLabel].properties[prop.name]) {
          monthMap[flag.monthLabel].properties[prop.name] = {
            propertyName: prop.name,
            flags: [],
          };
        }
        monthMap[flag.monthLabel].properties[prop.name].flags.push({
          ...flag,
          propertyName: prop.name,
          eaResult: prop.eaResult,
        });
        monthMap[flag.monthLabel].totalFlags++;
      });
    });

    // Convert to array, sort by totalFlags descending
    return Object.values(monthMap)
      .map(m => ({ ...m, properties: Object.values(m.properties) }))
      .sort((a, b) => b.totalFlags - a.totalFlags);
  }

  // ── Get union of all months across all properties ─────────────────────────
  function getUnionMonths() {
    const seen = new Set();
    const all = [];
    state.properties.forEach(prop => {
      if (!prop.result) return;
      prop.result.months.forEach(m => {
        if (!seen.has(m)) { seen.add(m); all.push(m); }
      });
    });
    // Sort chronologically
    return all.sort((a, b) => {
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const [amStr, ayStr] = a.split(' ');
      const [bmStr, byStr] = b.split(' ');
      const ay = parseInt(ayStr), by = parseInt(byStr);
      const am = months.indexOf(amStr), bm = months.indexOf(bmStr);
      return ay !== by ? ay - by : am - bm;
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────
  return {
    state,
    addProperty,
    removeProperty,
    setMode,
    runOAAnalysis,
    runEAAnalysis,
    getCombinedOAMetrics,
    getCombinedEAMonths,
    getUnionMonths,
    updateProperty,
  };

})();
