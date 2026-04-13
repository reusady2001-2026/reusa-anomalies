// ============================================================
// ENGINE.JS — Core anomaly detection algorithms
// ============================================================

const Engine = (() => {

  // ── PARSING ─────────────────────────────────────────────

  /**
   * Parse raw 2D array from SheetJS into structured metrics.
   * Returns { months: string[], metrics: MetricObj[], skippedMonthIndices: number[] }
   *
   * Expected sheet structure:
   *   Row 0..N: metadata / title rows (skipped until month header found)
   *   Month header row: first cell empty/name, rest are month labels
   *   INCOME / EXPENSES / NET OPERATING INCOME: section headers
   *   TOTAL ... : total rows (excluded from analysis)
   *   All other rows: individual metric rows
   */
  function parseSheet(rows) {
    // ── extract city from title row ──
    const titleRow0 = rows[0] ? String(rows[0][0] || rows[0][1] || '').trim() : '';
    const cityMatch = titleRow0.match(/ at (.+?) \(/);
    const extractedCity = cityMatch ? cityMatch[1].trim() : null;
    console.log('[Location] row 0 value:', rows[0]?.[0]);
    console.log('[Location] extractedCity:', extractedCity);

    // ── find month header row ──
    let monthRowIdx = -1;
    let months = [];
    let firstDataCol = 1;

    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      const monthCells = row.slice(1).map(c => normalizeMonthLabel(c));
      const validMonths = monthCells.filter(Boolean);
      if (validMonths.length >= 3) {
        // looks like the header row
        monthRowIdx = r;
        // find first valid month col
        for (let c = 1; c < row.length; c++) {
          if (normalizeMonthLabel(row[c])) {
            firstDataCol = c;
            break;
          }
        }
        months = row.slice(firstDataCol).map(c => normalizeMonthLabel(c)).filter(Boolean);
        break;
      }
    }

    if (monthRowIdx === -1 || months.length === 0) {
      throw new Error('Could not detect month header row. Please ensure the file has month labels.');
    }

    // ── iterate data rows ──
    const EXCLUDED_PATTERNS = /^(total|net operating income|income|expenses|noi)/i;
    const SECTION_PATTERNS = /^(income|expenses|net operating income)/i;

    const metrics = [];
    let currentSection = 'UNKNOWN';

    for (let r = monthRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.length === 0) continue;

      const label =
        (row[0] != null && String(row[0]).trim() !== '' ? String(row[0]).trim() : null) ||
        (row[1] != null && String(row[1]).trim() !== '' ? String(row[1]).trim() : null) ||
        (row[2] != null && String(row[2]).trim() !== '' ? String(row[2]).trim() : null) ||
        '';
      if (!label) continue;

      // Normalize: strip zero-width/invisible chars, collapse all whitespace, uppercase
      const normalizedLabel = label
        .replace(/[\u00A0\u200B\u200C\u200D\uFEFF\u00AD]/g, ' ')  // NBSP, zero-width, BOM, soft-hyphen → space
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

      // Check 1 — hard stop at NET OPERATING INCOME
      // Use regex anchor instead of === to survive any residual invisible characters
      if (/^NET\s+OPERATING\s+INCOME$/.test(normalizedLabel)) break;

      // Check 2 — skip TOTAL rows
      if (/^total/i.test(normalizedLabel)) continue;

      // section header detection
      if (SECTION_PATTERNS.test(normalizedLabel)) {
        if (/income/i.test(normalizedLabel) && !/net/i.test(normalizedLabel) && !/expenses/i.test(normalizedLabel)) {
          currentSection = 'INCOME';
        } else if (/expenses/i.test(normalizedLabel)) {
          currentSection = 'EXPENSES';
        }
        continue;
      }

      // skip total / summary rows
      if (EXCLUDED_PATTERNS.test(normalizedLabel)) continue;

      // extract values
      const values = [];
      for (let c = firstDataCol; c < firstDataCol + months.length; c++) {
        const raw = row[c];
        const num = parseFloat(String(raw).replace(/[$,\s]/g, ''));
        values.push(isNaN(num) ? 0 : num);
      }

      // skip all-zero metrics
      if (values.every(v => v === 0)) continue;

      metrics.push({
        id: `${currentSection}_${label}_${r}`,
        name: label,
        section: currentSection,   // 'INCOME' | 'EXPENSES'
        values,                    // one value per month (aligned to months[])
        // filled by classifyAndStats():
        type: null,
        openingIdx: -1,
        mean: 0,
        stdDev: 0,
        changesMean: 0,
        changesStdDev: 0,
        normalizedVolatility: 0,
        threshold: 0,
        zScores: [],               // [{z1, z2, anomalyType, isAnomaly, isReversion, direction}]
        anomalies: [],             // indices of anomalous months
        materialAnomalies: [],
        seasonalityMonths: [],     // indices where cell is solid orange (material seasonality)
        recurringPatterns: [],     // indices where 🔄 shown
        trends: {},
        quarters: {},
        reasonData: {},            // keyed by monthIdx
      });
    }

    return { months, metrics, extractedCity };
  }

  function normalizeMonthLabel(cell) {
    if (cell === null || cell === undefined) return '';
    const s = String(cell).trim();

    // Already looks like "Jan 2024" or "January 2024"
    const monthNames = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const fullNames  = ['january','february','march','april','may','june','july','august','september','october','november','december'];

    // Match "Mon YYYY" or "Month YYYY"
    const m1 = s.match(/^([A-Za-z]+)\s+(\d{4})$/);
    if (m1) {
      const mo = m1[1].toLowerCase();
      const yr = m1[2];
      const idx = monthNames.indexOf(mo.slice(0, 3)) !== -1
        ? monthNames.indexOf(mo.slice(0, 3))
        : fullNames.indexOf(mo);
      if (idx !== -1) return `${capitalise(monthNames[idx])} ${yr}`;
    }

    // Match "MM/YYYY" or "M/YYYY"
    const m2 = s.match(/^(\d{1,2})\/(\d{4})$/);
    if (m2) {
      const mo = parseInt(m2[1]) - 1;
      if (mo >= 0 && mo < 12) return `${capitalise(monthNames[mo])} ${m2[2]}`;
    }

    // Match Excel serial numbers — skip (SheetJS should format them)
    return '';
  }

  function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ── METRIC CLASSIFICATION ─────────────────────────────

  function classifyMetric(values) {
    const total = values.length;
    const zeroCount = values.filter(v => v === 0).length;
    const openingIdx = values.findIndex(v => v !== 0);

    if (openingIdx === -1) return { type: 'all_zero', openingIdx: -1 };

    const cond1 = zeroCount / total > 0.5;
    const valuesAfterOpening = values.slice(openingIdx + 1);
    const cond2 = valuesAfterOpening.some(v => v === 0);

    return {
      type: (cond1 && cond2) ? 'sporadic' : 'continuous',
      openingIdx,
    };
  }

  // ── STATISTICS ────────────────────────────────────────

  function mean(arr) {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function stdDev(arr) {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((acc, v) => acc + (v - m) ** 2, 0) / arr.length);
  }

  function calcContinuousStats(values, openingIdx) {
    const active = values.slice(openingIdx);
    const m = mean(active);
    const sd = stdDev(active);

    // monthly changes within active window
    const changes = [];
    for (let i = 1; i < active.length; i++) {
      changes.push(active[i] - active[i - 1]);
    }
    const changesSD = stdDev(changes);
    const nv = m !== 0 ? changesSD / Math.abs(m) : 0;
    const threshold = Math.max(1.0, 0.04 * nv);

    return { mean: m, stdDev: sd, changesMean: mean(changes), changesStdDev: changesSD, normalizedVolatility: nv, threshold };
  }

  function calcSporadicStats(values) {
    const m = mean(values);
    const sd = stdDev(values);

    // for sporadic, changes still needed for NV threshold calc
    const changes = [];
    for (let i = 1; i < values.length; i++) changes.push(values[i] - values[i - 1]);
    const changesSD = stdDev(changes);
    const nv = m !== 0 ? changesSD / Math.abs(m) : 0;
    const ratioFloor = sd !== 0 ? Math.abs(m) / sd : 0;
    const threshold = Math.max(ratioFloor, 0.04 * nv);

    return { mean: m, stdDev: sd, changesMean: mean(changes), changesStdDev: changesSD, normalizedVolatility: nv, threshold };
  }

  // ── Z-SCORE CALCULATION ───────────────────────────────

  /**
   * Returns array of z-score objects for each month index.
   * For months before opening, returns null entries.
   */
  function calcZScores(metric) {
    const { type, openingIdx, values, threshold, changesStdDev, stdDev: sd, mean: m } = metric;
    const result = [];

    if (type === 'all_zero') {
      return values.map(() => makeZ(null, null, null, false, false, 0));
    }

    if (type === 'sporadic') {
      for (let i = 0; i < values.length; i++) {
        const z = sd !== 0 ? (values[i] - m) / sd : 0;
        result.push(makeZ(null, z, 'value', Math.abs(z) > threshold, false, z));
      }
      return result;
    }

    // continuous
    for (let i = 0; i < values.length; i++) {
      if (i < openingIdx) {
        result.push(makeZ(null, null, null, false, false, 0));
        continue;
      }
      if (i === openingIdx) {
        result.push(makeZ(0, null, null, false, false, 0));
        continue;
      }

      // Step 1: change Z
      const change = values[i] - values[i - 1];
      const z1 = changesStdDev !== 0 ? change / changesStdDev : 0;

      if (Math.abs(z1) > threshold) {
        result.push(makeZ(z1, null, 'change', true, false, z1));
        continue;
      }

      // Step 2: value Z up to current month
      const slice = values.slice(openingIdx, i + 1);
      const mSlice = mean(slice);
      const sdSlice = stdDev(slice);
      const z2 = sdSlice !== 0 ? (values[i] - mSlice) / sdSlice : 0;

      if (Math.abs(z2) > threshold) {
        result.push(makeZ(z1, z2, 'value', true, false, z2));
      } else {
        result.push(makeZ(z1, z2, null, false, false, z2));
      }
    }
    return result;
  }

  function makeZ(z1, z2, anomalyType, isAnomaly, isReversion, effectiveZ) {
    return { z1, z2, anomalyType, isAnomaly, isReversion, effectiveZ, direction: effectiveZ >= 0 ? 1 : -1 };
  }

  // ── REVERSION RULE ────────────────────────────────────

  function applyReversionRule(zScores) {
    for (let i = 1; i < zScores.length; i++) {
      const prev = zScores[i - 1];
      const curr = zScores[i];
      if (
        prev && curr &&
        prev.isAnomaly && prev.anomalyType === 'change' &&
        curr.isAnomaly && curr.anomalyType === 'change' &&
        Math.sign(prev.z1) !== Math.sign(curr.z1)
      ) {
        zScores[i] = { ...curr, isAnomaly: false, isReversion: true };
      }
    }
    return zScores;
  }

  // ── ANOMALY DIRECTION (P&L) ───────────────────────────

  /**
   * direction > 0 means the value/change was higher than expected.
   * For INCOME: higher = Profit; for EXPENSES: higher = Loss.
   */
  function anomalyPnL(z, section) {
    const higher = z.effectiveZ > 0;
    if (section === 'INCOME') return higher ? 'profit' : 'loss';
    if (section === 'EXPENSES') return higher ? 'loss' : 'profit';
    return 'neutral';
  }

  // ── MATERIAL ANOMALY ──────────────────────────────────

  /**
   * purchasePrice * 0.001 = NOI change corresponding to 10 bps CAP RATE shift
   */
  function isMaterial(deviation, purchasePrice) {
    if (!purchasePrice || purchasePrice <= 0) return false;
    // Monthly materiality threshold: 10bps of purchase price annualised, divided by 12
    return Math.abs(deviation) >= (purchasePrice * 0.001) / 12;
  }

  function getMaterialDeviation(metric, monthIdx) {
    const z = metric.zScores[monthIdx];
    if (!z || !z.isAnomaly) return 0;
    if (metric.type === 'sporadic') {
      return metric.values[monthIdx] - metric.mean;
    }
    if (z.anomalyType === 'change') {
      return metric.values[monthIdx] - (monthIdx > 0 ? metric.values[monthIdx - 1] : 0);
    }
    // value anomaly
    const slice = metric.values.slice(metric.openingIdx, monthIdx + 1);
    const mSlice = mean(slice);
    return metric.values[monthIdx] - mSlice;
  }

  // ── SEASONALITY ───────────────────────────────────────

  /**
   * Given months array like ["Jan 2024","Feb 2024",...],
   * find indices that share the same month name across different years.
   */
  function buildMonthIndex(months) {
    const map = {}; // "Jan" → [idx0, idx1, ...]
    months.forEach((m, i) => {
      const shortName = m.split(' ')[0];
      if (!map[shortName]) map[shortName] = [];
      map[shortName].push(i);
    });
    return map;
  }

  function detectSeasonality(metric, months, purchasePrice, activeMonths) {
    const monthIndex = buildMonthIndex(months);
    const materialSeasonal = new Set();
    const recurring = new Set();

    const activeSet = new Set(activeMonths);

    months.forEach((m, i) => {
      if (!activeSet.has(i)) return;
      const shortName = m.split(' ')[0];
      const peers = (monthIndex[shortName] || []).filter(j => j !== i && activeSet.has(j));

      peers.forEach(j => {
        const vi = metric.values[i];
        const vj = metric.values[j];
        if (vi === 0 && vj === 0) return;

        const sameSign = Math.sign(vi) === Math.sign(vj) || (vi !== 0 && vj !== 0);

        // Check 10% tolerance
        if (!within10Pct(vi, vj)) return;
        if (!sameDirectionSign(vi, vj)) return;

        const zi = metric.zScores[i];
        const zj = metric.zScores[j];

        // Material seasonality: both are material anomalies, same direction
        const devI = getMaterialDeviation(metric, i);
        const devJ = getMaterialDeviation(metric, j);
        const matI = zi && zi.isAnomaly && isMaterial(devI, purchasePrice);
        const matJ = zj && zj.isAnomaly && isMaterial(devJ, purchasePrice);

        if (matI && matJ) {
          const sameAnomalyDir = (zi.effectiveZ > 0) === (zj.effectiveZ > 0);
          if (sameAnomalyDir) {
            materialSeasonal.add(i);
            materialSeasonal.add(j);
          }
        }

        // Recurring pattern: values similar within 10%, same direction
        recurring.add(i);
        recurring.add(j);
      });
    });

    return { materialSeasonal: [...materialSeasonal], recurring: [...recurring] };
  }

  function within10Pct(a, b) {
    if (a === 0 && b === 0) return true;
    if (a === 0 || b === 0) return false;
    return Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= 0.10;
  }

  function sameDirectionSign(a, b) {
    return Math.sign(a) === Math.sign(b);
  }

  // ── TRENDS ────────────────────────────────────────────

  function calcTrends(values, openingIdx, activeMonths) {
    if (activeMonths.length === 0) return { trend: 0, trend12m: 0, trend3m: 0 };

    const changes = [];
    for (let i = openingIdx + 1; i < values.length; i++) {
      if (!activeMonths.includes(i)) continue;
      changes.push(values[i] - values[i - 1]);
    }

    // For opening month itself, change = 0
    // Trend = sum of all changes from opening to last active
    const trend = changes.reduce((a, b) => a + b, 0);
    const trend12m = changes.slice(-12).reduce((a, b) => a + b, 0);
    const trend3m = changes.slice(-3).reduce((a, b) => a + b, 0);

    const trend3mDir  = trend3m  > 0 ? 'positive' : trend3m  < 0 ? 'negative' : 'flat';
    const trend12mDir = trend12m > 0 ? 'positive' : trend12m < 0 ? 'negative' : 'flat';

    const trendReversal =
      (trend3mDir === 'positive' && trend12mDir === 'negative') ||
      (trend3mDir === 'negative' && trend12mDir === 'positive');

    const trendReversalDirection = trendReversal
      ? (trend3mDir === 'positive' ? 'up' : 'down')
      : null;

    return {
      trend: trend > 0 ? 'positive' : trend < 0 ? 'negative' : 'flat',
      trend12m: trend12mDir,
      trend3m:  trend3mDir,
      trendVal: trend, trend12mVal: trend12m, trend3mVal: trend3m,
      trendReversal,
      trendReversalDirection,
    };
  }

  // ── QUARTERS ─────────────────────────────────────────

  function monthToQuarterYear(monthLabel) {
    const parts = monthLabel.split(' ');
    if (parts.length < 2) return null;
    const monthMap = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
    const mo = monthMap[parts[0]];
    const yr = parseInt(parts[1]);
    const q = Math.ceil(mo / 3);
    return { year: yr, q, key: `Q${q} ${yr}` };
  }

  function calcQuarters(values, months, openingIdx, activeMonths) {
    if (activeMonths.length === 0) return {};

    const activeSet = new Set(activeMonths);
    const openingMonth = months[openingIdx];
    const openQY = monthToQuarterYear(openingMonth);
    if (!openQY) return {};

    // First full quarter
    const shortMonthMap = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12};
    const openMo = shortMonthMap[openingMonth.split(' ')[0]] || 1;
    const openMonthInQ = ((openMo - 1) % 3) + 1; // 1,2,3
    const firstFullQ = openMonthInQ === 1 ? openQY : {
      year: openQY.q === 4 ? openQY.year + 1 : openQY.year,
      q: openQY.q === 4 ? 1 : openQY.q + 1,
      key: `Q${openQY.q === 4 ? 1 : openQY.q + 1} ${openQY.q === 4 ? openQY.year + 1 : openQY.year}`,
    };

    // Build quarter sums
    const qSums = {};
    months.forEach((m, i) => {
      if (!activeSet.has(i)) return;
      const qy = monthToQuarterYear(m);
      if (!qy) return;
      if (!qSums[qy.key]) qSums[qy.key] = { sum: 0, count: 0, year: qy.year, q: qy.q };
      qSums[qy.key].sum += values[i];
      qSums[qy.key].count++;
    });

    // Only full quarters (count === 3) that start at or after firstFullQ
    const fullQs = Object.entries(qSums)
      .filter(([k, v]) => {
        if (v.count < 3) return false;
        if (v.year < firstFullQ.year) return false;
        if (v.year === firstFullQ.year && v.q < firstFullQ.q) return false;
        return true;
      })
      .map(([k, v]) => ({ key: k, sum: v.sum }));

    if (fullQs.length === 0) return {};

    fullQs.sort((a, b) => b.sum - a.sum);
    const strongestQ = fullQs[0];
    const weakestQ = fullQs[fullQs.length - 1];

    // ── Level shift detection ─────────────────────────────
    // Re-sort chronologically (year asc, then quarter asc) for the split.
    const chronoQs = [...fullQs].sort((a, b) => {
      const [aqStr, ayStr] = a.key.split(' ');
      const [bqStr, byStr] = b.key.split(' ');
      const ay = parseInt(ayStr), by = parseInt(byStr);
      if (ay !== by) return ay - by;
      return parseInt(aqStr.slice(1)) - parseInt(bqStr.slice(1));
    });

    let levelShift = null;
    if (chronoQs.length >= 3) {
      const recentQs = chronoQs.slice(-2);
      const priorQs  = chronoQs.slice(0, -2);
      const recentAvg = recentQs.reduce((s, q) => s + q.sum, 0) / recentQs.length;
      const priorAvg  = priorQs.reduce((s,  q) => s + q.sum, 0) / priorQs.length;
      if (priorAvg === 0) {
        levelShift = null;
      } else {
        const diff = (recentAvg - priorAvg) / Math.abs(priorAvg) * 100;
        levelShift = Math.abs(diff) >= 15
          ? {
              detected:   true,
              direction:  diff > 0 ? 'up' : 'down',
              magnitude:  Math.round(Math.abs(diff)),
              recentAvg:  Math.round(recentAvg),
              priorAvg:   Math.round(priorAvg),
            }
          : { detected: false };
      }
    }

    return {
      strongestQ: strongestQ.key, strongestQSum: strongestQ.sum,
      weakestQ:   weakestQ.key,   weakestQSum:   weakestQ.sum,
      levelShift,
    };
  }

  // ── FULL PIPELINE ─────────────────────────────────────

  /**
   * Run full analysis on parsed metrics.
   * @param {Object} parsed - { months, metrics }
   * @param {number} purchasePrice
   * @param {number|null} periodStart - inclusive index into months[]
   * @param {number|null} periodEnd   - inclusive index into months[]
   */
  function analyse(parsed, purchasePrice, periodStart = null, periodEnd = null) {
    const { months, metrics } = parsed;

    // Determine active month range (excluding last 2)
    const start = periodStart !== null ? periodStart : 0;
    const end   = periodEnd   !== null ? periodEnd   : months.length - 1;

    // Within selected range, ALL months are active (period filter removes the 2-skip rule WITHIN range)
    // The 2-skip rule applies to the natural full range when no period filter is active
    let activeEnd;
    if (periodStart !== null || periodEnd !== null) {
      // Period filter mode: include all months in range
      activeEnd = end;
    } else {
      // Normal mode: skip last 2
      activeEnd = months.length - 3; // last active = months.length - 3
    }

    const activeMonths = [];
    for (let i = start; i <= Math.min(end, activeEnd); i++) activeMonths.push(i);

    const skippedMonths = [];
    if (periodStart === null && periodEnd === null) {
      if (months.length >= 1) skippedMonths.push(months.length - 1);
      if (months.length >= 2) skippedMonths.push(months.length - 2);
    }

    const displayMonths = [];
    for (let i = start; i <= end; i++) displayMonths.push(i);

    metrics.forEach(metric => {
      // Restrict values to display range
      const vals = displayMonths.map(i => metric.values[i] || 0);
      const activeIdxsInDisplay = activeMonths.map(i => i - start); // relative to vals

      // Classify using active values only
      const activeVals = activeIdxsInDisplay.map(i => vals[i]);
      const cl = classifyMetric(activeVals);

      metric.type = cl.type;
      metric.openingIdx = cl.openingIdx !== -1 ? activeIdxsInDisplay[cl.openingIdx] : -1;

      if (metric.type === 'all_zero') {
        metric.zScores = displayMonths.map(() => makeZ(null, null, null, false, false, 0));
        return;
      }

      // Stats
      // Note: cl.openingIdx is the index within activeVals (not display vals)
      let stats;
      if (metric.type === 'sporadic') {
        stats = calcSporadicStats(activeVals);
      } else {
        stats = calcContinuousStats(activeVals, cl.openingIdx);
      }
      Object.assign(metric, stats);

      // Z-scores (on the display slice, but using stats from active)
      // We compute zscores for all display months but only mark active ones
      metric.zScores = calcZScoresForDisplay(metric, vals, displayMonths, activeIdxsInDisplay, stats);

      // Reversion rule
      metric.zScores = applyReversionRule(metric.zScores);

      // Compute anomaly indices
      metric.anomalies = activeIdxsInDisplay.filter(i => metric.zScores[i] && metric.zScores[i].isAnomaly);

      // Material anomalies
      metric.materialAnomalies = metric.anomalies.filter(i => {
        const dev = getMaterialDeviationRelative(metric, vals, i, activeIdxsInDisplay);
        return isMaterial(dev, purchasePrice);
      });

      // Seasonality (use display indices but only active)
      const dispMonthLabels = displayMonths.map(i => months[i]);
      const seasResult = detectSeasonality(
        { ...metric, values: vals, zScores: metric.zScores },
        dispMonthLabels,
        purchasePrice,
        activeIdxsInDisplay
      );
      metric.seasonalityMonths = seasResult.materialSeasonal;
      metric.recurringPatterns = seasResult.recurring;

      // Remove material anomaly flag from material-seasonal months
      metric.materialAnomalies = metric.materialAnomalies.filter(
        i => !metric.seasonalityMonths.includes(i)
      );

      // Trends
      metric.trends = calcTrends(vals, metric.openingIdx, activeIdxsInDisplay);

      // Quarters
      metric.quarters = calcQuarters(vals, dispMonthLabels, metric.openingIdx, activeIdxsInDisplay);

      // P&L for each anomaly
      metric.anomalies.forEach(i => {
        const z = metric.zScores[i];
        if (z) z.pnl = anomalyPnL(z, metric.section);
      });

      // Store display values for rendering
      metric.displayValues = vals;
      metric.displayMonths = displayMonths;
    });

    return { months, displayMonths, activeMonths, skippedMonths, metrics };
  }

  function calcZScoresForDisplay(metric, vals, displayMonths, activeIdxs, stats) {
    const result = displayMonths.map(() => makeZ(null, null, null, false, false, 0));
    const activeSet = new Set(activeIdxs);

    if (metric.type === 'sporadic') {
      activeIdxs.forEach(i => {
        const z = stats.stdDev !== 0 ? (vals[i] - stats.mean) / stats.stdDev : 0;
        result[i] = makeZ(null, z, 'value', Math.abs(z) > metric.threshold, false, z);
      });
      return result;
    }

    // continuous
    activeIdxs.forEach((i, pos) => {
      if (i === metric.openingIdx) {
        result[i] = makeZ(0, null, null, false, false, 0);
        return;
      }
      if (!activeSet.has(i)) return;

      // find prev active idx
      const prevActive = activeIdxs[pos - 1];
      if (prevActive === undefined) return;

      const change = vals[i] - vals[prevActive];
      const z1 = stats.changesStdDev !== 0 ? change / stats.changesStdDev : 0;

      if (Math.abs(z1) > metric.threshold) {
        result[i] = makeZ(z1, null, 'change', true, false, z1);
        return;
      }

      const sliceIdxs = activeIdxs.slice(0, pos + 1);
      const slice = sliceIdxs.map(j => vals[j]);
      const mSlice = mean(slice);
      const sdSlice = stdDev(slice);
      const z2 = sdSlice !== 0 ? (vals[i] - mSlice) / sdSlice : 0;

      if (Math.abs(z2) > metric.threshold) {
        result[i] = makeZ(z1, z2, 'value', true, false, z2);
      } else {
        result[i] = makeZ(z1, z2, null, false, false, z2);
      }
    });

    return result;
  }

  function getMaterialDeviationRelative(metric, vals, idx, activeIdxs) {
    const z = metric.zScores[idx];
    if (!z || !z.isAnomaly) return 0;
    if (metric.type === 'sporadic') return vals[idx] - metric.mean;
    if (z.anomalyType === 'change') {
      const pos = activeIdxs.indexOf(idx);
      const prev = pos > 0 ? vals[activeIdxs[pos - 1]] : 0;
      return vals[idx] - prev;
    }
    const pos = activeIdxs.indexOf(idx);
    const sliceIdxs = activeIdxs.slice(0, pos + 1);
    const slice = sliceIdxs.map(j => vals[j]);
    const mSlice = mean(slice);
    return vals[idx] - mSlice;
  }

  // ── COMPARISON MODE DELTA ─────────────────────────────

  function calcDeltaRow(valsA, valsB, activeMonths) {
    const deltas = valsA.map((a, i) => {
      if (!activeMonths.includes(i)) return null;
      const b = valsB[i];
      if (b === 0 && a === 0) return 0;
      if (b === 0) return null;
      return ((a - b) / Math.abs(b)) * 100;
    });

    const activeDeltas = activeMonths.map(i => deltas[i]).filter(d => d !== null);
    const deltasMean = mean(activeDeltas);
    const deltasSD = stdDev(activeDeltas);

    const deltaAnomalies = deltas.map((d, i) => {
      if (d === null || !activeMonths.includes(i)) return false;
      return deltasSD !== 0 && Math.abs((d - deltasMean) / deltasSD) > 1;
    });

    return { deltas, deltaAnomalies };
  }

  // ── SHARED MONTHS FOR COMPARISON ─────────────────────

  function findSharedMonths(monthsA, monthsB) {
    const setB = new Set(monthsB);
    return monthsA.filter(m => setB.has(m));
  }

  // ── HTML → ROWS PARSER ───────────────────────────────

  /**
   * Parse an HTML string (exported from Excel or any financial system)
   * into the same 2-D array format that SheetJS produces, so the
   * existing parseSheet() pipeline can consume it unchanged.
   *
   * Strategy:
   *  1. Use DOMParser to build a document from the HTML string.
   *  2. Find the largest <table> in the document (most data columns).
   *  3. Walk every <tr>; for each <td>/<th> honour colspan by repeating
   *     the cell value that many times, so column alignment is preserved.
   *  4. Return the resulting 2-D array of string | null values.
   */
  function parseHTMLToRows(htmlString) {
    const doc = new DOMParser().parseFromString(htmlString, 'text/html');

    // Pick the table with the most columns (widest = data table)
    const tables = Array.from(doc.querySelectorAll('table'));
    if (tables.length === 0) throw new Error('No <table> found in the HTML file.');

    const table = tables.reduce((best, t) => {
      const cols = Math.max(...Array.from(t.querySelectorAll('tr'))
        .map(tr => Array.from(tr.querySelectorAll('td,th'))
          .reduce((s, td) => s + (parseInt(td.getAttribute('colspan') || '1')), 0)));
      return cols > best.cols ? { t, cols } : best;
    }, { t: tables[0], cols: 0 }).t;

    const rows = [];
    table.querySelectorAll('tr').forEach(tr => {
      const row = [];
      tr.querySelectorAll('td, th').forEach(td => {
        const span = parseInt(td.getAttribute('colspan') || '1');
        const text = td.innerText !== undefined ? td.innerText.trim() : td.textContent.trim();
        const val  = text === '' ? null : text;
        for (let i = 0; i < span; i++) row.push(i === 0 ? val : null);
      });
      if (row.some(c => c !== null)) rows.push(row);
    });

    if (rows.length === 0) throw new Error('The HTML table appears to be empty.');
    return rows;
  }

  // ── PUBLIC API ────────────────────────────────────────

  return {
    parseSheet,
    parseHTMLToRows,
    normalizeMonthLabel,
    classifyMetric,
    mean,
    stdDev,
    analyse,
    calcDeltaRow,
    findSharedMonths,
    isMaterial,
    getMaterialDeviation,
    anomalyPnL,
  };
})();
