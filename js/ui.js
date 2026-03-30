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
    const isNarratorSeasonal = isMaterial &&
      (metric.reasonData?.[relIdx]?.situationProfile?.angle === 'SEASONAL_VARIANCE');
    const isAnomaly = z.isAnomaly;
    const isReversion = z.isReversion;

    if (materialFocusActive) {
      if (isMaterial) {
        if (isNarratorSeasonal) return 'cell-seasonal-material';
        if (!isMaterialSeasonal) return z.pnl === 'profit' ? 'cell-material-positive' : 'cell-material-negative';
      }
      return 'cell-normal';
    }

    // Full display
    if (isMaterialSeasonal) return 'cell-seasonal-material';
    if (isNarratorSeasonal) return 'cell-seasonal-material';
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
      if (metric.section === 'UNKNOWN') return;
      if (/net\s*operating\s*income|^\s*noi\s*$/i.test(metric.name)) return;
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
      // Reason preview: first material (or first) anomaly's enriched primary
      const _previewIdx = metric.materialAnomalies?.[0] ?? metric.anomalies?.[0];
      const _previewText = (_previewIdx != null && metric.reasonData?.[_previewIdx]?.enrichedPrimary)
        ? metric.reasonData[_previewIdx].enrichedPrimary : null;
      const _previewShort = _previewText
        ? escHtml(_previewText.length > 100 ? _previewText.slice(0, 97) + '…' : _previewText)
        : null;
      html += `<td class="metric-name">${escHtml(metric.name)}${_previewShort ? `<div class="reason-preview">${_previewShort}</div>` : ''}</td>`;

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
      if (tr.trendReversal) {
        const arrow = tr.trendReversalDirection === 'up' ? '↗' : '↘';
        html += `<td class="trend-col trend-reversal" title="3-month trend is reversing the 12-month direction">${arrow} Reversing</td>`;
      } else {
        html += `<td class="trend-col ${trendClass(tr.trend3m)}">${fmtTrend(tr.trend3m)}</td>`;
      }

      // Quarter columns
      const q = metric.quarters || {};
      html += `<td class="quarter-col">${q.strongestQ || '—'}<br><small>${q.strongestQSum != null ? fmt(q.strongestQSum) : ''}</small></td>`;
      const ls = q.levelShift;
      let weakestCell = `${q.weakestQ || '—'}<br><small>${q.weakestQSum != null ? fmt(q.weakestQSum) : ''}</small>`;
      if (ls?.detected) {
        const lsArrow = ls.direction === 'up' ? '⇧' : '⇩';
        const lsSign  = ls.direction === 'up' ? '+' : '-';
        const lsTip   = `Recent 2 quarters average ${ls.direction} ${ls.magnitude}% vs prior quarters`;
        weakestCell += `<span class="level-shift-badge shift-${ls.direction}" title="${lsTip}">${lsArrow} New level (${lsSign}${ls.magnitude}%)</span>`;
      }
      html += `<td class="quarter-col">${weakestCell}</td>`;

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
      if (section === 'UNKNOWN') return;
      if (/net\s*operating\s*income|^\s*noi\s*$/i.test(name)) return;
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
    if (tr.trendReversal) {
      const arrow = tr.trendReversalDirection === 'up' ? '↗' : '↘';
      html += `<td class="trend-reversal" title="3-month trend is reversing the 12-month direction">${arrow} Reversing</td>`;
    } else {
      html += `<td class="${trendClass(tr.trend3m)}">${fmtTrend(tr.trend3m)}</td>`;
    }
    const q = metric.quarters || {};
    const lsComp = q.levelShift;
    let weakestComp = q.weakestQ || '—';
    if (lsComp?.detected) {
      const lsArrow = lsComp.direction === 'up' ? '⇧' : '⇩';
      const lsSign  = lsComp.direction === 'up' ? '+' : '-';
      const lsTip   = `Recent 2 quarters average ${lsComp.direction} ${lsComp.magnitude}% vs prior quarters`;
      weakestComp += `<span class="level-shift-badge shift-${lsComp.direction}" title="${lsTip}">${lsArrow} New level (${lsSign}${lsComp.magnitude}%)</span>`;
    }
    html += `<td>${q.strongestQ || '—'}</td><td>${weakestComp}</td>`;
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

  /** Render a single evidence-signal row */
  function _renderSignalRow(sig) {
    return `<div class="ev-signal ev-signal-${sig.score > 0 ? 'supports' : sig.score < 0 ? 'contradicts' : 'neutral'}">
      <span class="ev-signal-icon">${sig.icon}</span>
      <span class="ev-signal-name">${escHtml(sig.name)}</span>
      <span class="ev-signal-value">${escHtml(sig.value)}</span>
      <span class="ev-signal-explanation">${escHtml(sig.explanation)}</span>
    </div>`;
  }

  /** Render the score line: "Evidence signals: X / 5 · Relative support: X%" */
  function _renderScoreLine(candidate) {
    return `<div class="ev-score-line">
      <span class="ev-score-count">Evidence signals: <strong>${candidate.evidenceSignals} / 5</strong></span>
      <span class="ev-score-sep">·</span>
      <span class="ev-score-share">Relative support: <strong>${candidate.relativeSupport}%</strong></span>
    </div>`;
  }

  function renderAnomalyCard(reasonData, metric, monthLabel) {
    if (!reasonData) return '';
    const { primary, alternatives, corroborating } = reasonData;
    const z = metric.zScores[reasonData.monthIdx];
    if (!z) return '';

    const enrichedPrimary   = reasonData.enrichedPrimary   || null;
    const dataSources       = reasonData.dataSources       || [];
    const corroboratingNote = reasonData.corroboratingNote || null;
    const evidenceProfile   = reasonData.evidenceProfile   || null;

    const pnlColor = z.pnl === 'profit' ? '#2e7d32' : z.pnl === 'loss' ? '#b71c1c' : '#e65100';
    const pnlLabel = z.pnl ? z.pnl.toUpperCase() : '';
    const anomalyTypeLabel = z.anomalyType === 'change' ? 'Change Anomaly' : 'Value Anomaly';
    const deviation = reasonData.effectiveZ
      ? (reasonData.effectiveZ > 0 ? '+' : '') + reasonData.effectiveZ.toFixed(2) + 'σ' : '';

    // ── generatedBy badge ──────────────────────────────────
    const generatedBy    = reasonData.generatedBy || null;
    const reasonerPrimary = reasonData.reasonerResult?.primary || null;
    const matchedMetrics  = reasonerPrimary?.matchedMetrics || [];

    const BADGE_STYLES = {
      data_pattern:  { bg: '#e8f5e9', color: '#2e7d32', border: '#a5d6a7' },
      single_metric: { bg: '#e3f2fd', color: '#1565c0', border: '#90caf9' },
      external_data: { bg: '#f3e5f5', color: '#6a1b9a', border: '#ce93d8' },
      fallback:      { bg: '#fff8e1', color: '#e65100', border: '#ffcc02' },
    };
    const BADGE_META = {
      data_pattern:  { icon: '📊', label: 'Data pattern' },
      single_metric: { icon: '📋', label: 'Metric analysis' },
      external_data: { icon: '🌐', label: 'External data' },
      fallback:      { icon: '⚠️', label: 'Pattern match only' },
    };
    const BADGE_TOOLTIPS = {
      data_pattern:  `This reason was generated by detecting co-movement across ${reasonerPrimary?.signalCount ?? '?'} related metrics in your data.`,
      single_metric: 'This reason was generated from the behavior of this specific metric — no corroborating co-movement detected.',
      external_data: 'External macro data influenced this reason ranking.',
      fallback:      'No clear data pattern detected. This reason is based on general rules, not your specific data.',
    };

    let badgeHtml = '';
    if (generatedBy && BADGE_META[generatedBy]) {
      const st = BADGE_STYLES[generatedBy];
      const mt = BADGE_META[generatedBy];
      const tt = escHtml(BADGE_TOOLTIPS[generatedBy]);
      badgeHtml = ` <span class="generated-by-badge"
        title="${tt}"
        style="display:inline-block;font-size:0.72rem;font-weight:600;padding:2px 7px;border-radius:10px;margin-left:6px;vertical-align:middle;cursor:default;background:${st.bg};color:${st.color};border:1px solid ${st.border}"
        >${mt.icon} ${escHtml(mt.label)}</span>`;
    }

    // ── Historical context line ────────────────────────────
    const hCtx = reasonerPrimary?.historicalContext || null;
    let historicalHtml = '';
    if (hCtx && hCtx.timesSeenBefore > 0) {
      const stateLabel = escHtml(reasonData.stateAbbr || '');
      const inStr = stateLabel ? ` in ${stateLabel}` : '';
      historicalHtml = `<div style="margin-top:5px;font-size:0.78rem;color:#757575">` +
        `📈 Seen ${hCtx.timesSeenBefore} time${hCtx.timesSeenBefore !== 1 ? 's' : ''} ` +
        `across ${hCtx.propertiesCount} propert${hCtx.propertiesCount !== 1 ? 'ies' : 'y'}${inStr}` +
        `</div>`;
    }

    // ── Co-moving metrics collapsible ──────────────────────
    let coMoversHtml = '';
    if (matchedMetrics.length > 0) {
      const rows = matchedMetrics.map(cm => {
        const ez   = cm.effectiveZ != null ? cm.effectiveZ : 0;
        const sign = ez >= 0 ? '+' : '';
        return `<li style="margin:3px 0;font-size:0.82rem">${escHtml(cm.name)} <span style="color:#757575">(Z = ${sign}${ez.toFixed(1)}, same direction)</span></li>`;
      }).join('');
      coMoversHtml = `
      <details class="co-movers-details" style="margin-top:6px;font-size:0.82rem">
        <summary style="cursor:pointer;color:#546e7a;font-weight:600;list-style:none;user-select:none">
          ▶ Co-moving metrics that support this reason:
        </summary>
        <ul style="margin:6px 0 0 14px;padding:0;list-style:disc">${rows}</ul>
      </details>`;
    }

    let html = `<div class="anomaly-card">
      <div class="anomaly-card-header">
        <span class="anomaly-type-badge">${anomalyTypeLabel}</span>
        <span class="anomaly-month">${monthLabel}</span>
        <span class="anomaly-deviation">${deviation}</span>
        <span class="pnl-badge" style="color:${pnlColor}">${pnlLabel} (${metric.section})</span>
      </div>`;

    // ── Evidence profile path ──
    if (evidenceProfile) {
      const ep = evidenceProfile;
      const pri = ep.primary;

      // Primary reason box (always expanded)
      html += `<div class="reason-box reason-box--primary">
        <div class="reason-box-header">
          <span class="reason-box-label">Primary Reason</span>${badgeHtml}
        </div>
        <div class="reason-box-narrative">
          ${escHtml(enrichedPrimary || primary?.label || String(primary || ''))}
          ${historicalHtml}
          ${coMoversHtml}
        </div>
        <details class="rb-evidence">
          <summary>Evidence signals</summary>
          <div class="reason-box-body">
            ${_renderScoreLine(pri)}
            <div class="ev-signals">`;
      (pri.signals || []).forEach(sig => { html += _renderSignalRow(sig); });
      html += `</div></div></details></div>`;

      // Alt reason boxes (collapsible)
      if (ep.alternatives && ep.alternatives.length > 0) {
        ep.alternatives.forEach((alt, idx) => {
          const altDisplayText = (idx < (reasonData.enrichedAlternatives || []).length)
            ? reasonData.enrichedAlternatives[idx]
            : alt.label;
          const altPreview = escHtml(altDisplayText.length > 80 ? altDisplayText.slice(0, 80) + '…' : altDisplayText);
          html += `<details class="reason-box reason-box--alt">
            <summary class="reason-box-summary">
              <span class="reason-box-label">Alt ${idx + 1}</span>
              <span class="reason-box-preview">${altPreview}</span>
            </summary>
            <div class="reason-box-body">
              <div class="reason-box-narrative">${escHtml(altDisplayText)}</div>
              <details class="rb-evidence">
                <summary>Evidence signals</summary>
                ${_renderScoreLine(alt)}
                <div class="ev-signals">`;
          (alt.signals || []).forEach(sig => { html += _renderSignalRow(sig); });
          html += `</div></details></div></details>`;
        });
      }

      // Disclaimer
      html += `<div class="ev-disclaimer">${escHtml(ep.disclaimer)}</div>`;
    } else {
      // No evidence profile — primary box (no signals)
      html += `<div class="reason-box reason-box--primary">
        <div class="reason-box-header">
          <span class="reason-box-label">Primary Reason</span>${badgeHtml}
        </div>
        <div class="reason-box-narrative">
          ${escHtml(enrichedPrimary || primary?.label || String(primary || ''))}
          ${historicalHtml}
          ${coMoversHtml}
        </div>
      </div>`;

      // Alt boxes
      const displayAlts = reasonData.enrichedAlternatives || (alternatives || []);
      if (displayAlts.length > 0) {
        displayAlts.forEach((alt, idx) => {
          const altText = typeof alt === 'string' ? alt : (alt.label || String(alt));
          const altPreview = escHtml(altText.length > 80 ? altText.slice(0, 80) + '…' : altText);
          html += `<details class="reason-box reason-box--alt">
            <summary class="reason-box-summary">
              <span class="reason-box-label">Alt ${idx + 1}</span>
              <span class="reason-box-preview">${altPreview}</span>
            </summary>
            <div class="reason-box-body">
              <div class="reason-box-narrative">${escHtml(altText)}</div>
            </div>
          </details>`;
        });
      }
    }

    // Corroborating anomalies
    if (corroborating && corroborating.length > 0) {
      html += '<div class="anomaly-corroborating"><strong>Corroborating Anomalies</strong><ul>';
      corroborating.forEach(c => {
        html += `<li>${escHtml(c.metricName)} — ${c.monthLabel} <span class="sim-score">${c.similarity}% match</span></li>`;
      });
      html += '</ul>';
      if (corroboratingNote) {
        html += `<div class="corr-data-note">${escHtml(corroboratingNote)}</div>`;
      }
      html += '</div>';
    }

    // Data Sources Used (collapsible)
    if (dataSources.length > 0) {
      html += `<details class="data-sources-section">
        <summary>Data Sources Used (${dataSources.length})</summary>
        <ul class="data-sources-list">`;
      dataSources.forEach(s => {
        html += `<li>
          <span class="ds-label">${escHtml(s.label)}</span>
          <span class="ds-value">${escHtml(String(s.value || ''))}</span>
          ${s.period ? `<span class="ds-period">${escHtml(s.period)}</span>` : ''}
          ${s.note   ? `<span class="ds-note">${escHtml(s.note)}</span>` : ''}
        </li>`;
      });
      html += `</ul></details>`;
    }

    html += '</div>';
    return html;
  }

  // ── SUMMARY BADGES ────────────────────────────────────

  function renderSummaryBadges(stats) {
    if (!stats) return '';
    return `<span class="summary-badge summary-badge--total">⚠ Total Material <strong>${stats.totalMaterial}</strong></span>` +
           `<span class="summary-badge summary-badge--income">▲ Income <strong>${stats.incomeAnomalies}</strong></span>` +
           `<span class="summary-badge summary-badge--expense">▼ Expenses <strong>${stats.expenseAnomalies}</strong></span>` +
           `<span class="summary-badge summary-badge--seasonal">◈ Seasonal <strong>${stats.seasonalAnomalies}</strong></span>`;
  }

  // ── RULE CANDIDATES PANEL ────────────────────────────

  function renderRuleCandidates(candidates, onApprove, onDismiss) {
    const panel = document.getElementById('rule-candidates-panel');
    if (!panel) return;

    if (!candidates || candidates.length === 0) {
      panel.innerHTML = '';
      return;
    }

    const cardsHtml = candidates.map(c => {
      const pt = c.pattern_type.replace(/_/g, ' ');
      const rules = c.suggested_rules || [];
      const optionsHtml = rules.map((ruleText, i) => `
        <label class="rule-option-label">
          <input type="radio" name="rule_${escHtml(c.id)}" value="${i}">
          <span>${escHtml(ruleText)}</span>
        </label>
      `).join('');
      const writeOwnHtml = `
        <label class="rule-option-label">
          <input type="radio" name="rule_${escHtml(c.id)}" value="custom">
          <span>Write my own:</span>
        </label>
        <input type="text"
          class="rule-custom-input"
          id="custom_${escHtml(c.id)}"
          placeholder="Describe the rule..."
          style="display:none; width:100%; margin-top:4px;">
      `;
      return `<div class="rule-suggestion-card" data-id="${escHtml(c.id)}">
        <div class="rule-suggestion-title">${escHtml(c.metric_name)} — ${escHtml(pt)}</div>
        <div class="rule-suggestion-meta">Seen ${c.total_occurrences} times across ${c.distinct_property_count} properties</div>
        <div class="rule-pattern-description">${(c.pattern_description || '').replace(/\n/g, '<br>')}</div>
        <div class="rule-suggestion-options">
          ${optionsHtml}
          ${writeOwnHtml}
        </div>
        <div class="rule-suggestion-actions">
          <button class="rule-btn-approve" data-id="${escHtml(c.id)}">Add Rule</button>
          <button class="rule-btn-dismiss" data-id="${escHtml(c.id)}">Dismiss</button>
        </div>
      </div>`;
    }).join('');

    panel.innerHTML = `<div class="rule-suggestion-panel">
      <div class="rule-suggestion-header">💡 Pattern Detected</div>
      ${cardsHtml}
    </div>`;

    panel.querySelectorAll('.rule-suggestion-card').forEach(card => {
      const candidateId = card.dataset.id;
      const candidate   = candidates.find(x => x.id === candidateId);
      const radios      = card.querySelectorAll('input[type="radio"]');
      const customInput = document.getElementById(`custom_${candidateId}`);

      // Show/hide custom text input based on radio selection
      radios.forEach(radio => {
        radio.addEventListener('change', () => {
          if (customInput) customInput.style.display = radio.value === 'custom' ? 'block' : 'none';
        });
      });

      // Approve
      card.querySelector('.rule-btn-approve').addEventListener('click', () => {
        const selected = document.querySelector(`input[name="rule_${candidateId}"]:checked`);
        if (!selected) {
          alert('Please select a rule option first.');
          return;
        }
        let ruleText;
        if (selected.value === 'custom') {
          ruleText = customInput?.value.trim();
          if (!ruleText) {
            alert('Please write your rule in the text box.');
            return;
          }
        } else {
          const idx = parseInt(selected.value);
          ruleText = (candidate?.suggested_rules || [])[idx] || '';
        }
        onApprove(candidateId, ruleText);
      });

      // Dismiss
      card.querySelector('.rule-btn-dismiss').addEventListener('click', () => {
        onDismiss(candidateId);
      });
    });
  }

  // ── EXECUTIVE TABLE ───────────────────────────────────

  function renderExecutiveTable(executiveResult, months) {
    const container = document.getElementById('ea-table-container');
    const badgesEl  = document.getElementById('ea-summary-badges');
    if (!container) return;

    const { results, threshold } = executiveResult;

    // ── Summary badges ────────────────────────────────
    if (badgesEl) {
      const incomeFlags   = results.filter(r => r.section === 'INCOME').length;
      const expenseFlags  = results.filter(r => r.section === 'EXPENSES').length;
      badgesEl.innerHTML =
        `<span class="summary-badge summary-badge--total">⚠ Flagged Metrics <strong>${results.length}</strong></span>` +
        `<span class="summary-badge summary-badge--income">▲ Income <strong>${incomeFlags}</strong></span>` +
        `<span class="summary-badge summary-badge--expense">▼ Expenses <strong>${expenseFlags}</strong></span>`;
      badgesEl.classList.remove('hidden');
    }

    if (results.length === 0) {
      container.innerHTML = '<p style="padding:16px;color:#64748b">No metrics exceeded the materiality threshold.</p>';
      return;
    }

    // ── Determine visible month range ─────────────────
    // Find the last month index that has any flag across all results
    let lastFlaggedIdx = 0;
    results.forEach(r => {
      Object.keys(r.flags).forEach(i => {
        if (parseInt(i) > lastFlaggedIdx) lastFlaggedIdx = parseInt(i);
      });
    });
    const visibleMonths = months.slice(0, lastFlaggedIdx + 1);

    // ── Build table ───────────────────────────────────
    let html = '<div style="overflow-x:auto"><table class="anomaly-table ea-exec-table">';

    // Header
    html += '<thead><tr><th class="metric-name-col">Metric</th>';
    visibleMonths.forEach(m => { html += `<th>${escHtml(m)}</th>`; });
    html += '</tr></thead><tbody>';

    let lastSection = '';
    results.forEach(result => {
      if (result.section !== lastSection) {
        lastSection = result.section;
        html += `<tr class="section-header-row">
          <td colspan="${visibleMonths.length + 1}" class="section-header">${escHtml(result.section)}</td>
        </tr>`;
      }

      html += `<tr class="metric-row" data-ea-metric="${escHtml(result.name)}">`;
      html += `<td class="metric-name">${escHtml(result.name)}</td>`;

      visibleMonths.forEach((_, i) => {
        const flag = result.flags[i];
        if (!flag) {
          html += '<td class="cell-normal"></td>';
          return;
        }
        const isIncome  = result.section === 'INCOME';
        const isUp      = flag.direction === 'up';
        const cellClass  = (isIncome ? isUp : !isUp) ? 'cell-material-positive' : 'cell-material-negative';
        const displayVal = fmt(result.values[i]);
        const reasoningEscaped = (flag.reasoning || '')
          .replace(/\\/g, '\\\\')
          .replace(/'/g, "\\'")
          .replace(/\r/g, '')
          .replace(/\n/g, '\\n');
        const onclickAttr = `UI.openEADetail('${escHtml(result.name).replace(/'/g,"\\'")}','${flag.monthLabel}',${flag.T3_current},${flag.T3_prior},${flag.T12},${flag.threshold},${flag.movementFromPrior},${flag.movementFromT12},${flag.flaggedByPrior},${flag.flaggedByT12},'${flag.direction}','${reasoningEscaped}')`;
        html += `<td class="${cellClass}" style="cursor:pointer;text-align:center" onclick="${escHtml(onclickAttr)}"><span style="font-size:10px">${isUp ? '▲' : '▼'} ${displayVal}</span></td>`;
      });

      html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  }

  // ── EA DETAIL PANEL (called via inline onclick) ───────

  function openEADetail(metricName, monthLabel, t3Current, t3Prior, t12, threshold, movementFromPrior, movementFromT12, flaggedByPrior, flaggedByT12, direction, reasoning) {
    const cardEl = document.getElementById('detail-card-ea');
    if (!cardEl) return;

    function fmtLocal(n) {
      if (n == null) return '—';
      return '$' + Math.round(Math.abs(n)).toLocaleString();
    }

    const reasoningHtml = reasoning
      ? `<div class="ea-detail-reasoning">${escHtml(reasoning).replace(/\n\n/g, '<br><br>')}</div>`
      : '';

    const content = `
      <div class="ea-detail">
        <div class="ea-detail-title">${escHtml(metricName)} — ${escHtml(monthLabel)}</div>
        ${reasoningHtml}
        <div class="ea-detail-body">
          <div class="ea-detail-row"><span>T3 Current (annualized)</span><span>${fmtLocal(t3Current)}</span></div>
          <div class="ea-detail-row"><span>T3 Prior (annualized)</span><span>${fmtLocal(t3Prior)}</span></div>
          <div class="ea-detail-row"><span>T12</span><span>${fmtLocal(t12)}</span></div>
          <div class="ea-detail-row"><span>Threshold (0.1% of purchase price)</span><span>${fmtLocal(threshold)}</span></div>
          <div class="ea-detail-row ${flaggedByPrior ? 'ea-detail-flagged' : ''}">
            <span>Movement vs T3 Prior</span>
            <span>${fmtLocal(movementFromPrior)} ${flaggedByPrior ? '⚠ exceeds threshold' : ''}</span>
          </div>
          <div class="ea-detail-row ${flaggedByT12 ? 'ea-detail-flagged' : ''}">
            <span>Movement vs T12</span>
            <span>${fmtLocal(movementFromT12)} ${flaggedByT12 ? '⚠ exceeds threshold' : ''}</span>
          </div>
          <div class="ea-detail-row"><span>Direction</span><span>${direction === 'up' ? '▲ Up' : '▼ Down'}</span></div>
        </div>
      </div>`;

    cardEl.innerHTML = '<button class="close-card" title="Close">✕</button>' + content;
    cardEl.classList.add('open');
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
    renderSummaryBadges,
    renderRuleCandidates,
    renderExecutiveTable,
    openEADetail,
    getCellClass,
    fmt,
    fmtPct,
    escHtml,
  };
})();
