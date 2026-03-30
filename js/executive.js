// Executive Analysis — pure computation module, no DOM, no fetch.

const THRESHOLD_RATE    = 0.001; // 0.1% of purchase price
const MIN_MONTHS_REQUIRED = 12;  // first 12 months immune

function analyse(metrics, months, purchasePrice, stateAbbr, city) {
  const threshold = (purchasePrice || 0) * THRESHOLD_RATE;
  const results = [];

  metrics.forEach(metric => {
    const values = metric.values || [];
    const flags = {}; // monthIdx → flag details

    months.forEach((monthLabel, i) => {
      // Skip first 12 months
      if (i < MIN_MONTHS_REQUIRED) return;
      // Need at least 3 months before current for T3_prior
      if (i < 3) return;

      const v = values[i];
      if (v == null) return;

      // T3_current: sum of values[i-2], values[i-1], values[i], annualized ×4
      const t3Vals = [values[i-2], values[i-1], values[i]];
      if (t3Vals.some(v => v == null)) return;
      const T3_current = t3Vals.reduce((a,b) => a+b, 0) * 4;

      // T3_prior: sum of values[i-3], values[i-2], values[i-1], annualized ×4
      const t3PriorVals = [values[i-3], values[i-2], values[i-1]];
      if (t3PriorVals.some(v => v == null)) return;
      const T3_prior = t3PriorVals.reduce((a,b) => a+b, 0) * 4;

      // T12: sum of values[i-11] through values[i]
      if (i < 11) return;
      const t12Vals = values.slice(i-11, i+1);
      if (t12Vals.some(v => v == null)) return;
      const T12 = t12Vals.reduce((a,b) => a+b, 0);

      // Check conditions
      const movementFromPrior = Math.abs(T3_current - T3_prior);
      const movementFromT12   = Math.abs(T3_current - T12);
      const flaggedByPrior    = movementFromPrior > threshold;
      const flaggedByT12      = movementFromT12   > threshold;

      if (flaggedByPrior || flaggedByT12) {
        flags[i] = {
          monthLabel,
          T3_current,
          T3_prior,
          T12,
          threshold,
          movementFromPrior,
          movementFromT12,
          flaggedByPrior,
          flaggedByT12,
          direction: T3_current > T3_prior ? 'up' : 'down',
        };
      }
    });

    if (Object.keys(flags).length > 0) {
      results.push({
        name:    metric.name,
        section: metric.section,
        values:  metric.values,
        flags,
      });
    }
  });

  return { results, months, threshold, stateAbbr: stateAbbr || '', city: city || '' };
}

const Executive = { analyse };
