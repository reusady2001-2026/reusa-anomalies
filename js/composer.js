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
  return noi ? `, representing ${noi}` : '';
}

function _yoyPct(dataContext, key, monthLabel, allMonths) {
  const series = dataContext?.fred?.[key];
  if (!series || !monthLabel || !allMonths) return null;
  const idx = allMonths.indexOf(monthLabel);
  if (idx < 12) return null;
  const priorLabel = allMonths[idx - 12];
  const current = series[monthLabel];
  const prior = series[priorLabel];
  if (current == null || prior == null || prior === 0) return null;
  const change = ((current - prior) / Math.abs(prior)) * 100;
  return `${change > 0 ? '+' : ''}${change.toFixed(1)}%`;
}

// ── SENTENCE LIBRARY ──────────────────────────────────────

const SENTENCE_LIBRARY = {

  SEASONAL_VARIANCE: {
    opening: (anomaly, metric, dataContext, ap, m) => {
      const dev = _deviation(ap), ref = _refLabel(ap);
      return `${_metricLabel(m)} was ${dev} vs. ${ref} in ${_monthLabel(anomaly)} — consistent with seasonal patterns for this expense category.`;
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
      const dev = _deviation(ap), ref = _refLabel(ap);
      const cause    = ap.causalityChain?.likelyCause?.name;
      const causeStr = cause ? `, likely triggered by movement in ${cause}` : '';
      return `${_metricLabel(m)} spiked ${dev} vs. ${ref} in ${_monthLabel(anomaly)}${_noiStr(ap)}${causeStr}.`;
    },
    context: (anomaly, metric, dataContext, ap, m) => {
      const isIncome = (m?.section || '').toUpperCase() === 'INCOME';
      if (dataContext?.fema?.length > 0 && isIncome) return ''; // FEMA doesn't explain income
      const month = _monthLabel(anomaly);
      const parts = [];
      const energyYoy = _yoyPct(dataContext, 'energyCPI', month, anomaly.allMonths || []);
      if (energyYoy && m?.name?.match(/gas|electric|utility|water|sewer/i)) parts.push(`Energy CPI ${energyYoy} YoY nationally`);
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
    opening: (anomaly, metric, dataContext, ap, m) => {
      const dev = _deviation(ap), ref = _refLabel(ap);
      return `${_metricLabel(m)} was ${dev} vs. ${ref} in ${_monthLabel(anomaly)} — movement consistent with broader market conditions rather than a property-specific event.`;
    },
    context: (anomaly, metric, dataContext, ap) => {
      const month = _monthLabel(anomaly);
      const parts = [];
      const ff = _fredValue(dataContext, 'fedfunds', month);
      if (ff != null) parts.push(`Fed Funds Rate ${ff.toFixed(2)}%`);
      const m30 = _fredValue(dataContext, 'mortgage30', month);
      if (m30 != null) parts.push(`30yr Mortgage ${m30.toFixed(2)}%`);
      const cpiYoy = _yoyPct(dataContext, 'cpi', month, anomaly.allMonths || []);
      if (cpiYoy != null) parts.push(`CPI ${cpiYoy} YoY`);
      const rentYoy = _yoyPct(dataContext, 'rentCPI', month, anomaly.allMonths || []);
      if (rentYoy != null) parts.push(`Rent CPI ${rentYoy} YoY`);
      const ur = _fredValue(dataContext, 'stateUR', month);
      if (ur != null) parts.push(`State unemployment ${ur.toFixed(1)}%`);
      if (dataContext?.fema?.length > 0) parts.push(`FEMA declarations active in state`);
      return parts.length > 0 ? `Market indicators for ${month}: ${parts.join(' · ')}.` : '';
    },
    portfolio: (anomaly, metric, dataContext, ap) => {
      const ctx = ap.crossPropertyBaseline?.portfolioContext;
      const count = ap.crossPropertyBaseline?.propertiesCount;
      if (ctx === 'common') return `Pattern observed across ${count} properties — reinforces market-wide explanation.`;
      return '';
    },
    closing: (anomaly, metric, dataContext, ap) => {
      const status = ap.recovery?.status;
      if (status === 'resolved')   return `Conditions have since normalized.`;
      if (status === 'persisting') return `Market pressures appear ongoing — review exposure and repricing opportunities.`;
      return '';
    },
  },

  OPERATIONAL_DRIFT: {
    opening: (anomaly, metric, dataContext, ap, m) => {
      const months = ap.velocity?.monthCount;
      const dev = _deviation(ap), ref = _refLabel(ap);
      return `${_metricLabel(m)} has drifted ${_direction(ap)} baseline over ${months || 'several'} months — currently ${dev} vs. ${ref} in ${_monthLabel(anomaly)}.`;
    },
    context: () => `No single triggering event identified. Likely reflects gradual contract escalation, usage creep, or unreported operational changes.`,
    closing: (anomaly, metric, dataContext, ap) => {
      const status = ap.recovery?.status;
      if (status === 'worsening')  return `Drift is accelerating — formal review of this cost center recommended.`;
      if (status === 'persisting') return `Elevated level has persisted — benchmark against prior-year actuals.`;
      return '';
    },
  },

  RECOVERY_STORY: {
    opening: (anomaly, metric, dataContext, ap, m) => {
      const dev = _deviation(ap), ref = _refLabel(ap);
      const months = ap.recovery?.monthsToResolve;
      return `${_metricLabel(m)} peaked at ${dev} vs. ${ref} in ${_monthLabel(anomaly)} but recovered within ${months || 'a few'} month${months !== 1 ? 's' : ''}.`;
    },
    context: (anomaly, metric, dataContext, ap) => {
      const cause = ap.causalityChain?.likelyCause?.name;
      return cause ? `Movement in ${cause} appears to have been the primary driver.` : '';
    },
    closing: () => `No further action required unless the pattern recurs.`,
  },

  PORTFOLIO_PATTERN: {
    opening: (anomaly, metric, dataContext, ap, m) => {
      const dev = _deviation(ap), ref = _refLabel(ap);
      const count = ap.crossPropertyBaseline?.propertiesCount;
      return `${_metricLabel(m)} was ${dev} vs. ${ref} in ${_monthLabel(anomaly)} — same pattern observed across ${count || 'multiple'} portfolio properties, suggesting a shared driver.`;
    },
    context: (anomaly, metric, dataContext, ap) => {
      const typical = ap.crossPropertyBaseline?.typicalMonths || [];
      const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      if (typical.length > 0) return `Historically appears in: ${typical.map(m => MO[m - 1]).filter(Boolean).join(', ')}.`;
      return '';
    },
    closing: () => `Consider a portfolio-wide review of this expense category.`,
  },

  ANOMALY_ALERT: {
    opening: (anomaly, metric, dataContext, ap, m) => {
      const dev = _deviation(ap), ref = _refLabel(ap);
      return `${_metricLabel(m)} deviated ${dev} vs. ${ref} in ${_monthLabel(anomaly)}${_noiStr(ap)}.`;
    },
    closing: (anomaly, metric, dataContext, ap) => {
      const status = ap.recovery?.status;
      if (status === 'resolved')   return `The anomaly has since resolved.`;
      if (status === 'worsening')  return `Deviation is growing — escalate for review.`;
      if (status === 'persisting') return `Anomaly is ongoing — manual review recommended.`;
      return '';
    },
  },

};

// ── COMPOSER ──────────────────────────────────────────────

function compose(anomaly, metric, dataContext, situationProfile, angleOverride) {
  if (!anomaly?.anomalyProfile || !situationProfile) return null;

  const ap  = anomaly.anomalyProfile;
  const angle = angleOverride || situationProfile.angle;
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

  if (angleOverride && sentences.length > 0) {
    const frames = {
      SEASONAL_VARIANCE:  'Alternatively, seasonal patterns may explain this:',
      COST_SHOCK:         'Another explanation — a discrete cost shock:',
      MARKET_PRESSURE:    'Alternatively, broader market conditions may be the driver:',
      OPERATIONAL_DRIFT:  'Alternatively, this may reflect operational drift:',
      RECOVERY_STORY:     'Alternatively, this may be a recovery pattern:',
      PORTFOLIO_PATTERN:  'Alternatively, this matches a portfolio-wide pattern:',
      ANOMALY_ALERT:      'Alternatively, no clear pattern has been identified:',
    };
    const frame = frames[angleOverride] || 'Alternatively:';
    return { angle, confidence: situationProfile.confidence, scores: situationProfile.scores, narrative: `${frame} ${sentences}` };
  }

  return {
    angle,
    confidence: situationProfile.confidence,
    scores:     situationProfile.scores,
    narrative:  sentences,
  };
}

// ── EXPORTS ───────────────────────────────────────────────

const Composer = { compose };
