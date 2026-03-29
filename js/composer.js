// ============================================================
// COMPOSER.JS — Layer 2: Sentence Library + Layer 3: Composer
// Pure computation — no DOM, no fetch, no side effects.
// Assembles a narrative paragraph from an enriched anomaly profile
// and a situationProfile produced by Narrator.profile().
// ============================================================

// ── HELPERS ───────────────────────────────────────────────

function _metricLabel(metric) {
  return metric.name || 'This metric';
}

function _monthLabel(anomaly) {
  return anomaly.monthLabel || anomaly.month || 'the reported month';
}

function _fmt(num) {
  if (num == null) return '';
  const abs = Math.abs(num);
  if (abs >= 1000000) return `$${(num / 1000000).toFixed(1)}M`;
  if (abs >= 1000)    return `$${(num / 1000).toFixed(1)}K`;
  return `$${num.toFixed(0)}`;
}

function _pct(num) {
  if (num == null) return '';
  return `${num > 0 ? '+' : ''}${(num * 100).toFixed(1)}%`;
}

function _direction(ap) {
  return ap.dollarImpact?.dollarImpact?.direction === 'above' ? 'above' : 'below';
}

function _refLabel(ap) {
  return ap.dollarImpact?.referencePoint?.humanLabel || 'prior average';
}

function _deviation(ap) {
  return ap.dollarImpact?.dollarImpact?.formattedDeviation || '';
}

function _deltaPct(ap) {
  return ap.dollarImpact?.referencePoint?.formattedDeltaPct || '';
}

function _fredValue(dataContext, key, monthLabel) {
  const series = dataContext?.fred?.[key];
  if (!series || !monthLabel) return null;
  return series[monthLabel] ?? null;
}

function _weatherContext(dataContext, monthLabel) {
  const hdd  = dataContext?.weather?.heatingDegreeDays?.[monthLabel];
  const cdd  = dataContext?.weather?.coolingDegreeDays?.[monthLabel];
  const rain = dataContext?.weather?.precipitation?.[monthLabel];
  return { hdd: hdd || 0, cdd: cdd || 0, rain: rain || 0 };
}

function _coMoverNames(ap) {
  const cause   = ap?.causalityChain?.likelyCause?.name;
  const effects = (ap?.causalityChain?.effects || []).map(e => e.name);
  const all     = [...(cause ? [cause] : []), ...effects];
  return all.length > 0 ? all : null;
}

function _noiStr(ap) {
  const noi = ap?.dollarImpact?.dollarImpact?.formattedPctOfNoi;
  return noi ? `, representing ${noi} of NOI` : '';
}

// ── SENTENCE LIBRARY ──────────────────────────────────────

const SENTENCE_LIBRARY = {

  SEASONAL_VARIANCE: {
    opening: (anomaly, metric, dataContext, ap, m) => {
      const dev = _deviation(ap), pct = _deltaPct(ap), ref = _refLabel(ap);
      return `${_metricLabel(m)} was ${dev} (${pct}) vs. ${ref} in ${_monthLabel(anomaly)} — consistent with seasonal patterns for this expense category.`;
    },
    context: (anomaly, metric, dataContext, ap) => {
      const w = _weatherContext(dataContext, _monthLabel(anomaly));
      const parts = [];
      if (w.hdd > 400) parts.push(`heating degree days were ${w.hdd.toLocaleString()} — driving elevated heating and weatherization demand`);
      if (w.cdd > 150) parts.push(`cooling degree days were ${w.cdd.toLocaleString()} — consistent with elevated cooling and pool-related costs`);
      if (w.rain > 100) parts.push(`precipitation was ${w.rain}mm — above average, consistent with drainage and exterior maintenance costs`);
      return parts.length > 0 ? `Weather data supports this: ${parts.join('; ')}.` : '';
    },
    portfolio: (anomaly, metric, dataContext, ap) => {
      const ctx     = ap.crossPropertyBaseline?.portfolioContext;
      const count   = ap.crossPropertyBaseline?.propertiesCount;
      const typical = ap.crossPropertyBaseline?.typicalMonths || [];
      const MO      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const typicalStr = typical.length > 0 ? ` Historically fires in: ${typical.map(m => MO[m - 1]).filter(Boolean).join(', ')}.` : '';
      if (ctx === 'common') return `Seen across ${count} properties this period — portfolio-wide seasonal pattern.${typicalStr}`;
      if (ctx === 'rare')   return `Appeared in a small number of portfolio properties.${typicalStr}`;
      return typicalStr.trim();
    },
    closing: (anomaly, metric, dataContext, ap) => {
      const status = ap.recovery?.status;
      if (status === 'resolved')   return `Costs normalized in subsequent months — no action required.`;
      if (status === 'persisting') return `Elevated level has continued — monitor against expected seasonal curve.`;
      if (status === 'worsening')  return `Costs escalating beyond seasonal norms — review vendor contracts.`;
      return '';
    },
  },

  COST_SHOCK: {
    opening: (anomaly, metric, dataContext, ap, m) => {
      const dev = _deviation(ap), pct = _deltaPct(ap), ref = _refLabel(ap);
      const cause    = ap.causalityChain?.likelyCause?.name;
      const causeStr = cause ? `, likely triggered by movement in ${cause}` : '';
      return `${_metricLabel(m)} spiked ${dev} (${pct}) vs. ${ref} in ${_monthLabel(anomaly)}${_noiStr(ap)}${causeStr}.`;
    },
    context: (anomaly, metric, dataContext, ap, m) => {
      const month = _monthLabel(anomaly);
      const parts = [];
      const energy = _fredValue(dataContext, 'energyCPI', month);
      if (energy && m?.name?.match(/gas|electric|utility|water|sewer/i)) parts.push(`Energy CPI was ${energy.toFixed(1)} nationally`);
      const ins = _fredValue(dataContext, 'insurancePPI', month);
      if (ins && m?.name?.match(/insurance/i)) parts.push(`Insurance PPI was ${ins.toFixed(1)} — elevated rate environment`);
      const earn = _fredValue(dataContext, 'avgHourlyEarnings', month);
      if (earn && m?.section?.match(/payroll/i)) parts.push(`Average hourly earnings were $${earn.toFixed(2)} nationally — labor cost pressure`);
      if (dataContext?.fema?.length > 0) parts.push(`FEMA disaster declarations were active in the state`);
      return parts.length > 0 ? parts.join('. ') + '.' : '';
    },
    causality: (anomaly, metric, dataContext, ap) => {
      const movers = _coMoverNames(ap);
      return movers ? `Related movement in: ${movers.join(', ')}.` : '';
    },
    closing: (anomaly, metric, dataContext, ap) => {
      const status = ap.recovery?.status;
      const months = ap.recovery?.monthsToResolve;
      if (status === 'resolved')   return `Costs returned to baseline within ${months || 'a few'} months.`;
      if (status === 'worsening')  return `Cost pressure escalating — immediate review recommended.`;
      if (status === 'persisting') return `Costs remain elevated — review vendor contracts or operational drivers.`;
      return '';
    },
  },

  MARKET_PRESSURE: {
    opening: (anomaly, metric, dataContext, ap) => {
      return `${_metricLabel(metric)} moved ${_direction(ap)} expected levels in ${_monthLabel(anomaly)}, consistent with broader market conditions.`;
    },
    impact: (anomaly, metric, dataContext, ap) => {
      const dev = _deviation(ap);
      const pct = _deltaPct(ap);
      const ref = _refLabel(ap);
      return dev ? `The deviation was ${dev} (${pct}) vs. ${ref}.` : '';
    },
    context: (anomaly, metric, dataContext, ap) => {
      const fred  = dataContext?.fred;
      const month = _monthLabel(anomaly);
      const parts = [];
      if (fred?.cpi?.[month])       parts.push(`CPI was running at elevated levels`);
      if (fred?.mortgage30?.[month]) parts.push(`30-year mortgage rates were ${fred.mortgage30[month].toFixed(2)}%`);
      if (fred?.fedfunds?.[month])   parts.push(`the federal funds rate was ${fred.fedfunds[month].toFixed(2)}%`);
      if (dataContext?.fema?.length > 0) parts.push(`FEMA disaster declarations were active in the state`);
      return parts.length > 0 ? `Market context: ${parts.join('; ')}.` : '';
    },
    portfolio: (anomaly, metric, dataContext, ap) => {
      const ctx = ap.crossPropertyBaseline?.portfolioContext;
      if (ctx === 'common') return `Similar movement was observed across the portfolio, reinforcing a market-wide explanation.`;
      return '';
    },
    closing: (anomaly, metric, dataContext, ap) => {
      const status = ap.recovery?.status;
      if (status === 'resolved')   return `Conditions have since normalized.`;
      if (status === 'persisting') return `Market pressures appear ongoing. Review exposure and repricing opportunities.`;
      return '';
    },
  },

  OPERATIONAL_DRIFT: {
    opening: (anomaly, metric, dataContext, ap) => {
      const months = ap.velocity?.monthCount;
      return `${_metricLabel(metric)} has been drifting ${_direction(ap)} baseline over ${months || 'several'} months without a clear triggering event.`;
    },
    impact: (anomaly, metric, dataContext, ap) => {
      const dev = _deviation(ap);
      const pct = _deltaPct(ap);
      const ref = _refLabel(ap);
      return dev ? `Current level is ${dev} (${pct}) vs. ${ref}.` : '';
    },
    context: (anomaly, metric, dataContext, ap) => {
      return `No single causal factor has been identified. This may reflect gradual contract escalation, usage creep, or unreported operational changes.`;
    },
    closing: (anomaly, metric, dataContext, ap) => {
      const status = ap.recovery?.status;
      if (status === 'worsening')  return `The drift is accelerating. A formal review of this cost center is recommended.`;
      if (status === 'persisting') return `The elevated level has persisted. Consider benchmarking against prior-year actuals.`;
      return '';
    },
  },

  RECOVERY_STORY: {
    opening: (anomaly, metric, dataContext, ap) => {
      return `${_metricLabel(metric)} experienced an anomaly in ${_monthLabel(anomaly)} but has since shown signs of recovery.`;
    },
    impact: (anomaly, metric, dataContext, ap) => {
      const dev = _deviation(ap);
      const pct = _deltaPct(ap);
      const ref = _refLabel(ap);
      return dev ? `At its peak, the variance was ${dev} (${pct}) vs. ${ref}.` : '';
    },
    context: (anomaly, metric, dataContext, ap) => {
      const months = ap.recovery?.monthsToResolve;
      return months ? `Recovery occurred within ${months} month${months > 1 ? 's' : ''}.` : '';
    },
    closing: (anomaly, metric, dataContext, ap) => {
      return `No further action required unless the pattern recurs.`;
    },
  },

  PORTFOLIO_PATTERN: {
    opening: (anomaly, metric, dataContext, ap) => {
      const count = ap.crossPropertyBaseline?.propertiesCount;
      return `${_metricLabel(metric)} anomaly in ${_monthLabel(anomaly)} was not isolated — the same pattern appeared across ${count || 'multiple'} properties in the portfolio.`;
    },
    impact: (anomaly, metric, dataContext, ap) => {
      const dev = _deviation(ap);
      const pct = _deltaPct(ap);
      const ref = _refLabel(ap);
      return dev ? `This property's variance was ${dev} (${pct}) vs. ${ref}.` : '';
    },
    context: (anomaly, metric, dataContext, ap) => {
      const typical = ap.crossPropertyBaseline?.typicalMonths || [];
      if (typical.length > 0) {
        const MO     = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        const labels = typical.map(m => MO[m - 1]).filter(Boolean).join(', ');
        return `Historically, this pattern has appeared in: ${labels}.`;
      }
      return '';
    },
    closing: (anomaly, metric, dataContext, ap) => {
      return `Consider a portfolio-wide review of this expense category.`;
    },
  },

  ANOMALY_ALERT: {
    opening: (anomaly, metric, dataContext, ap) => {
      return `${_metricLabel(metric)} deviated significantly from expected levels in ${_monthLabel(anomaly)}.`;
    },
    impact: (anomaly, metric, dataContext, ap) => {
      const dev = _deviation(ap);
      const pct = _deltaPct(ap);
      const ref = _refLabel(ap);
      return dev ? `The variance was ${dev} (${pct}) vs. ${ref}.` : '';
    },
    context: (anomaly, metric, dataContext, ap) => {
      return `No clear causal pattern has been identified from available data.`;
    },
    closing: (anomaly, metric, dataContext, ap) => {
      const status = ap.recovery?.status;
      if (status === 'resolved')                           return `The anomaly has since resolved.`;
      if (status === 'persisting' || status === 'worsening') return `The anomaly is ongoing. Manual review recommended.`;
      return `Manual review recommended.`;
    },
  },

};

// ── COMPOSER ──────────────────────────────────────────────

function compose(anomaly, metric, dataContext, situationProfile) {
  if (!anomaly?.anomalyProfile || !situationProfile) return null;

  const ap  = anomaly.anomalyProfile;
  const angle = situationProfile.angle;
  const lib   = SENTENCE_LIBRARY[angle] || SENTENCE_LIBRARY.ANOMALY_ALERT;

  const sentences = [
    lib.opening?.(anomaly, metric, dataContext, ap, metric),
    lib.impact?.(anomaly, metric, dataContext, ap, metric),
    lib.context?.(anomaly, metric, dataContext, ap, metric),
    lib.causality?.(anomaly, metric, dataContext, ap, metric),
    lib.portfolio?.(anomaly, metric, dataContext, ap, metric),
    lib.closing?.(anomaly, metric, dataContext, ap, metric),
  ]
  .filter(s => s && s.trim().length > 0)
  .join(' ');

  return {
    angle,
    confidence: situationProfile.confidence,
    scores:     situationProfile.scores,
    narrative:  sentences,
  };
}

// ── EXPORTS ───────────────────────────────────────────────

const Composer = { compose };
