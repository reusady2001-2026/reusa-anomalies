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

  // ── CONFIDENCE ADJUSTMENT ─────────────────────────────

  function adjustConfidence(result, snap) {
    const baseWeight = result.primary?.weight || 0;
    let conf  = Math.round(baseWeight * 100);
    const notes = [];
    const ruleId = result.primary?.id || (result.firedRuleIds || [])[0] || '';

    // ── Boosts ──

    // Economic indicator corroborates expense rule
    if (result.section === 'EXPENSES' && snap.cpiYoY != null && snap.cpiYoY > 4) {
      conf = Math.min(95, conf + 15);
      notes.push({ delta: +15, text: `CPI ${pct(snap.cpiYoY)} YoY in ${snap.label} corroborates cost-side pressure` });
    }

    // Fed rate hike corroborates financing cost rule
    if (snap.fedChangeBps != null && snap.fedChangeBps >= 50) {
      conf = Math.min(95, conf + 15);
      notes.push({ delta: +15, text: `Fed rate hike of ${bps(snap.fedChangeBps)} in ${snap.label} corroborates financing cost impact` });
    }

    // Active legislation corroborates regulatory/political rule
    const hasLeg = (snap.stateBillsYear?.length || 0) + (snap.billsYear?.length || 0) > 0;
    if (hasLeg && (ruleId.includes('POL') || ruleId.includes('REGULATORY') || ruleId.includes('EXPENSE'))) {
      conf = Math.min(95, conf + 20);
      notes.push({ delta: +20, text: `Active housing/regulatory legislation in ${snap.year} corroborates rule` });
    }

    // FEMA disaster corroborates residential income shortfall
    const hasFema = (snap.femaRecent?.length || 0) + (snap.femaQuarter?.length || 0) > 0;
    if (hasFema && result.section === 'INCOME') {
      conf = Math.min(95, conf + 25);
      notes.push({ delta: +25, text: `FEMA disaster declaration in state near this period corroborates income disruption` });
    }

    // Multiple independent sources agree
    const boostCount = notes.filter(n => n.delta > 0).length;
    if (boostCount >= 2) {
      conf = Math.min(95, conf + 5);
      notes.push({ delta: +5, text: `${boostCount} independent data sources point to the same cause` });
    }

    // ── Reductions ──

    // CPI low but expense spike — inflation not the driver
    if (result.section === 'EXPENSES' && snap.cpiYoY != null && snap.cpiYoY < 1.5 && snap.cpiYoY >= 0) {
      conf = Math.max(5, conf - 10);
      notes.push({ delta: -10, text: `CPI was only ${pct(snap.cpiYoY)} YoY — inflation unlikely to be the primary driver` });
    }

    // Unemployment very low but vacancy rule fired
    if (ruleId.includes('RESIDENTIAL') && snap.stateUR != null && snap.stateUR < 3.5 && result.pnl === 'loss') {
      // Contradicts demand-driven vacancy theory
      conf = Math.max(5, conf - 5);
      notes.push({ delta: -5, text: `Very low unemployment (${snap.stateUR.toFixed(1)}%) contradicts market-wide demand weakness — likely asset-specific` });
    }

    return { adjustedConfidence: conf, confidenceNotes: notes };
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
    if (!ctx || !result) return result;

    const snap = monthSnapshot(ctx, result.monthLabel);
    const hasData = snap.fedfunds != null || snap.cpiYoY != null ||
                    snap.stateUR != null || snap.femaRecent?.length;

    const enrichedPrimary      = hasData ? buildEnrichedPrimary(result, snap, ctx)      : null;
    const enrichedAlternatives = hasData ? buildEnrichedAlternatives(result, snap, ctx) : null;
    const { adjustedConfidence, confidenceNotes } = adjustConfidence(result, snap);
    const dataSources      = buildDataSources(snap, ctx);
    const corroboratingNote = buildCorroboratingNote(result.corroborating, snap);

    return {
      ...result,
      enrichedPrimary,
      enrichedAlternatives,
      adjustedConfidence,
      confidenceNotes,
      dataSources,
      corroboratingNote,
    };
  }

  // ── ENRICH ALL (batch) ────────────────────────────────
  /**
   * Takes the output of RuleEngine.analyse() and a dataContext,
   * returns the same structure with enriched fields added to each result.
   * Also updates metric.reasonData in-place so the table/card can access them.
   */
  function enrichAll(engineResult, ruleResults, dataContext) {
    if (!ruleResults || !ruleResults.results) return ruleResults;
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
