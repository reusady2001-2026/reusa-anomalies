// Executive Analysis — pure computation module, no DOM, no fetch.

const THRESHOLD_RATE    = 0.001; // 0.1% of purchase price
const MIN_MONTHS_REQUIRED = 12;  // first 12 months immune

function generateReasoning(metricName, section, flag) {
  const { T3_current, T3_prior, T12, threshold, movementFromPrior, movementFromT12, flaggedByPrior, flaggedByT12, direction } = flag;

  function fmt(n) {
    return '$' + Math.round(Math.abs(n)).toLocaleString();
  }

  const isIncome = section === 'INCOME';
  const directionWord = direction === 'up' ? 'increased' : 'decreased';
  const isPositive = (isIncome && direction === 'up') || (!isIncome && direction === 'down');

  const lines = [];

  lines.push(`${metricName}'s trailing 3-month run rate ${directionWord} from ${fmt(T3_prior)} to ${fmt(T3_current)} (annualized) — a ${fmt(Math.abs(T3_current - T3_prior))} movement against a materiality threshold of ${fmt(threshold)} (0.1% of purchase price).`);

  if (flaggedByPrior && flaggedByT12) {
    lines.push(`Both conditions triggered: the T3 shifted materially vs. the prior month AND vs. the T12 baseline of ${fmt(T12)}. This is a strong signal — the metric is moving in the same direction on both a short-term and structural basis.`);
  } else if (flaggedByPrior) {
    lines.push(`This was triggered by short-term momentum: the T3 shifted materially vs. the prior month's T3. The T12 baseline of ${fmt(T12)} is within threshold — this may be an early-stage movement rather than a confirmed structural shift.`);
  } else if (flaggedByT12) {
    lines.push(`This was triggered by structural drift: the T3 of ${fmt(T3_current)} has moved materially away from the T12 baseline of ${fmt(T12)} — a ${fmt(movementFromT12)} gap. The month-over-month T3 movement is within threshold, suggesting a gradual drift rather than a sudden shock.`);
  }

  if (isIncome) {
    if (direction === 'up') {
      lines.push(`For an income metric, an upward movement is favorable. This suggests improving revenue performance. Monitor whether this run rate sustains — if T3 remains above T12 for 2+ consecutive months, consider revising forward projections upward.`);
    } else {
      lines.push(`For an income metric, a downward movement is unfavorable. This suggests deteriorating revenue performance. If T3 remains below T12, this may indicate a structural income gap requiring investigation — review lease terms, vacancy trends, or billing issues.`);
    }
  } else {
    if (direction === 'up') {
      lines.push(`For an expense metric, an upward movement is unfavorable. Costs are running above the trailing annual baseline. Review vendor contracts, usage patterns, or one-time charges that may be inflating the recent run rate.`);
    } else {
      lines.push(`For an expense metric, a downward movement is favorable. Costs are running below the trailing annual baseline — this may reflect efficiency gains, reduced activity, or a deferred expense that will catch up in future months.`);
    }
  }

  if (!isPositive) {
    if (flaggedByPrior && flaggedByT12) {
      lines.push(`Recommended action: escalate for review — both short-term momentum and structural drift confirm this is not a one-time event.`);
    } else if (flaggedByT12) {
      lines.push(`Recommended action: monitor closely — the structural drift from T12 suggests this pattern has been building. Review the last 3–6 months of detail for this metric.`);
    } else {
      lines.push(`Recommended action: watch next month — if T3 continues in this direction, escalate for investigation.`);
    }
  } else {
    lines.push(`No immediate action required — movement is favorable. Continue monitoring for sustained performance.`);
  }

  return lines.join('\n\n');
}

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
        const direction = T3_current > T3_prior ? 'up' : 'down';
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
          direction,
          reasoning: generateReasoning(metric.name, metric.section, {
            T3_current, T3_prior, T12, threshold,
            movementFromPrior, movementFromT12,
            flaggedByPrior, flaggedByT12, direction,
          }),
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
