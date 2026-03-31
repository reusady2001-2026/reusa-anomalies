// ============================================================
// NARRATOR.JS — Layer 1: Narrative Angle Scorer
// Pure computation — no DOM, no fetch, no side effects.
// Takes one enriched anomaly and scores 6 dimensions to pick
// the dominant narrative angle.
// ============================================================

const Narrator = (() => {

  // ── SIGNAL SCORING ────────────────────────────────────────

  function _scoreSeverity(ap) {
    const di  = ap.dollarImpact?.dollarImpact;
    const abs = di?.absDeviation ?? 0;
    const pct = di?.pctOfNoi     ?? 0;
    if (abs >= 5000 || pct >= 0.05) return 3;
    if (abs >= 1000 || pct >= 0.02) return 2;
    if (abs >= 300)                 return 1;
    return 0;
  }

  function _scorePersistence(ap) {
    const status = ap.recovery?.status;
    const vType  = ap.velocity?.type;
    if (status === 'worsening')                              return 3;
    if (status === 'persisting')                             return 2;
    if (status === 'resolved' && vType === 'sustained')      return 1;
    return 0;
  }

  function _scoreCausality(ap) {
    const cc      = ap.causalityChain;
    const hasCause  = cc?.likelyCause !== null && cc?.likelyCause !== undefined;
    const hasEffect = Array.isArray(cc?.effects) && cc.effects.length > 0;
    if (hasCause && hasEffect) return 3;
    if (hasCause)              return 2;
    if (hasEffect)             return 1;
    return 0;
  }

  function _scoreMarket(ap, metric, dataContext) {
    let score = 0;

    if (ap.seasonalExpectation?.isSeasonalMonth === true) score += 2;

    if (Array.isArray(dataContext?.fema) && dataContext.fema.length > 0) score += 1;

    // Utility/energy category check
    const sec  = (metric?.section || '').toLowerCase();
    const name = (metric?.name    || '').toLowerCase();
    const isUtility = sec.includes('utility') || sec.includes('electric') || sec.includes('gas') ||
                      name.includes('gas')     || name.includes('electric') || name.includes('utility') ||
                      name.includes('water')   || name.includes('sewer');
    if (isUtility) {
      const energyCPI = dataContext?.fred?.energyCPI;
      if (energyCPI && Object.keys(energyCPI).length > 0) score += 1;
    }

    // Insurance category
    const isInsurance = name.includes('insurance');
    if (isInsurance) {
      const insurancePPI = dataContext?.fred?.insurancePPI;
      if (insurancePPI && Object.keys(insurancePPI).length > 0) score += 1;
    }

    // Payroll/labor category
    const isPayroll = sec.includes('payroll') ||
                      name.includes('payroll') || name.includes('labor') || name.includes('salary');
    if (isPayroll) {
      const avgHourlyEarnings = dataContext?.fred?.avgHourlyEarnings;
      if (avgHourlyEarnings && Object.keys(avgHourlyEarnings).length > 0) score += 1;
    }

    return Math.min(score, 3);
  }

  function _scorePortfolio(ap) {
    if (ap.crossPropertyBaseline?.propertiesCount <= 1) return 0;
    const cpb = ap.crossPropertyBaseline;
    if (cpb?.portfolioContext === 'common')                                       return 3;
    if (cpb?.portfolioContext === 'rare')                                         return 2;
    if (cpb?.portfolioContext === 'isolated' && cpb?.timesSeenAcrossPortfolio > 0) return 1;
    return 0;
  }

  function _scoreTrend(ap) {
    const detected = ap.reversalTiming?.detected === true;
    const vType    = ap.velocity?.type;
    if (detected && vType === 'sudden') return 3;
    if (detected)                       return 2;
    if (vType === 'drift')              return 1;
    return 0;
  }

  // ── ANGLE SELECTION ───────────────────────────────────────

  function _pickAngle(scores, ap, metric) {
    if (scores.market >= 2 && ap.seasonalExpectation?.isSeasonalMonth)
      return 'SEASONAL_VARIANCE';

    if (scores.trend >= 2 && ap.recovery?.status === 'resolved')
      return 'RECOVERY_STORY';

    if (scores.portfolio >= 2)
      return 'PORTFOLIO_PATTERN';

    if (scores.market >= 2 && scores.causality <= 1)
      return 'MARKET_PRESSURE';

    if (scores.severity >= 2 && scores.causality >= 2)
      return 'COST_SHOCK';

    if (scores.persistence >= 2 && scores.causality <= 1)
      return 'OPERATIONAL_DRIFT';

    return 'ANOMALY_ALERT';
  }

  // ── BLOCKED ANGLES ────────────────────────────────────────

  function getBlockedAngles(scores, ap, metric) {
    const blocked = [];
    // Never use PORTFOLIO_PATTERN if only 1 or fewer properties
    if ((ap.crossPropertyBaseline?.propertiesCount || 0) <= 1) {
      blocked.push('PORTFOLIO_PATTERN');
    }
    // Never use SEASONAL_VARIANCE if isSeasonalMonth is false
    if (!ap.seasonalExpectation?.isSeasonalMonth) {
      blocked.push('SEASONAL_VARIANCE');
    }
    // Never use RECOVERY_STORY if recovery status is not resolved
    if (ap.recovery?.status !== 'resolved') {
      blocked.push('RECOVERY_STORY');
    }

    const metricName = (metric?.name || '').toLowerCase();

    const isEventDriven = /inspection|permit|legal|court|license|fee|registr|certif|violation|fine|application/.test(metricName);
    const isOneTime = /inspection|permit|court|violation|fine/.test(metricName);

    if (isEventDriven || isOneTime) {
      blocked.push('MARKET_PRESSURE');
    }

    if (isOneTime) {
      blocked.push('SEASONAL_VARIANCE');
    }

    return blocked;
  }

  // ── CONFIDENCE ────────────────────────────────────────────

  function _calcConfidence(scores) {
    const total = Object.values(scores).reduce((a, b) => a + b, 0);
    const ratio = total / 18; // 6 dimensions × 3 max
    if (ratio >= 0.5)  return 'high';
    if (ratio >= 0.25) return 'medium';
    return 'low';
  }

  // ── PUBLIC API ────────────────────────────────────────────

  function profile(anomaly, metric, dataContext) {
    const ap = anomaly?.anomalyProfile;
    if (!ap) return null;

    const scores = {
      severity:    _scoreSeverity(ap),
      persistence: _scorePersistence(ap),
      causality:   _scoreCausality(ap),
      market:      _scoreMarket(ap, metric, dataContext),
      portfolio:   _scorePortfolio(ap),
      trend:       _scoreTrend(ap),
    };

    const angle         = _pickAngle(scores, ap, metric);
    const confidence    = _calcConfidence(scores);
    const dominantScore = Math.max(...Object.values(scores));

    // Score each angle against the dimension scores
    const ANGLE_AFFINITY = {
      SEASONAL_VARIANCE:  ['market', 'portfolio', 'trend'],
      RECOVERY_STORY:     ['trend', 'persistence', 'causality'],
      PORTFOLIO_PATTERN:  ['portfolio', 'market', 'severity'],
      MARKET_PRESSURE:    ['market', 'severity', 'portfolio'],
      COST_SHOCK:         ['severity', 'causality', 'persistence'],
      OPERATIONAL_DRIFT:  ['persistence', 'severity', 'trend'],
      ANOMALY_ALERT:      ['severity', 'trend', 'market'],
    };

    const rankedAngles = Object.entries(ANGLE_AFFINITY)
      .map(([a, dims]) => ({
        angle: a,
        score: dims.reduce((sum, d) => sum + (scores[d] || 0), 0),
      }))
      .sort((a, b) => b.score - a.score)
      .map(e => e.angle);

    // Ensure dominant angle is always first
    const dedupedRanked = [angle, ...rankedAngles.filter(a => a !== angle)];

    const blocked = getBlockedAngles(scores, ap, metric);
    const filteredRanked = dedupedRanked.filter(a => !blocked.includes(a));
    // If dominant angle itself is blocked, use next available
    const finalAngle = blocked.includes(angle)
      ? (filteredRanked[0] || 'ANOMALY_ALERT')
      : angle;

    return {
      angle: finalAngle,
      scores,
      dominantScore,
      confidence,
      rankedAngles: filteredRanked,
    };
  }

  return { profile };

})();
