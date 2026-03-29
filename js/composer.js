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

// ── SENTENCE LIBRARY ──────────────────────────────────────

const SENTENCE_LIBRARY = {

  SEASONAL_VARIANCE: {
    opening: (anomaly, metric, dataContext, ap) => {
      const excess    = ap.seasonalExpectation?.excessAboveSeasonal;
      const excessStr = excess ? ` — ${_pct(excess / 100)} above seasonal norms` : '';
      return `${_metricLabel(metric)} showed elevated activity in ${_monthLabel(anomaly)}, consistent with seasonal patterns for this expense category${excessStr}.`;
    },
    impact: (anomaly, metric, dataContext, ap) => {
      const dev = _deviation(ap);
      const pct = _deltaPct(ap);
      const ref = _refLabel(ap);
      return dev ? `The variance was ${dev} (${pct}) vs. ${ref}.` : '';
    },
    context: (anomaly, metric, dataContext, ap) => {
      const month = _monthLabel(anomaly);
      const hdd = dataContext?.weather?.heatingDegreeDays;
      if (hdd && hdd[month] && hdd[month] > 500) {
        return `Heating degree days in the period were elevated, consistent with higher utility and maintenance demand.`;
      }
      const cdd = dataContext?.weather?.coolingDegreeDays;
      if (cdd && cdd[month] && cdd[month] > 200) {
        return `Cooling degree days in the period were elevated, consistent with higher utility demand.`;
      }
      return '';
    },
    portfolio: (anomaly, metric, dataContext, ap) => {
      const ctx   = ap.crossPropertyBaseline?.portfolioContext;
      const count = ap.crossPropertyBaseline?.propertiesCount;
      if (ctx === 'common') return `This pattern was observed across ${count} properties in the portfolio this period.`;
      if (ctx === 'rare')   return `This pattern appeared in a small number of portfolio properties.`;
      return '';
    },
    closing: (anomaly, metric, dataContext, ap) => {
      const status = ap.recovery?.status;
      if (status === 'resolved')   return `Costs have normalized in subsequent months.`;
      if (status === 'persisting') return `The elevated level has continued into subsequent months — monitor for deviation from expected seasonal curve.`;
      return '';
    },
  },

  COST_SHOCK: {
    opening: (anomaly, metric, dataContext, ap) => {
      const cause    = ap.causalityChain?.likelyCause?.name;
      const causeStr = cause ? `, likely driven by movement in ${cause}` : '';
      return `${_metricLabel(metric)} experienced a significant cost increase in ${_monthLabel(anomaly)}${causeStr}.`;
    },
    impact: (anomaly, metric, dataContext, ap) => {
      const dev = _deviation(ap);
      const pct = _deltaPct(ap);
      const ref = _refLabel(ap);
      const noi = ap.dollarImpact?.dollarImpact?.formattedPctOfNoi;
      const noiStr = noi ? `, representing ${noi} of NOI` : '';
      return dev ? `The spike was ${dev} (${pct}) vs. ${ref}${noiStr}.` : '';
    },
    context: (anomaly, metric, dataContext, ap) => {
      const month = _monthLabel(anomaly);
      const energyCPI = dataContext?.fred?.energyCPI;
      if (energyCPI && energyCPI[month] && metric.name?.toLowerCase().includes('gas')) {
        return `Energy CPI data for the period shows elevated utility pricing in the broader market.`;
      }
      const insurancePPI = dataContext?.fred?.insurancePPI;
      if (insurancePPI && metric.name?.toLowerCase().includes('insurance')) {
        return `Insurance pricing indices were elevated during this period, consistent with industry-wide rate increases.`;
      }
      return '';
    },
    causality: (anomaly, metric, dataContext, ap) => {
      const effects = ap.causalityChain?.effects || [];
      if (effects.length > 0) {
        const names = effects.map(e => e.name).join(', ');
        return `Related movement was observed in: ${names}.`;
      }
      return '';
    },
    closing: (anomaly, metric, dataContext, ap) => {
      const status = ap.recovery?.status;
      const months = ap.recovery?.monthsToResolve;
      if (status === 'resolved')   return `Costs returned to normal levels within ${months || 'a few'} months.`;
      if (status === 'worsening')  return `The cost pressure has continued to escalate — immediate review recommended.`;
      if (status === 'persisting') return `Costs have remained elevated. Review vendor contracts or operational drivers.`;
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
    lib.opening?.(anomaly, metric, dataContext, ap),
    lib.impact?.(anomaly, metric, dataContext, ap),
    lib.context?.(anomaly, metric, dataContext, ap),
    lib.causality?.(anomaly, metric, dataContext, ap),
    lib.portfolio?.(anomaly, metric, dataContext, ap),
    lib.closing?.(anomaly, metric, dataContext, ap),
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
