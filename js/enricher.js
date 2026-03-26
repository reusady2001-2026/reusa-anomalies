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
  function enrichAnomaly(metric, monthIdx, allMetrics, months) {
    return {
      velocity:           _velocity(metric, monthIdx),
      recovery:           _recovery(metric, monthIdx),
      dollarImpact:       _dollarImpactAndReference(metric, monthIdx, allMetrics),
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

  // ── SIGNAL 3 + 4: DOLLAR IMPACT & REFERENCE POINT ────────
  // Picks the best available reference value (priority order):
  //   1. prior_year_same_month  (monthIdx - 12)
  //   2. prior_t3               (average of monthIdx-3, monthIdx-4, monthIdx-5)
  //   3. baseline_mean          (metric.mean)
  // Then computes the dollar deviation and optional % of NOI context.

  function _dollarImpactAndReference(metric, monthIdx, allMetrics) {
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

  // ── EXPORTS ───────────────────────────────────────────────
  return { enrichAnomaly };

})();
