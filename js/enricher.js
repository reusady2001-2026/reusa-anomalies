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
      velocity: _velocity(metric, monthIdx),
      recovery: _recovery(metric, monthIdx),
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

  // ── EXPORTS ───────────────────────────────────────────────
  return { enrichAnomaly };

})();
