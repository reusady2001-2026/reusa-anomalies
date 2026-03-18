// ============================================================
// UI.JS — Rendering and table display
// ============================================================

const UI = (() => {

  let materialFocusActive = false;

  // ── CELL CLASSIFICATION ───────────────────────────────

  function getCellClass(metric, relIdx, skippedRelIdxs, materialFocusActive) {
    const z = metric.zScores && metric.zScores[relIdx];

    if (skippedRelIdxs && skippedRelIdxs.includes(relIdx)) return 'cell-skipped';
    if (!z) return 'cell-inactive';

    const isMaterialSeasonal = metric.seasonalityMonths && metric.seasonalityMonths.includes(relIdx);
    const isMaterial = metric.materialAnomalies && metric.materialAnomalies.includes(relIdx);
    const isAnomaly = z.isAnomaly;
    const isReversion = z.isReversion;

    if (materialFocusActive) {
      // Only material anomalies shown
      if (isMaterial && !isMaterialSeasonal) {
        return z.pnl === 'profit' ? 'cell-material-positive' : 'cell-material-negative';
      }
      return 'cell-normal';
    }

    // Full display
    if (isMaterialSeasonal) return 'cell-seasonal-material';
    if (isMaterial) {
      return z.pnl === 'profit' ? 'cell-material-positive' : 'cell-material-negative';
    }
    if (isReversion) return 'cell-reversion';
    if (isAnomaly) return 'cell-anomaly';

    return 'cell-normal';
  }

  function hasRecurring(metric, relIdx, materialFocusActive) {
    if (materialFocusActive) return false;
    return metric.recurringPatterns && metric.recurringPatterns.includes(relIdx);
  }

  // ── FORMAT VALUE ──────────────────────────────────────

  function fmt(val) {
    if (val === null || val === undefined) return '—';
    if (typeof val !== 'number' || isNaN(val)) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(val);
  }

  function fmtPct(val) {
    if (val === null || val === undefined) return '—';
    return val.toFixed(1) + '%';
  }

  function fmtTrend(t) {
    if (!t) return '';
    if (t === 'positive') return '▲';
    if (t === 'negative') return '▼';
    return '—';
  }

  function trendClass(t) {
    if (t === 'positive') return 'trend-positive';
    if (t === 'negative') return 'trend-negative';
    return '';
  }

  // ── BUILD TABLE HTML ──────────────────────────────────

  /**
   * Render a single asset table.
   * @param {Object} result - from Engine.analyse()
   * @param {Object} opts
   *   materialFocus: bool
   *   sectionFilter: 'all' | 'income' | 'expenses'
   *   showReasons: bool
   *   prefix: string (for comparison mode, 'A' or 'B')
   */
  function renderTable(result, opts = {}) {
    const { months, displayMonths, activeMonths, skippedMonths, metrics } = result;
    const mFocus = opts.materialFocus || false;
    const secFilter = opts.sectionFilter || 'all';

    // skipped indices within displayMonths
    const skippedRelIdxs = displayMonths
      .map((mi, ri) => skippedMonths.includes(mi) ? ri : -1)
      .filter(x => x >= 0);

    const dispLabels = displayMonths.map(i => months[i]);

    let html = '<table class="anomaly-table">';

    // ── header row ──
    html += '<thead><tr>';
    html += '<th class="metric-name-col">Metric</th>';
    dispLabels.forEach((m, ri) => {
      const skipped = skippedRelIdxs.includes(ri);
      html += `<th class="${skipped ? 'col-skipped' : ''}">${m}</th>`;
    });
    html += '<th class="trend-col">Trend</th>';
    html += '<th class="trend-col">12M</th>';
    html += '<th class="trend-col">3M</th>';
    html += '<th class="quarter-col">Strongest Q</th>';
    html += '<th class="quarter-col">Weakest Q</th>';
    html += '</tr></thead>';

    // ── body rows ──
    html += '<tbody>';

    let rowCount = 0;
    let lastSection = '';
    metrics.forEach(metric => {
      if (metric.type === 'all_zero') return;
      if (secFilter === 'income' && metric.section !== 'INCOME') return;
      if (secFilter === 'expenses' && metric.section !== 'EXPENSES') return;
      if (mFocus && (!metric.materialAnomalies || metric.materialAnomalies.length === 0)) return;
      rowCount++;

      // Section divider
      if (metric.section !== lastSection) {
        lastSection = metric.section;
        html += `<tr class="section-header-row">
          <td colspan="${dispLabels.length + 6}" class="section-header">${metric.section}</td>
        </tr>`;
      }

      html += '<tr class="metric-row" data-metric-id="' + escHtml(metric.id) + '">';
      html += `<td class="metric-name">${escHtml(metric.name)}</td>`;

      dispLabels.forEach((_, ri) => {
        const skipped = skippedRelIdxs.includes(ri);
        if (skipped) {
          const val = metric.displayValues ? metric.displayValues[ri] : 0;
          html += `<td class="cell-skipped">${fmt(val)}</td>`;
          return;
        }

        const val = metric.displayValues ? metric.displayValues[ri] : 0;
        const z = metric.zScores && metric.zScores[ri];
        const cellClass = getCellClass(metric, ri, skippedRelIdxs, mFocus);
        const recurring = hasRecurring(metric, ri, mFocus);
        const isAnomaly = z && z.isAnomaly && !metric.seasonalityMonths?.includes(ri);
        const zDisplay = z && z.effectiveZ != null ? z.effectiveZ.toFixed(2) : '';

        const pnlClass = z && z.pnl ? `pnl-${z.pnl}` : '';

        html += `<td class="${cellClass} ${pnlClass}"
            title="Z: ${zDisplay}"
            data-ri="${ri}"
            data-metric="${escHtml(metric.id)}"
            ${isAnomaly ? 'data-anomaly="1"' : ''}>`;
        html += fmt(val);
        if (recurring) html += '<span class="recurring-icon" title="Recurring seasonal pattern">🔄</span>';
        html += '</td>';
      });

      // Trend columns
      const tr = metric.trends || {};
      html += `<td class="trend-col ${trendClass(tr.trend)}">${fmtTrend(tr.trend)}</td>`;
      html += `<td class="trend-col ${trendClass(tr.trend12m)}">${fmtTrend(tr.trend12m)}</td>`;
      html += `<td class="trend-col ${trendClass(tr.trend3m)}">${fmtTrend(tr.trend3m)}</td>`;

      // Quarter columns
      const q = metric.quarters || {};
      html += `<td class="quarter-col">${q.strongestQ || '—'}<br><small>${q.strongestQSum != null ? fmt(q.strongestQSum) : ''}</small></td>`;
      html += `<td class="quarter-col">${q.weakestQ || '—'}<br><small>${q.weakestQSum != null ? fmt(q.weakestQSum) : ''}</small></td>`;

      html += '</tr>';
    });

    html += '</tbody></table>';
    return { html, rowCount };
  }

  // ── COMPARISON TABLE ──────────────────────────────────

  function renderComparisonTable(resultA, resultB, deltasMap, deltaAnomaliesMap, opts = {}) {
    const mFocus = opts.materialFocus || false;
    const viewFilter = opts.viewFilter || 'both'; // 'A' | 'B' | 'both'
    const secFilter = opts.sectionFilter || 'all';

    const sharedMonths = resultA.displayMonths.map(i => resultA.months[i]);
    const skippedRelA = resultA.displayMonths
      .map((mi, ri) => resultA.skippedMonths.includes(mi) ? ri : -1)
      .filter(x => x >= 0);

    let html = '<table class="anomaly-table comparison-table">';

    // header
    html += '<thead><tr>';
    html += '<th class="metric-name-col">Metric</th><th class="asset-label-col">Asset</th>';
    sharedMonths.forEach((m, ri) => {
      const sk = skippedRelA.includes(ri);
      html += `<th class="${sk ? 'col-skipped' : ''}">${m}</th>`;
    });
    html += '<th>Trend</th><th>12M</th><th>3M</th><th>Strongest Q</th><th>Weakest Q</th>';
    html += '</tr></thead><tbody>';

    // collect all metric names
    const allNames = new Map();
    resultA.metrics.forEach(m => { if (m.type !== 'all_zero') allNames.set(m.name, { A: m, B: null }); });
    resultB.metrics.forEach(m => {
      if (m.type !== 'all_zero') {
        const e = allNames.get(m.name);
        if (e) e.B = m;
        else allNames.set(m.name, { A: null, B: m });
      }
    });

    let rowCount = 0;
    let lastSection = '';

    allNames.forEach(({ A, B }, name) => {
      const section = (A || B).section;
      if (secFilter === 'income' && section !== 'INCOME') return;
      if (secFilter === 'expenses' && section !== 'EXPENSES') return;
      if (mFocus) {
        const aMaterial = A && A.materialAnomalies && A.materialAnomalies.length > 0;
        const bMaterial = B && B.materialAnomalies && B.materialAnomalies.length > 0;
        if (!aMaterial && !bMaterial) return;
      }
      rowCount++;

      if (section !== lastSection) {
        lastSection = section;
        html += `<tr class="section-header-row">
          <td colspan="${sharedMonths.length + 7}" class="section-header">${section}</td>
        </tr>`;
      }

      const pairKey = name;
      const deltas = deltasMap[pairKey] || [];
      const deltaAnomalies = deltaAnomaliesMap[pairKey] || [];

      // Row A
      if (viewFilter !== 'B') {
        html += renderComparisonRow(A, resultA, sharedMonths, skippedRelA, 'A', mFocus, !B ? 'solo' : '');
      }

      // Row B
      if (viewFilter !== 'A') {
        html += renderComparisonRow(B, resultB, sharedMonths, skippedRelA, 'B', mFocus, !A ? 'solo' : '');
      }

      // Delta row
      if (viewFilter === 'both' && A && B) {
        html += '<tr class="delta-row">';
        html += `<td class="metric-name delta-label">Δ%</td><td></td>`;
        sharedMonths.forEach((_, ri) => {
          const sk = skippedRelA.includes(ri);
          if (sk) { html += '<td class="cell-skipped">—</td>'; return; }
          const d = deltas[ri];
          const isDA = deltaAnomalies[ri];
          html += `<td class="${isDA ? 'delta-anomaly' : ''} ${d != null ? (d > 0 ? 'delta-pos' : d < 0 ? 'delta-neg' : '') : ''}">${d != null ? fmtPct(d) : '—'}</td>`;
        });
        html += '<td colspan="5"></td></tr>';
      }

      // Separator between pairs
      html += '<tr class="pair-separator"><td colspan="' + (sharedMonths.length + 7) + '"></td></tr>';
    });

    html += '</tbody></table>';
    return { html, rowCount };
  }

  function renderComparisonRow(metric, result, sharedMonths, skippedRelIdxs, label, mFocus, soloClass) {
    if (!metric) {
      // Empty placeholder row
      return `<tr class="metric-row ${soloClass}-only">
        <td class="metric-name">—</td><td class="asset-label">${label}</td>
        ${sharedMonths.map(() => '<td>—</td>').join('')}
        <td colspan="5">—</td>
      </tr>`;
    }

    let html = `<tr class="metric-row asset-${label.toLowerCase()} ${soloClass ? soloClass + '-only' : ''}" data-metric-id="${escHtml(metric.id)}">`;
    html += `<td class="metric-name">${escHtml(metric.name)}</td>`;
    html += `<td class="asset-label asset-label-${label.toLowerCase()}">${label}</td>`;

    sharedMonths.forEach((_, ri) => {
      const sk = skippedRelIdxs.includes(ri);
      if (sk) {
        const val = metric.displayValues ? metric.displayValues[ri] : 0;
        html += `<td class="cell-skipped">${fmt(val)}</td>`;
        return;
      }
      const val = metric.displayValues ? metric.displayValues[ri] : 0;
      const z = metric.zScores && metric.zScores[ri];
      const cellClass = getCellClass(metric, ri, skippedRelIdxs, mFocus);
      const recurring = hasRecurring(metric, ri, mFocus);
      const pnlClass = z && z.pnl ? `pnl-${z.pnl}` : '';
      html += `<td class="${cellClass} ${pnlClass}" data-ri="${ri}" data-metric="${escHtml(metric.id)}" ${z?.isAnomaly ? 'data-anomaly="1"' : ''}>`;
      html += fmt(val);
      if (recurring) html += '<span class="recurring-icon">🔄</span>';
      html += '</td>';
    });

    const tr = metric.trends || {};
    html += `<td class="${trendClass(tr.trend)}">${fmtTrend(tr.trend)}</td>`;
    html += `<td class="${trendClass(tr.trend12m)}">${fmtTrend(tr.trend12m)}</td>`;
    html += `<td class="${trendClass(tr.trend3m)}">${fmtTrend(tr.trend3m)}</td>`;
    const q = metric.quarters || {};
    html += `<td>${q.strongestQ || '—'}</td><td>${q.weakestQ || '—'}</td>`;
    html += '</tr>';
    return html;
  }

  // ── DASHBOARD STATS ───────────────────────────────────

  function renderDashboard(result, label) {
    const metrics = result.metrics.filter(m => m.type !== 'all_zero');
    const totalAnomalies = metrics.reduce((a, m) => a + (m.anomalies || []).length, 0);
    const totalMaterial = metrics.reduce((a, m) => a + (m.materialAnomalies || []).length, 0);
    const totalSeasonal = metrics.reduce((a, m) => a + (m.seasonalityMonths || []).length, 0);
    const totalRecurring = metrics.reduce((a, m) => a + (m.recurringPatterns || []).length, 0);

    return `<div class="dashboard-card">
      <div class="dashboard-label">Asset ${label}</div>
      <div class="stat-row"><span class="stat-label">Anomalies</span><span class="stat-value">${totalAnomalies}</span></div>
      <div class="stat-row"><span class="stat-label">Material</span><span class="stat-value stat-material">${totalMaterial}</span></div>
      <div class="stat-row"><span class="stat-label">Seasonal</span><span class="stat-value stat-seasonal">${totalSeasonal}</span></div>
      <div class="stat-row"><span class="stat-label">Recurring 🔄</span><span class="stat-value">${totalRecurring}</span></div>
    </div>`;
  }

  // ── ANOMALY DETAIL CARD ───────────────────────────────

  function renderAnomalyCard(reasonData, metric, monthLabel) {
    if (!reasonData) return '';
    const { primary, alternatives, corroborating, firedRuleIds } = reasonData;
    const z = metric.zScores[reasonData.monthIdx];
    if (!z) return '';

    const pnlColor = z.pnl === 'profit' ? '#2e7d32' : z.pnl === 'loss' ? '#b71c1c' : '#e65100';
    const pnlLabel = z.pnl ? z.pnl.toUpperCase() : '';
    const anomalyTypeLabel = z.anomalyType === 'change' ? 'Change Anomaly' : 'Value Anomaly';
    const deviation = reasonData.effectiveZ ? (reasonData.effectiveZ > 0 ? '+' : '') + reasonData.effectiveZ.toFixed(2) + 'σ' : '';

    let html = `<div class="anomaly-card">
      <div class="anomaly-card-header">
        <span class="anomaly-type-badge">${anomalyTypeLabel}</span>
        <span class="anomaly-month">${monthLabel}</span>
        <span class="anomaly-deviation">${deviation}</span>
        <span class="pnl-badge" style="color:${pnlColor}">${pnlLabel} (${metric.section})</span>
      </div>
      <div class="anomaly-primary">
        <strong>Primary Reason</strong> <span class="confidence-badge">${Math.round((primary.weight || 0) * 100)}% confidence</span><br>
        ${escHtml(primary.label || primary)}
      </div>`;

    if (alternatives && alternatives.length > 0) {
      html += '<div class="anomaly-alternatives"><strong>Alternative Explanations</strong><ol>';
      alternatives.forEach(alt => { html += `<li>${escHtml(alt)}</li>`; });
      html += '</ol></div>';
    }

    if (corroborating && corroborating.length > 0) {
      html += '<div class="anomaly-corroborating"><strong>Corroborating Anomalies</strong><ul>';
      corroborating.forEach(c => {
        html += `<li>${escHtml(c.metricName)} — ${c.monthLabel} <span class="sim-score">${c.similarity}% match</span></li>`;
      });
      html += '</ul></div>';
    }

    html += '</div>';
    return html;
  }

  // ── HELPERS ───────────────────────────────────────────

  function escHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  return {
    renderTable,
    renderComparisonTable,
    renderDashboard,
    renderAnomalyCard,
    getCellClass,
    fmt,
    fmtPct,
    escHtml,
  };
})();
