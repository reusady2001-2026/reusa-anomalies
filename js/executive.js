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

function generateEANarrative(metricName, section, flag, dataContext, monthLabel, stateAbbr) {
  const { T3_current, T3_prior, T12, deviation, direction } = flag;
  const isIncome = section === 'INCOME';
  const isUp = direction === 'up' || (T3_current > T3_prior);
  const fmt = n => '$' + Math.round(Math.abs(n)).toLocaleString();

  // Pull actual data points from context
  const fred = dataContext?.fred || {};
  const weather = dataContext?.weather || {};

  const fedfunds = fred.fedfunds?.[monthLabel];
  const mortgage30 = fred.mortgage30?.[monthLabel];
  const stateUR = fred.stateUR?.[monthLabel];
  const rentCPI = fred.rentCPI?.[monthLabel];
  const energyCPI = fred.energyCPI?.[monthLabel];
  const hdd = weather.heatingDegreeDays?.[monthLabel];
  const cdd = weather.coolingDegreeDays?.[monthLabel];

  // Build data evidence sentences
  const evidence = [];

  if (stateUR != null) {
    evidence.push(`${stateAbbr} unemployment was ${stateUR.toFixed(1)}% — ${stateUR < 4 ? 'a very tight labor market supporting demand' : stateUR < 5 ? 'a healthy labor market' : 'elevated unemployment that may be pressuring demand'}`);
  }

  if (fedfunds != null && mortgage30 != null && isIncome && metricName.toLowerCase().includes('rent')) {
    evidence.push(`Fed Funds at ${fedfunds.toFixed(2)}% and 30yr mortgage at ${mortgage30.toFixed(2)}% — ${mortgage30 > 6 ? 'high financing costs keeping renters in place rather than buying' : 'moderate financing costs'}`);
  }

  if (rentCPI != null && isIncome) {
    evidence.push(`Rent CPI at ${rentCPI.toFixed(1)} nationally`);
  }

  if (energyCPI != null && !isIncome && (metricName.toLowerCase().includes('gas') || metricName.toLowerCase().includes('electric') || metricName.toLowerCase().includes('util'))) {
    evidence.push(`Energy CPI at ${energyCPI.toFixed(1)} nationally — ${isUp ? 'rising energy prices driving costs up' : 'easing energy prices'}`);
  }

  if (hdd != null && hdd > 400 && !isIncome) {
    evidence.push(`${Math.round(hdd)} heating degree days in ${stateAbbr} — cold weather driving utility and maintenance costs`);
  }

  if (cdd != null && cdd > 150 && !isIncome) {
    evidence.push(`${Math.round(cdd)} cooling degree days — summer heat driving utility demand`);
  }

  // Build the narrative
  const movementWord = isUp ? 'increased' : 'decreased';

  let narrative = `${metricName}'s annualized run rate ${movementWord} ${fmt(deviation)} vs. the prior quarter in ${monthLabel}.`;

  if (evidence.length > 0) {
    narrative += ` ${evidence.slice(0, 2).join('; ')}.`;
  }

  // Add interpretation
  if (isIncome && isUp) {
    narrative += ` This represents improving revenue performance.`;
  } else if (isIncome && !isUp) {
    narrative += ` This represents deteriorating revenue performance worth investigating.`;
  } else if (!isIncome && isUp) {
    narrative += ` Review whether this cost increase is expected or requires intervention.`;
  } else {
    narrative += ` Costs are running below the prior quarter baseline.`;
  }

  // Trim to ~75 words
  const words = narrative.split(' ');
  if (words.length > 80) {
    narrative = words.slice(0, 75).join(' ') + '…';
  }

  return narrative;
}

const Executive = { analyse, generateEANarrative };
