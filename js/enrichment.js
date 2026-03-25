// ============================================================
// ENRICHMENT.JS — Post-rule enrichment with real-world data
// Adds context to rule-engine output without touching detection
// ============================================================

const Enrichment = (() => {

  const MO = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  // ── MONTH UTILITIES ───────────────────────────────────

  function parseLabel(label) {
    if (!label) return null;
    const p = String(label).split(' ');
    const m = MO.indexOf(p[0]);
    const y = parseInt(p[1]);
    if (m < 0 || isNaN(y)) return null;
    return { month: m, year: y, quarter: Math.floor(m / 3) + 1 };
  }

  function prevLabel(label) {
    const p = parseLabel(label);
    if (!p) return null;
    let { month, year } = p;
    month--;
    if (month < 0) { month = 11; year--; }
    return `${MO[month]} ${year}`;
  }

  function yrAgoLabel(label) {
    const p = parseLabel(label);
    if (!p) return null;
    return `${MO[p.month]} ${p.year - 1}`;
  }

  function safeGet(map, key) {
    if (!map || !key) return null;
    const v = map[key];
    return (v == null || isNaN(v)) ? null : v;
  }

  // ── BUILD MONTH SNAPSHOT ──────────────────────────────
  /**
   * Extracts all relevant data points for a single month label
   * from the full data context.
   */
  function monthSnapshot(ctx, label) {
    if (!ctx || !label) return { label };
    const fred = ctx.fred || {};
    const p    = parseLabel(label);
    if (!p) return { label };

    const { month, year, quarter } = p;

    // Federal Funds Rate
    const fedfunds     = safeGet(fred.fedfunds,     label);
    // DEBUG: show label vs what keys exist in the FRED map
    console.log('[DEBUG monthSnapshot] label:', JSON.stringify(label),
      '| fedfunds map size:', Object.keys(fred.fedfunds || {}).length,
      '| sample keys:', Object.keys(fred.fedfunds || {}).slice(0,3),
      '| direct hit:', (fred.fedfunds || {})[label],
      '| cpi map size:', Object.keys(fred.cpi || {}).length);
    const fedfundsPrev = safeGet(fred.fedfunds,     prevLabel(label));
    const fedChangeBps = (fedfunds != null && fedfundsPrev != null)
      ? Math.round((fedfunds - fedfundsPrev) * 100) : null;

    // CPI YoY
    const cpiNow   = safeGet(fred.cpi, label);
    const cpiYrAgo = safeGet(fred.cpi, yrAgoLabel(label));
    const cpiYoY   = (cpiNow != null && cpiYrAgo != null && cpiYrAgo !== 0)
      ? ((cpiNow - cpiYrAgo) / Math.abs(cpiYrAgo)) * 100 : null;

    // Rent CPI YoY
    const rentNow   = safeGet(fred.rentCPI, label);
    const rentYrAgo = safeGet(fred.rentCPI, yrAgoLabel(label));
    const rentYoY   = (rentNow != null && rentYrAgo != null && rentYrAgo !== 0)
      ? ((rentNow - rentYrAgo) / Math.abs(rentYrAgo)) * 100 : null;

    // State unemployment
    const stateUR   = safeGet(fred.stateUR, label);

    // 30yr mortgage
    const mortgage30 = safeGet(fred.mortgage30, label);

    // Housing starts
    const housingStarts = safeGet(fred.housingStarts, label);

    // FEMA: disasters in same quarter
    const qStart = new Date(year, (quarter - 1) * 3, 1);
    const qEnd   = new Date(year, quarter * 3, 0);
    const thisMonthStart = new Date(year, month, 1);
    const threeMonthsAgo = new Date(year, month - 3, 1);

    const femaQuarter = (ctx.fema || []).filter(d => {
      const dt = new Date(d.date + 'T00:00:00');
      return dt >= qStart && dt <= qEnd;
    });
    const femaRecent = (ctx.fema || []).filter(d => {
      const dt = new Date(d.date + 'T00:00:00');
      return dt >= threeMonthsAgo && dt <= thisMonthStart;
    });

    // Legislation in the same year
    const billsYear = (ctx.congress || []).filter(b =>
      (b.introduced || '').startsWith(String(year)));
    const stateBillsYear = (ctx.openStates || []).filter(b =>
      (b.introduced || '').startsWith(String(year)));

    return {
      label, month, year, quarter,
      fedfunds, fedfundsPrev, fedChangeBps,
      cpiYoY, cpiNow,
      rentYoY,
      stateUR, mortgage30, housingStarts,
      femaQuarter, femaRecent,
      billsYear, stateBillsYear,
    };
  }

  // ── ENRICHMENT TEXT BUILDER ───────────────────────────

  function sign(n) { return n >= 0 ? '+' : ''; }
  function pct(n)  { return `${sign(n)}${n.toFixed(1)}%`; }
  function bps(n)  { return `${Math.abs(n)}bps`; }

  function buildEnrichedPrimary(result, snap, ctx) {
    const base = result.primary?.label || '';
    const city = ctx?.city || '';
    const st   = ctx?.stateAbbr || '';
    const loc  = [city, st].filter(Boolean).join(', ');
    const category = result.primary?.category || result.firedRuleIds?.[0] || '';

    // Header: original label + location + period
    let text = loc
      ? `${base} — ${loc} (${snap.label}).`
      : `${base} (${snap.label}).`;

    const bullets = [];

    // ── CPI context ──
    if (snap.cpiYoY != null) {
      if (snap.cpiYoY > 5)
        bullets.push(`National CPI running at ${pct(snap.cpiYoY)} YoY — elevated inflation likely amplifying cost pressures.`);
      else if (snap.cpiYoY > 2.5 && result.section === 'EXPENSES')
        bullets.push(`National CPI at ${pct(snap.cpiYoY)} YoY — moderate inflationary headwinds for operating costs.`);
      else if (snap.cpiYoY < 1.5 && result.section === 'EXPENSES')
        bullets.push(`Note: National CPI was only ${pct(snap.cpiYoY)} YoY — inflation alone unlikely to explain this expense spike.`);
    }

    // ── Fed funds rate change ──
    if (snap.fedChangeBps != null && Math.abs(snap.fedChangeBps) >= 25) {
      const dir = snap.fedChangeBps > 0 ? 'raised' : 'cut';
      bullets.push(`The Fed ${dir} rates ${bps(snap.fedChangeBps)} to ${snap.fedfunds?.toFixed(2) ?? '?'}% in ${snap.label}, ${snap.fedChangeBps > 0 ? 'increasing financing costs' : 'easing financing costs'} across the market.`);
    } else if (snap.fedfunds != null && snap.fedfunds > 5.0) {
      bullets.push(`Rates were elevated at ${snap.fedfunds.toFixed(2)}% (FEDFUNDS) in this period — a meaningful drag on leveraged assets.`);
    }

    // ── Rent CPI (income anomalies) ──
    if (snap.rentYoY != null && result.section === 'INCOME') {
      if (snap.rentYoY > 4)
        bullets.push(`Rent CPI running nationally at ${pct(snap.rentYoY)} YoY — market-wide achievable rents were rising, making a shortfall asset-specific.`);
      else if (snap.rentYoY < 0)
        bullets.push(`Rent CPI nationally at ${pct(snap.rentYoY)} YoY — softening rental market may have contributed to income pressure.`);
    }

    // ── State unemployment ──
    if (snap.stateUR != null) {
      if (snap.stateUR < 3.5)
        bullets.push(`${ctx?.stateName || st} unemployment at ${snap.stateUR.toFixed(1)}% — very tight labor market suggests strong demand backdrop; shortfall is likely asset-specific.`);
      else if (snap.stateUR < 5.5)
        bullets.push(`${ctx?.stateName || st} unemployment at ${snap.stateUR.toFixed(1)}% — healthy demand environment.`);
      else
        bullets.push(`${ctx?.stateName || st} unemployment elevated at ${snap.stateUR.toFixed(1)}% in this period — weak labour market may be suppressing demand and rent levels.`);
    }

    // ── FEMA disasters ──
    if (snap.femaRecent && snap.femaRecent.length > 0) {
      const d = snap.femaRecent[0];
      bullets.push(`FEMA ${d.type || 'disaster'} declaration in ${st} (${d.date}) preceding this period — potential tenant disruption, lease delays, or insurance claim flow.`);
    } else if (snap.femaQuarter && snap.femaQuarter.length > 0) {
      const d = snap.femaQuarter[0];
      bullets.push(`FEMA ${d.type || 'disaster'} declaration in ${st} (${d.date}) within the same quarter — possible impact on operations or demand.`);
    }

    // ── State legislation ──
    if (snap.stateBillsYear && snap.stateBillsYear.length > 0) {
      const b = snap.stateBillsYear[0];
      const extra = snap.stateBillsYear.length > 1 ? ` (+${snap.stateBillsYear.length - 1} more)` : '';
      bullets.push(`Active state legislation in ${ctx?.stateName || st} (${snap.year}): "${b.title.slice(0, 80)}"${extra} — potential compliance or regulatory cost impact.`);
    } else if (snap.billsYear && snap.billsYear.length > 0 &&
               (category.includes('POL') || category.includes('political') || result.section === 'EXPENSES')) {
      const b = snap.billsYear[0];
      bullets.push(`Federal legislation in period: ${b.number} — "${b.title.slice(0, 70)}" (introduced ${b.introduced}).`);
    } else if (ctx && !snap.stateBillsYear?.length && !snap.billsYear?.length) {
      if (category.includes('POL') || category.includes('political'))
        bullets.push(`No active federal or state housing legislation identified in ${snap.year} for this location.`);
    }

    // ── Mortgage rate for residential ──
    if (snap.mortgage30 != null && /residential|multifamily|apartment/i.test(ctx?.assetType || '') ||
        snap.mortgage30 > 6.5) {
      bullets.push(`30-year mortgage rate at ${snap.mortgage30.toFixed(2)}% — ${snap.mortgage30 > 6.5 ? 'elevated rates constraining purchase demand, supporting rentals' : 'mortgage market context'}.`);
    }

    if (bullets.length > 0) text += ' ' + bullets.join(' ');
    return text;
  }

  function buildEnrichedAlternatives(result, snap, ctx) {
    const alts = result.alternatives || [];
    return alts.map((alt, i) => {
      if (i === 0 && snap.stateUR != null)
        return `${alt} (${ctx?.stateName || ctx?.stateAbbr || ''} unemployment: ${snap.stateUR.toFixed(1)}% in ${snap.label})`;
      if (i === 1 && snap.cpiYoY != null && Math.abs(snap.cpiYoY) > 2)
        return `${alt} — CPI ${pct(snap.cpiYoY)} YoY backdrop`;
      if (i === 2 && snap.femaQuarter?.length > 0)
        return `${alt} — FEMA ${snap.femaQuarter[0].type} declaration in state (${snap.femaQuarter[0].date})`;
      return alt;
    });
  }

  // ── 5-SIGNAL EVIDENCE PROFILE ─────────────────────────

  const CATEGORY_TIER = {
    asset_type: 1, location: 2, seasonality: 3, political: 3, operational: 4, market: 5,
  };

  /** Signal 1 — Anomaly Strength (Z-score magnitude) */
  function signal1_AnomalyStrength(result /*, candidate */) {
    const z = Math.abs(result.effectiveZ || 0);
    if (z >= 3.0) return {
      score: 1, icon: '✅', name: 'Anomaly Strength',
      value: `|Z| = ${z.toFixed(2)}`,
      explanation: 'Extreme anomaly (|Z| ≥ 3.0) — strong statistical signal',
    };
    return {
      score: 0, icon: '➖', name: 'Anomaly Strength',
      value: `|Z| = ${z.toFixed(2)}`,
      explanation: 'Moderate anomaly (2 ≤ |Z| < 3.0) — confirmed but not extreme',
    };
  }

  /** Signal 2 — Rule Specificity (category tier) */
  function signal2_RuleSpecificity(_result, candidate) {
    const rule = candidate.rule;
    if (!rule || !rule.category) return {
      score: 0, icon: '➖', name: 'Rule Specificity',
      value: 'Unknown', explanation: 'No rule metadata available for this candidate',
    };
    const tier = CATEGORY_TIER[rule.category] ?? 99;
    const catLabel = rule.category.replace(/_/g, ' ');
    if (tier <= 3) return {
      score: 1, icon: '✅', name: 'Rule Specificity',
      value: catLabel, explanation: `Tier ${tier} rule (${catLabel}) — highly specific explanation`,
    };
    if (tier === 4) return {
      score: 0, icon: '➖', name: 'Rule Specificity',
      value: catLabel, explanation: 'Tier 4 rule (operational) — moderately specific',
    };
    return {
      score: 0, icon: '➖', name: 'Rule Specificity',
      value: catLabel, explanation: 'Tier 5 rule (market-wide) — least specific category',
    };
  }

  /** Signal 3 — Peer Corroboration (peerCount vs candidate type) */
  function signal3_PeerCorroboration(result, candidate) {
    const peerCount = result.peerCount || 0;
    const rule = candidate.rule;
    if (!rule) return {
      score: 0, icon: '➖', name: 'Peer Corroboration',
      value: `${peerCount} peers`, explanation: 'No rule metadata to interpret peer pattern',
    };
    const isMarket = rule.category === 'market';
    if (isMarket) {
      if (peerCount >= 3) return {
        score: 1, icon: '✅', name: 'Peer Corroboration',
        value: `${peerCount} peers`,
        explanation: `${peerCount} peer metrics show same pattern — consistent with market-wide signal`,
      };
      if (peerCount > 0) return {
        score: 0, icon: '➖', name: 'Peer Corroboration',
        value: `${peerCount} peers`,
        explanation: `Only ${peerCount} peer(s) — insufficient for strong market signal`,
      };
      return {
        score: -1, icon: '❌', name: 'Peer Corroboration',
        value: 'No peers', explanation: 'No peer corroboration — contradicts market-wide explanation',
      };
    } else {
      if (peerCount === 0) return {
        score: 1, icon: '✅', name: 'Peer Corroboration',
        value: 'Isolated', explanation: 'No peer metrics show same pattern — consistent with asset-specific cause',
      };
      if (peerCount >= 3) return {
        score: -1, icon: '❌', name: 'Peer Corroboration',
        value: `${peerCount} peers`,
        explanation: `${peerCount} peers show same pattern — suggests market-wide, not asset-specific cause`,
      };
      return {
        score: 0, icon: '➖', name: 'Peer Corroboration',
        value: `${peerCount} peers`, explanation: `${peerCount} peer(s) — ambiguous pattern`,
      };
    }
  }

  /** Signal 4 — Persistence (anomalyCount + label keywords) */
  function signal4_Persistence(result, candidate) {
    const anomalyCount = result.anomalyCount || 1;
    const label = (candidate.rule?.label || candidate.label || '').toLowerCase();
    const hasStructural = /structural|recurring|pattern|seasonal|chronic|systemic|long.?term/.test(label);

    if (anomalyCount >= 3 || hasStructural) {
      const reason = anomalyCount >= 3
        ? `${anomalyCount} anomalies detected — recurring pattern supports structural explanation`
        : 'Label indicates a structural or recurring pattern';
      return { score: 1, icon: '✅', name: 'Persistence', value: `${anomalyCount} anomaly${anomalyCount !== 1 ? 's' : ''}`, explanation: reason };
    }
    return {
      score: 0, icon: '➖', name: 'Persistence',
      value: `${anomalyCount} anomaly${anomalyCount !== 1 ? 's' : ''}`,
      explanation: `${anomalyCount} occurrence(s) — insufficient pattern to distinguish structural vs one-off`,
    };
  }

  /** Signal 5 — External Data Direction (CPI/Fed/FEMA/StateUR/Legislation alignment) */
  function signal5_ExternalData(result, candidate, snap) {
    const hasAnyData = snap && (snap.cpiYoY != null || snap.fedfunds != null || snap.stateUR != null ||
      (snap.femaRecent?.length || 0) > 0 || (snap.femaQuarter?.length || 0) > 0 ||
      (snap.stateBillsYear?.length || 0) > 0 || (snap.billsYear?.length || 0) > 0);

    if (!hasAnyData) {
      console.log('[DEBUG signal5] hasAnyData=false — snap keys:', Object.keys(snap),
        '| snap.fedfunds:', snap.fedfunds, '| snap.cpiYoY:', snap.cpiYoY,
        '| snap.stateUR:', snap.stateUR, '| full snap:', JSON.stringify(snap));
      return {
        score: 0, icon: '➖', name: 'External Data',
        value: 'No data loaded', explanation: 'No real-world data available for this location/period',
      };
    }

    const rule     = candidate.rule;
    const label    = (rule?.label || candidate.label || '').toLowerCase();
    const category = rule?.category || '';
    const section  = result.section;
    const pnl      = result.pnl;

    let score = 0;
    const evidenceItems = [];

    // CPI alignment
    if (snap.cpiYoY != null) {
      if (section === 'EXPENSES' && pnl === 'loss') {
        if (snap.cpiYoY > 4)  { score += 1; evidenceItems.push(`CPI ${snap.cpiYoY.toFixed(1)}% YoY↑`); }
        else if (snap.cpiYoY < 1.5) { score -= 1; evidenceItems.push(`CPI ${snap.cpiYoY.toFixed(1)}% YoY (low)`); }
      }
    }

    // Fed rate change
    if (snap.fedChangeBps != null && Math.abs(snap.fedChangeBps) >= 50) {
      if (section === 'EXPENSES' && snap.fedChangeBps > 0) { score += 1; evidenceItems.push(`Fed +${snap.fedChangeBps}bps`); }
      else if (section === 'INCOME' && pnl === 'loss' && snap.fedChangeBps > 0) { score += 1; evidenceItems.push(`Fed +${snap.fedChangeBps}bps`); }
    }

    // Rent CPI for income
    if (snap.rentYoY != null && section === 'INCOME') {
      if (pnl === 'loss' && snap.rentYoY < 0)  { score += 1; evidenceItems.push(`Rent CPI ${snap.rentYoY.toFixed(1)}%↓`); }
      if (pnl === 'profit' && snap.rentYoY > 4) { score += 1; evidenceItems.push(`Rent CPI +${snap.rentYoY.toFixed(1)}%↑`); }
      if (pnl === 'loss' && snap.rentYoY > 4)  { score -= 1; evidenceItems.push(`Rent CPI +${snap.rentYoY.toFixed(1)}%↑ (contradicts income loss)`); }
    }

    // State unemployment
    if (snap.stateUR != null && section === 'INCOME') {
      if (pnl === 'loss' && snap.stateUR > 6)   { score += 1; evidenceItems.push(`UR ${snap.stateUR.toFixed(1)}%↑`); }
      if (pnl === 'loss' && snap.stateUR < 3.5) { score -= 1; evidenceItems.push(`UR ${snap.stateUR.toFixed(1)}% (very low, contradicts demand weakness)`); }
    }

    // FEMA disaster
    const hasFema = (snap.femaRecent?.length || 0) + (snap.femaQuarter?.length || 0) > 0;
    if (hasFema && section === 'INCOME' && pnl === 'loss') { score += 1; evidenceItems.push('FEMA declaration'); }

    // Legislation
    const hasLeg = (snap.stateBillsYear?.length || 0) + (snap.billsYear?.length || 0) > 0;
    if (hasLeg && (category === 'political' || /regulatory|compliance|legislat/.test(label))) {
      score += 1; evidenceItems.push('Active legislation');
    }

    // Clamp to [-1, +1]
    score = Math.max(-1, Math.min(1, score));

    const icon    = score > 0 ? '✅' : score < 0 ? '❌' : '➖';
    const valStr  = evidenceItems.length > 0 ? evidenceItems.join(', ') : 'Available but neutral';
    const expStr  = score > 0 ? 'External data direction supports this explanation'
                  : score < 0 ? 'External data direction contradicts this explanation'
                  : 'External data does not strongly support or contradict';

    return { score, icon, name: 'External Data', value: valStr, explanation: expStr };
  }

  /** Score one rule as a candidate against this anomaly result + snap. */
  function _scoreCandidate(result, rule, snap) {
    const c = { rule, label: rule.label };
    const signals = [
      signal1_AnomalyStrength(result, c),
      signal2_RuleSpecificity(result, c),
      signal3_PeerCorroboration(result, c),
      signal4_Persistence(result, c),
      signal5_ExternalData(result, c, snap),
    ];
    const rawScore    = signals.reduce((sum, s) => sum + s.score, 0);
    const signalCount = signals.filter(s => s.score > 0).length;
    return { rule, label: rule.label, signals, rawScore, signalCount };
  }

  /** Sort scored candidates: rawScore desc → signalCount desc → category tier asc. */
  function _evidenceSort(scored) {
    return [...scored].sort((a, b) => {
      if (b.rawScore !== a.rawScore)     return b.rawScore - a.rawScore;
      if (b.signalCount !== a.signalCount) return b.signalCount - a.signalCount;
      const ta = CATEGORY_TIER[a.rule?.category] ?? 99;
      const tb = CATEGORY_TIER[b.rule?.category] ?? 99;
      return ta - tb;
    });
  }

  /**
   * Assemble the display evidence profile from an already-sorted scored candidate list.
   * Labels are replaced with enriched text where available.
   * oldPrimaryId is used to set the warning when evidence re-ranked the original selection.
   */
  function _buildDisplayProfile(sortedScored, enrichedResult, oldPrimaryId) {
    if (!sortedScored || sortedScored.length === 0) {
      // Fallback: single unclassified candidate
      const fallback = {
        label: enrichedResult.enrichedPrimary || enrichedResult.primary?.label || 'Unclassified anomaly',
        isPrimary: true,
        signals: [
          signal1_AnomalyStrength(enrichedResult, {}),
          { score: 0, icon: '➖', name: 'Rule Specificity', value: 'Unknown', explanation: 'No rules fired for this anomaly' },
          { score: 0, icon: '➖', name: 'Peer Corroboration', value: '—', explanation: 'No rule data available' },
          { score: 0, icon: '➖', name: 'Persistence', value: '—', explanation: 'No rule data available' },
          { score: 0, icon: '➖', name: 'External Data', value: 'No data loaded', explanation: 'No real-world data available' },
        ],
        evidenceSignals: 0,
        rawScore: 0,
        relativeSupport: 100,
      };
      return {
        primary: fallback, alternatives: [],
        warning: null,
        disclaimer: 'Relative support reflects share of available evidence, not probability of being the true cause.',
      };
    }

    const altLabels = enrichedResult.enrichedAlternatives || enrichedResult.alternatives || [];

    const clamped      = sortedScored.map(c => Math.max(0, c.rawScore));
    const totalClamped = clamped.reduce((a, b) => a + b, 0);

    const profileCandidates = sortedScored.map((c, i) => {
      const displayLabel = i === 0
        ? (enrichedResult.enrichedPrimary || c.rule.label)
        : (altLabels[i - 1] || c.rule.label);
      return {
        label:           displayLabel,
        isPrimary:       i === 0,
        signals:         c.signals,
        evidenceSignals: c.signalCount,
        rawScore:        c.rawScore,
        relativeSupport: totalClamped > 0 ? Math.round((clamped[i] / totalClamped) * 100) : 0,
      };
    });

    const primary      = profileCandidates[0];
    const alternatives = profileCandidates.slice(1);

    // Warning when evidence ranking overrode the original rule-engine selection
    const evidencePrimaryId = sortedScored[0]?.rule?.id;
    const wasReranked = !!(oldPrimaryId && evidencePrimaryId && oldPrimaryId !== evidencePrimaryId);

    return {
      primary,
      alternatives,
      warning: wasReranked
        ? `Evidence profile re-ranked this anomaly's primary reason — the original rule-engine selection was overridden by evidence scoring.`
        : null,
      disclaimer: 'Relative support reflects share of available evidence, not probability of being the true cause.',
    };
  }

  // ── DATA SOURCES LIST ─────────────────────────────────

  function buildDataSources(snap, ctx) {
    const out = [];

    if (snap.fedfunds != null) out.push({
      label:  'FRED — Federal Funds Rate',
      value:  `${snap.fedfunds.toFixed(2)}%`,
      period: snap.label,
      note:   snap.fedChangeBps != null ? `${snap.fedChangeBps > 0 ? '+' : ''}${snap.fedChangeBps}bps vs prior month` : null,
    });

    if (snap.cpiYoY != null) out.push({
      label:  'FRED — CPI (National, CPIAUCSL)',
      value:  `${pct(snap.cpiYoY)} YoY`,
      period: snap.label,
    });

    if (snap.rentYoY != null) out.push({
      label:  'FRED — Rent CPI (CUUR0000SEHC)',
      value:  `${pct(snap.rentYoY)} YoY`,
      period: snap.label,
    });

    if (snap.stateUR != null) out.push({
      label:  `FRED — ${ctx?.stateName || ctx?.stateAbbr || ''} Unemployment`,
      value:  `${snap.stateUR.toFixed(1)}%`,
      period: snap.label,
    });

    if (snap.mortgage30 != null) out.push({
      label:  'FRED — 30-Year Mortgage Rate',
      value:  `${snap.mortgage30.toFixed(2)}%`,
      period: snap.label,
    });

    if (snap.housingStarts != null) out.push({
      label:  'FRED — Housing Starts (HOUST)',
      value:  `${snap.housingStarts.toLocaleString()}K units`,
      period: snap.label,
    });

    // FEMA
    if (snap.femaQuarter?.length) {
      snap.femaQuarter.slice(0, 3).forEach(d => out.push({
        label:  `FEMA — ${d.type || 'Disaster'} Declaration #${d.number}`,
        value:  d.title.slice(0, 60) || 'Declaration',
        period: d.date,
      }));
    } else if (ctx?.fema !== undefined) {
      out.push({ label: 'FEMA — Disaster Declarations', value: `None found in ${ctx?.stateAbbr || ''} for this quarter`, period: `Q${snap.quarter} ${snap.year}` });
    }

    // Congress
    if (snap.billsYear?.length) {
      snap.billsYear.slice(0, 2).forEach(b => out.push({
        label:  `Congress.gov — ${b.number}`,
        value:  b.title.slice(0, 70),
        period: b.introduced,
      }));
    } else if (ctx?.congress !== undefined) {
      out.push({ label: 'Congress.gov — Federal Legislation', value: `No housing-related bills found in ${snap.year}`, period: String(snap.year) });
    }

    // OpenStates
    if (snap.stateBillsYear?.length) {
      snap.stateBillsYear.slice(0, 2).forEach(b => out.push({
        label:  `OpenStates — ${ctx?.stateName || ''} Bill`,
        value:  b.title.slice(0, 70),
        period: b.introduced || String(snap.year),
      }));
    } else if (ctx?.openStates !== undefined) {
      out.push({ label: `OpenStates — ${ctx?.stateName || ''} Legislation`, value: `No relevant bills found in ${snap.year}`, period: String(snap.year) });
    }

    // Census
    const cen = ctx?.census || {};
    if (cen.population)   out.push({ label: 'Census ACS — City Population',       value: cen.population.toLocaleString(),          period: '2022 est.' });
    if (cen.medianIncome) out.push({ label: 'Census ACS — Median Household Income', value: `$${cen.medianIncome.toLocaleString()}`,  period: '2022 est.' });
    if (cen.renterRatio)  out.push({ label: 'Census ACS — Renter Ratio',           value: `${(cen.renterRatio * 100).toFixed(0)}%`, period: '2022 est.' });

    // HUD
    const hud = ctx?.hud || {};
    if (hud.year && hud.rows?.length) out.push({
      label:  'HUD — Fair Market Rents (state)',
      value:  `${hud.rows.length} metro areas`,
      period: String(hud.year),
    });

    return out;
  }

  // ── CORROBORATING NOTE ────────────────────────────────

  function buildCorroboratingNote(corroborating, snap) {
    if (!corroborating || corroborating.length === 0) return null;
    const sameQ = corroborating.filter(c => {
      const cp = parseLabel(c.monthLabel || '');
      return cp && cp.year === snap.year && cp.quarter === snap.quarter;
    });
    if (sameQ.length === 0) return null;

    const total = sameQ.length + 1;
    if (snap.fedChangeBps != null && Math.abs(snap.fedChangeBps) >= 50) {
      const dir = snap.fedChangeBps > 0 ? 'raised' : 'cut';
      return `${total} anomalies in this portfolio occurred in Q${snap.quarter} ${snap.year} when the Fed ${dir} rates ${bps(snap.fedChangeBps)} — suggesting a portfolio-wide ${snap.fedChangeBps > 0 ? 'financing cost' : 'refinancing'} impact.`;
    }
    if (snap.cpiYoY != null && Math.abs(snap.cpiYoY) > 4) {
      return `${total} anomalies in this portfolio coincide with ${snap.cpiYoY > 0 ? 'elevated' : 'falling'} CPI (${pct(snap.cpiYoY)} YoY) in Q${snap.quarter} ${snap.year} — possible macro inflation signal across the portfolio.`;
    }
    if (snap.femaQuarter?.length) {
      return `${total} anomalies coincide with a FEMA ${snap.femaQuarter[0].type} declaration in Q${snap.quarter} ${snap.year} — potential shared disruption event.`;
    }
    return null;
  }

  // ── ENRICH ONE RESULT ─────────────────────────────────

  function enrichOne(result, ctx) {
    if (!result) return result;

    // snap: full object when ctx available; minimal stub when not (signals 1–4 still work)
    const snap    = ctx ? monthSnapshot(ctx, result.monthLabel) : { label: result.monthLabel };
    console.log('[DEBUG enrichOne] monthLabel:', result.monthLabel, '| ctx fred keys:', Object.keys(ctx?.fred || {}), '| snap.fedfunds:', snap.fedfunds, '| snap.cpiYoY:', snap.cpiYoY, '| snap.stateUR:', snap.stateUR);
    const hasData = ctx != null && (snap.fedfunds != null || snap.cpiYoY != null ||
                    snap.stateUR != null || (snap.femaRecent?.length || 0) > 0);

    // ── Pass 1: Score every fired rule candidate and sort by evidence ──────
    // Uses allFiredRules (full objects from rules.js) when available.
    const allFiredRules = result.allFiredRules || [];
    const oldPrimaryId  = result.primary?.id;

    let sortedScored = [];
    let newPrimary   = result.primary;
    let newAlts      = result.alternatives || [];

    if (allFiredRules.length > 0) {
      sortedScored = _evidenceSort(allFiredRules.map(rule => _scoreCandidate(result, rule, snap)));
      newPrimary   = sortedScored[0].rule;
      const altRules = sortedScored.slice(1);
      if (altRules.length > 0) {
        newAlts = altRules.map(c => c.rule.label);
      } else {
        newAlts = (newPrimary.alternatives || []).slice(0, 3);
      }
      while (newAlts.length < 3) newAlts.push('Insufficient data for additional hypothesis');
      newAlts = newAlts.slice(0, 3);
    }

    // ── Pass 2: Build enriched text using evidence-ranked primary ───────────
    const updatedResult = { ...result, primary: newPrimary, alternatives: newAlts };

    const enrichedPrimary      = hasData ? buildEnrichedPrimary(updatedResult, snap, ctx)      : null;
    const enrichedAlternatives = hasData ? buildEnrichedAlternatives(updatedResult, snap, ctx) : null;
    const dataSources           = ctx ? buildDataSources(snap, ctx) : [];
    const corroboratingNote     = ctx ? buildCorroboratingNote(result.corroborating, snap) : null;

    const enrichedResult = {
      ...updatedResult,
      enrichedPrimary,
      enrichedAlternatives,
      dataSources,
      corroboratingNote,
    };

    // ── Pass 3: Assemble display evidence profile with enriched labels ───────
    const evidenceProfile = _buildDisplayProfile(sortedScored, enrichedResult, oldPrimaryId);

    return { ...enrichedResult, evidenceProfile };
  }

  // ── ENRICH ALL (batch) ────────────────────────────────
  /**
   * Takes the output of RuleEngine.analyse() and a dataContext,
   * returns the same structure with enriched fields added to each result.
   * Also updates metric.reasonData in-place so the table/card can access them.
   */
  function enrichAll(engineResult, ruleResults, dataContext) {
    if (!ruleResults || !ruleResults.results) return ruleResults;
    console.log('[DEBUG enrichAll] dataContext received:', dataContext);
    console.log('[DEBUG enrichAll] fred.fedfunds keys count:', Object.keys(dataContext?.fred?.fedfunds || {}).length);
    const enriched = ruleResults.results.map(r => enrichOne(r, dataContext));

    // Update metric.reasonData in-place
    if (engineResult) {
      enriched.forEach(er => {
        const metric = (engineResult.metrics || []).find(m => m.id === er.metricId);
        if (metric && metric.reasonData) {
          metric.reasonData[er.monthIdx] = er;
        }
      });
    }

    return { ...ruleResults, results: enriched };
  }

  // ── PUBLIC ────────────────────────────────────────────
  return { enrichOne, enrichAll };

})();
