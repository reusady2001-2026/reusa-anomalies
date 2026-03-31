// ============================================================
// ENRICHER.JS — Layer 0: Anomaly Enricher
// Runs after Engine.analyse(). Computes a richer signal profile
// for each detected anomaly. Called per-anomaly, not per-metric.
// ============================================================

const Enricher = (() => {

  // ── PUBLIC API ────────────────────────────────────────────

  /**
   * @param {Object} metric    - enriched metric object from Engine.analyse()
   * @param {number} monthIdx  - relative display index of the anomaly
   * @param {Array}  allMetrics
   * @param {Array}  months    - month label strings
   * @returns {Object} anomalyProfile
   */
  function enrichAnomaly(metric, monthIdx, allMetrics, months, coMovers, cloudHistory) {
    return {
      velocity:              _velocity(metric, monthIdx),
      recovery:              _recovery(metric, monthIdx),
      dollarImpact:          _dollarImpactAndReference(metric, monthIdx, allMetrics),
      causalityChain:        _causalityChain(metric, monthIdx, coMovers, allMetrics),
      reversalTiming:        _reversalTiming(metric, monthIdx, months),
      seasonalExpectation:   _seasonalExpectation(metric, monthIdx, months),
      crossPropertyBaseline: _crossPropertyBaseline(metric, monthIdx, months, cloudHistory),
    };
  }

  // ── SIGNAL 1: VELOCITY ────────────────────────────────────
  // Count how many consecutive months leading up to (and including)
  // monthIdx were either anomalous or moving in the same Z direction.

  function _velocity(metric, monthIdx) {
    const selfZ   = metric.zScores && metric.zScores[monthIdx];
    const selfDir = selfZ ? Math.sign(selfZ.effectiveZ) : 0;
    const anomSet = new Set(metric.anomalies || []);

    let count = 1; // always count monthIdx itself

    for (let i = monthIdx - 1; i >= 0; i--) {
      const z       = metric.zScores && metric.zScores[i];
      const isAnom  = anomSet.has(i);
      const sameDir = z && selfDir !== 0 && Math.sign(z.effectiveZ) === selfDir;
      if (isAnom || sameDir) {
        count++;
      } else {
        break;
      }
    }

    let type, description;
    if (count === 1) {
      type        = 'sudden';
      description = 'spiked in a single month';
    } else if (count <= 3) {
      type        = 'drift';
      description = `built up over ${count} months`;
    } else {
      type        = 'sustained';
      description = `has been elevated for ${count} months`;
    }

    return { monthCount: count, type, description };
  }

  // ── SIGNAL 2: RECOVERY STATUS ─────────────────────────────
  // Look forward up to 3 months. Compare values to metric.mean.

  function _recovery(metric, monthIdx) {
    const vals      = metric.values || [];
    const mean      = metric.mean   || 0;
    const available = vals.length - monthIdx - 1; // months of data after the anomaly

    if (available < 2) {
      return {
        status:          'unknown',
        monthsToResolve: null,
        description:     'not enough data after the anomaly to assess recovery',
      };
    }

    const checkCount = Math.min(3, available);
    // 10% of |mean| is the "resolved" band; guard against mean === 0
    const band       = Math.abs(mean) > 0 ? Math.abs(mean) * 0.10 : 0;
    const baseline   = Math.abs(vals[monthIdx] - mean);

    let resolvedAt   = null;
    let maxDeviation = baseline;

    for (let i = 1; i <= checkCount; i++) {
      const dev = Math.abs(vals[monthIdx + i] - mean);
      if (dev > maxDeviation) maxDeviation = dev;
      if (resolvedAt === null && Math.abs(mean) > 0 && dev <= band) {
        resolvedAt = i;
      }
    }

    let status, monthsToResolve, description;

    if (resolvedAt !== null) {
      status          = 'resolved';
      monthsToResolve = resolvedAt;
      description     = resolvedAt === 1
        ? 'resolved the following month'
        : `resolved after ${resolvedAt} months`;
    } else if (maxDeviation > baseline) {
      status          = 'worsening';
      monthsToResolve = null;
      description     = 'continued worsening after the spike';
    } else {
      status          = 'persisting';
      monthsToResolve = null;
      description     = `still elevated ${checkCount} months later`;
    }

    return { status, monthsToResolve, description };
  }

  // ── SIGNAL 5: CAUSALITY CHAIN ─────────────────────────────
  // For each co-mover, find the earliest month it became anomalous
  // within ±3 months of monthIdx. Negative offset = moved before current.

  function _causalityChain(metric, monthIdx, coMovers, allMetrics) {
    const peers = (coMovers || []).filter(cm => !cm.isSelf);

    if (peers.length === 0) {
      return {
        likelyCause:  null,
        effects:      [],
        description:  'No co-moving metrics identified',
      };
    }

    // Build a lookup map from metric id → anomalies[] from allMetrics
    const anomalyMap = {};
    (allMetrics || []).forEach(m => { anomalyMap[m.id] = m.anomalies || []; });

    // For each peer, find earliest anomaly index within [monthIdx-3, monthIdx+3]
    const offsets = peers.map(cm => {
      const anomalies = anomalyMap[cm.id] || [];
      let earliest = null;
      for (let delta = -3; delta <= 3; delta++) {
        const idx = monthIdx + delta;
        if (idx < 0) continue;
        if (anomalies.includes(idx)) {
          earliest = delta; // offset relative to current anomaly
          break;            // want the most negative (earliest) first
        }
      }
      return { name: cm.name, section: cm.section, offset: earliest };
    }).filter(e => e.offset !== null);

    // Separate causes (negative offset or 0) and effects (positive offset)
    const before = offsets.filter(e => e.offset < 0)
                          .sort((a, b) => a.offset - b.offset); // most negative first
    const same   = offsets.filter(e => e.offset === 0);
    const after  = offsets.filter(e => e.offset > 0)
                          .sort((a, b) => a.offset - b.offset);

    const likelyCause = before.length > 0
      ? { name: before[0].name, section: before[0].section, movedFirst: Math.abs(before[0].offset) }
      : null;

    const effects = after.map(e => ({ name: e.name, section: e.section, movedAfter: e.offset }));

    let description;
    if (likelyCause) {
      const months = likelyCause.movedFirst;
      description = `${metric.name} likely triggered by ${likelyCause.name} ${months} month${months !== 1 ? 's' : ''} earlier`;
    } else if (effects.length > 0) {
      const names = effects.slice(0, 2).map(e => e.name).join(' and ');
      description = `This metric moved first — ${names} followed`;
    } else if (same.length > 0) {
      description = 'All metrics moved simultaneously — no clear cause identified';
    } else {
      description = 'No co-moving metrics identified';
    }

    return { likelyCause, effects, description };
  }

  // ── SIGNAL 6: REVERSAL TIMING ──────────────────────────────
  // Uses trendReversal / trendReversalDirection already on metric.trends.
  // Scans backwards to find where the direction changed.

  function _reversalTiming(metric, monthIdx, months) {
    const trends = metric.trends || {};

    if (!trends.trendReversal) {
      return {
        detected:        false,
        direction:       null,
        startMonthIdx:   null,
        startMonthLabel: null,
        monthsAgo:       null,
        description:     'No reversal detected',
      };
    }

    const direction  = trends.trendReversalDirection; // 'up' | 'down'
    const zScores    = metric.zScores || {};
    // The current anomaly's effectiveZ determines "current" sign
    const currentZ   = zScores[monthIdx] ? zScores[monthIdx].effectiveZ : 0;
    const currentSign = Math.sign(currentZ);

    // Walk backwards: find the last month whose sign was OPPOSITE to currentSign.
    // The month immediately after that is where the reversal started.
    let oppositeAt = null;
    for (let i = monthIdx - 1; i >= 0; i--) {
      const z = zScores[i];
      if (!z || z.effectiveZ == null) continue;
      if (Math.sign(z.effectiveZ) !== currentSign) {
        oppositeAt = i;
        break;
      }
    }

    // Reversal started the month after oppositeAt, or at index 0 if no opposite found
    const startMonthIdx   = oppositeAt !== null ? oppositeAt + 1 : 0;
    const startMonthLabel = (months && months[startMonthIdx]) || null;
    const monthsAgo       = monthIdx - startMonthIdx;

    const dirLabel    = direction === 'up' ? 'upward' : 'downward';
    const agoStr      = monthsAgo === 0 ? 'this month'
                      : monthsAgo === 1 ? '1 month ago'
                      : `${monthsAgo} months ago`;
    const labelStr    = startMonthLabel ? ` in ${startMonthLabel},` : ',';
    const description = `Reversing ${dirLabel} — trend turned${labelStr} ${agoStr}`;

    return { detected: true, direction, startMonthIdx, startMonthLabel, monthsAgo, description };
  }

  // ── SIGNAL 7: SEASONAL EXPECTATION ────────────────────────
  // Compares this month's elevation above mean to the historical average
  // elevation for the same calendar month in prior years.

  function _seasonalExpectation(metric, monthIdx, months) {
    const vals = metric.values || [];
    const mean = metric.mean   || 0;
    const monthLabel = months && months[monthIdx]; // e.g. "Oct 2024"

    // Derive calendar month name (e.g. "Oct") from the label
    const calMonth = monthLabel ? monthLabel.split(' ')[0] : null;

    // Actual elevation
    const actual = vals[monthIdx];
    const actualElevation = mean !== 0
      ? Math.round(((actual - mean) / Math.abs(mean)) * 1000) / 10
      : 0;

    // Find prior values for the same calendar month
    let sameMonthValues = [];
    if (calMonth && months) {
      for (let i = 0; i < monthIdx; i++) {
        if (months[i] && months[i].startsWith(calMonth + ' ') && vals[i] != null) {
          sameMonthValues.push(vals[i]);
        }
      }
    }

    // Also check metric.seasonalityMonths / recurringPatterns for the same idx
    const isSeasonalMonth = !!(
      (metric.seasonalityMonths && metric.seasonalityMonths.includes(monthIdx)) ||
      (metric.recurringPatterns  && metric.recurringPatterns.includes(monthIdx))
    );

    if (sameMonthValues.length === 0 || mean === 0) {
      return {
        isSeasonalMonth,
        expectedElevation:    null,
        actualElevation,
        excessAboveSeasonal:  null,
        description: isSeasonalMonth
          ? `This is a typically elevated month for this metric, but no prior-year data to quantify`
          : 'No seasonal pattern detected for this metric in this month',
      };
    }

    const sameMonthAvg    = sameMonthValues.reduce((s, v) => s + v, 0) / sameMonthValues.length;
    const expectedElevation = Math.round(((sameMonthAvg - mean) / Math.abs(mean)) * 1000) / 10;
    const excessAboveSeasonal = Math.round((actualElevation - expectedElevation) * 10) / 10;

    const sign = v => v >= 0 ? '+' : '';
    let description;
    if (Math.abs(expectedElevation) < 1) {
      description = `No meaningful seasonal pattern for ${calMonth} — actual is ${sign(actualElevation)}${actualElevation}% vs mean`;
    } else {
      const above = expectedElevation >= 0 ? 'above' : 'below';
      const excessAbs = Math.abs(excessAboveSeasonal);
      description = `${calMonth} typically runs ${Math.abs(expectedElevation)}% ${above} average — ` +
        `actual is ${sign(actualElevation)}${actualElevation}%, ` +
        `so ${excessAbs}% is ${excessAboveSeasonal >= 0 ? 'above' : 'below'} seasonal expectation`;
    }

    return { isSeasonalMonth, expectedElevation, actualElevation, excessAboveSeasonal, description };
  }

  // ── SIGNAL 3 + 4: DOLLAR IMPACT & REFERENCE POINT ────────
  // Picks the best available reference value (priority order):
  //   1. prior_year_same_month  (monthIdx - 12)
  //   2. prior_t3               (average of monthIdx-3, monthIdx-4, monthIdx-5)
  //   3. baseline_mean          (metric.mean)
  // Then computes the dollar deviation and optional % of NOI context.

  function _dollarImpactAndReference(metric, monthIdx, allMetrics) {
    console.log('[Enricher] _dollarImpactAndReference called, _eaOverride:', metric.reasonData?.[monthIdx]?._eaOverride);
    // EA override — use T3 movement as deviation instead of Z-score based deviation
    if (metric.reasonData?.[monthIdx]?._eaOverride) {
      const ov = metric.reasonData[monthIdx]._eaOverride;
      const absDeviation = ov.deviation;
      return {
        referencePoint: {
          type:             'ea_t3',
          value:            ov.T3_prior,
          humanLabel:       'prior T3 (annualized)',
          deltaPct:         ov.T3_prior !== 0 ? (ov.T3_current - ov.T3_prior) / Math.abs(ov.T3_prior) : 0,
          formattedDeltaPct: ov.T3_prior !== 0
            ? `${((ov.T3_current - ov.T3_prior) / Math.abs(ov.T3_prior) * 100).toFixed(1)}%`
            : '—',
        },
        dollarImpact: {
          deviation:          ov.T3_current - ov.T3_prior,
          absDeviation,
          direction:          ov.direction,
          pctOfNoi:           null,
          formattedDeviation: '$' + Math.round(absDeviation).toLocaleString(),
          formattedPctOfNoi:  null,
          description:        `T3 moved $${Math.round(absDeviation).toLocaleString()} vs prior T3`,
        },
      };
    }

    const vals  = metric.values || [];
    const mean  = metric.mean   || 0;
    const fmt   = new Intl.NumberFormat('en-US', {
      style:              'currency',
      currency:           'USD',
      maximumFractionDigits: 0,
    });
    const fmtPct = (v) => (v >= 0 ? '+' : '') + v.toFixed(1) + '%';

    // ── Pick reference point ──────────────────────────────
    let refType, refValue, refHumanLabel;

    const py = monthIdx - 12;
    const t3Indices = [monthIdx - 3, monthIdx - 4, monthIdx - 5].filter(i => i >= 0 && vals[i] != null);

    if (py >= 0 && vals[py] != null) {
      refType       = 'prior_year_same_month';
      refValue      = vals[py];
      refHumanLabel = 'prior year same month';
    } else if (t3Indices.length > 0) {
      refType       = 'prior_t3';
      refValue      = t3Indices.reduce((s, i) => s + vals[i], 0) / t3Indices.length;
      refHumanLabel = `avg of prior ${t3Indices.length} months`;
    } else {
      refType       = 'baseline_mean';
      refValue      = mean;
      refHumanLabel = 'baseline mean';
    }

    const deltaPct          = refValue !== 0 ? ((vals[monthIdx] - refValue) / Math.abs(refValue)) * 100 : 0;
    const formattedDeltaPct = fmtPct(deltaPct);

    const referencePoint = {
      type:             refType,
      value:            refValue,
      humanLabel:       refHumanLabel,
      deltaPct:         Math.round(deltaPct * 10) / 10,
      formattedDeltaPct,
    };

    // ── Dollar deviation ──────────────────────────────────
    const deviation    = vals[monthIdx] - refValue;
    const absDeviation = Math.abs(deviation);
    const direction    = deviation >= 0 ? 'above' : 'below';
    const formattedDeviation = fmt.format(absDeviation);

    // ── % of NOI (Signal 4) ───────────────────────────────
    // NOI proxy: sum of all INCOME-section metrics at monthIdx.
    let pctOfNoi            = null;
    let formattedPctOfNoi   = null;

    if (Array.isArray(allMetrics)) {
      const noiTotal = allMetrics
        .filter(m => m.section && m.section.toLowerCase().includes('income') && Array.isArray(m.values))
        .reduce((s, m) => s + (m.values[monthIdx] || 0), 0);

      if (noiTotal !== 0) {
        pctOfNoi          = Math.round((absDeviation / Math.abs(noiTotal)) * 1000) / 10; // 1 decimal
        formattedPctOfNoi = pctOfNoi.toFixed(1) + '% of NOI';
      }
    }

    // ── Description ───────────────────────────────────────
    let description = `${formattedDeviation} ${direction} ${refHumanLabel}`;
    if (formattedPctOfNoi) description += ` (${formattedPctOfNoi})`;

    return {
      referencePoint,
      dollarImpact: {
        deviation,
        absDeviation,
        direction,
        pctOfNoi,
        formattedDeviation,
        formattedPctOfNoi,
        description,
      },
    };
  }

  // ── SIGNAL 8: CROSS-PROPERTY BASELINE ────────────────────
  // Looks up how many times this anomaly's pattern group has appeared
  // across the portfolio in cloudHistory.patterns.

  function _crossPropertyBaseline(metric, monthIdx, months, cloudHistory) {
    const EMPTY = {
      timesSeenAcrossPortfolio: 0,
      propertiesCount:          0,
      typicalMonths:            [],
      isTypicalMonth:           false,
      portfolioContext:         'isolated',
      description:              'First time this pattern has appeared across the portfolio',
    };

    if (!cloudHistory || !Array.isArray(cloudHistory.patterns) || cloudHistory.patterns.length === 0) {
      return EMPTY;
    }

    // Resolve groupId from reasonData
    const rd      = metric.reasonData && metric.reasonData[monthIdx];
    const groupId = rd?.reasonerResult?.primary?.groupId
                 || rd?.primary?.groupId
                 || null;

    if (!groupId) return EMPTY;

    const matching = cloudHistory.patterns.filter(p => p.group_id === groupId);
    if (matching.length === 0) return EMPTY;

    // Distinct property names (Supabase join provides properties.name)
    const propNames = new Set(matching.map(p => p.properties?.name).filter(Boolean));

    // Collect month_num values and find the most frequent
    const monthFreq = {};
    matching.forEach(p => {
      if (p.month_num != null) monthFreq[p.month_num] = (monthFreq[p.month_num] || 0) + 1;
    });
    const maxFreq = Math.max(0, ...Object.values(monthFreq));
    const typicalMonths = maxFreq > 0
      ? Object.keys(monthFreq)
              .filter(k => monthFreq[k] === maxFreq)
              .map(Number)
              .sort((a, b) => a - b)
      : [];

    // Current month number — derive from months[] label (e.g. "Oct 2024" → month 10)
    const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const label       = months && months[monthIdx];
    const calMonthStr = label ? label.split(' ')[0] : null;
    const currentMonthNum = calMonthStr ? MONTH_NAMES.indexOf(calMonthStr) + 1 : null;
    const isTypicalMonth  = currentMonthNum != null && typicalMonths.includes(currentMonthNum);

    const timesSeenAcrossPortfolio = matching.length;
    const propertiesCount          = propNames.size;

    let portfolioContext = timesSeenAcrossPortfolio === 0 ? 'isolated'
                        : timesSeenAcrossPortfolio <= 2  ? 'rare'
                        : 'common';
    if (propertiesCount <= 1) portfolioContext = 'isolated';

    // Human description
    let description;
    if (timesSeenAcrossPortfolio === 0) {
      description = 'First time this pattern has appeared across the portfolio';
    } else {
      const propStr = `${propertiesCount} propert${propertiesCount !== 1 ? 'ies' : 'y'}`;
      description   = `Seen ${timesSeenAcrossPortfolio} time${timesSeenAcrossPortfolio !== 1 ? 's' : ''} across ${propStr}`;
      if (typicalMonths.length > 0) {
        const monthLabels = typicalMonths.map(n => MONTH_NAMES[n - 1]).filter(Boolean);
        if (monthLabels.length > 0) {
          description += ` — most common in ${monthLabels.join(' and ')}`;
        }
      }
    }

    return { timesSeenAcrossPortfolio, propertiesCount, typicalMonths, isTypicalMonth, portfolioContext, description };
  }

  // ── EXPORTS ───────────────────────────────────────────────
  return { enrichAnomaly };

})();
