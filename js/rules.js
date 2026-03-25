// ============================================================
// RULES.JS — Anomaly reason rule engine (deterministic)
// ============================================================

const RuleEngine = (() => {

  // ── RULE DEFINITIONS ──────────────────────────────────
  // Each rule: { id, category, label, weight, condition(ctx), alternatives[] }
  // ctx = { anomaly, metric, allMetrics, assetInfo, months }

  const RULES = [

    // ─── Asset Type Rules ────────────────────────────────

    {
      id: 'AT_OFFICE_INCOME_SHORTFALL',
      category: 'asset_type',
      label: 'Post-COVID hybrid work sensitivity — tenant downsizing or break clause exercise',
      weight: 0.75,
      condition: ctx =>
        /office/i.test(ctx.assetInfo.type || '') &&
        ctx.metric.section === 'INCOME' &&
        ctx.anomaly.pnl === 'loss',
      alternatives: [
        'Rent-free incentive distorting reported income',
        'Tenant CVA or administration affecting rent collection',
        'Lease restructure reducing passing rent',
      ],
    },

    {
      id: 'AT_RETAIL_INCOME_SHORTFALL',
      category: 'asset_type',
      label: 'E-commerce structural pressure — anchor tenant departure or new competing scheme',
      weight: 0.72,
      condition: ctx =>
        /retail|shopping|mall|strip/i.test(ctx.assetInfo.type || '') &&
        ctx.metric.section === 'INCOME' &&
        ctx.anomaly.pnl === 'loss',
      alternatives: [
        'Tenant CVA or voluntary arrangement reducing rent',
        'New competing retail scheme opening nearby',
        'Anchor tenant non-renewal of lease',
      ],
    },

    {
      id: 'AT_INDUSTRIAL_INCOME_SURPLUS',
      category: 'asset_type',
      label: 'Logistics/e-commerce demand premium — above-market lease-up or rent review reset',
      weight: 0.70,
      condition: ctx =>
        /industrial|logistics|warehouse|distribution/i.test(ctx.assetInfo.type || '') &&
        ctx.metric.section === 'INCOME' &&
        ctx.anomaly.pnl === 'profit',
      alternatives: [
        'Port or highway proximity premium captured at renewal',
        'New occupier above ERV reflecting market tightness',
        'Rent review uplift from historically under-rented position',
      ],
    },

    {
      id: 'AT_RESIDENTIAL_INCOME_SHORTFALL',
      category: 'asset_type',
      label: 'Vacancy event or rent arrears — void period or seasonal academic vacancy',
      weight: 0.68,
      condition: ctx =>
        /residential|multifamily|apartment|flat|resi/i.test(ctx.assetInfo.type || '') &&
        ctx.metric.section === 'INCOME' &&
        ctx.anomaly.pnl === 'loss',
      alternatives: [
        'Planned refurbishment void reducing unit count',
        'Rent arrears from specific tenant cohort',
        'Seasonal academic vacancy in university catchment',
      ],
    },

    {
      id: 'AT_LAND_INCOME',
      category: 'asset_type',
      label: 'Possible data classification error — presale deposits or temporary license fee misbooked',
      weight: 0.55,
      condition: ctx =>
        /land|development|dev site/i.test(ctx.assetInfo.type || '') &&
        ctx.metric.section === 'INCOME',
      alternatives: [
        'Temporary car park or storage license income',
        'Overage payment or s.106 receipt',
        'Pre-development rental income from existing structure',
      ],
    },

    // ─── Location Rules ──────────────────────────────────

    {
      id: 'LOC_CBD_INCOME',
      category: 'location',
      label: 'City-centre market cycle amplification — competing new supply or infrastructure disruption',
      weight: 0.65,
      condition: ctx => {
        const loc = (ctx.assetInfo.location || '').toLowerCase();
        return /center|centre|cbd|downtown|merkaz|lev hair|midtown/.test(loc) &&
          ctx.metric.section === 'INCOME';
      },
      alternatives: [
        'Anchor departure reducing footfall/demand',
        'Infrastructure works reducing access and trade',
        'New Grade-A supply cannibalising existing tenants',
      ],
    },

    {
      id: 'LOC_TOURIST_INCOME',
      category: 'location',
      label: 'Seasonal pattern deviation in tourist location — external event suppressing tourism',
      weight: 0.68,
      condition: ctx => {
        const loc = (ctx.assetInfo.location || '').toLowerCase();
        return /beach|marina|old city|eilat|jaffa|netanya|seafront|resort/.test(loc) &&
          ctx.metric.section === 'INCOME';
      },
      alternatives: [
        'New competing supply absorbing tourist demand',
        'Platform delisting or negative reviews affecting occupancy',
        'Currency movements reducing inbound tourist numbers',
      ],
    },

    {
      id: 'LOC_NEW_DEV_INCOME_SHORTFALL',
      category: 'location',
      label: 'Absorption risk in new development — delayed infrastructure or oversupply',
      weight: 0.60,
      condition: ctx => {
        const loc = (ctx.assetInfo.location || '').toLowerCase();
        return /new|north|regeneration|pinui|tama|masterplan|science park/.test(loc) &&
          ctx.metric.section === 'INCOME' &&
          ctx.anomaly.pnl === 'loss';
      },
      alternatives: [
        'Target demographic not materialising at projected pace',
        'Competing new-build offering superior specification',
        'Infrastructure delivery delayed beyond original schedule',
      ],
    },

    {
      id: 'LOC_BORDER',
      category: 'location',
      label: 'Currency or trade sensitivity near border crossing',
      weight: 0.58,
      condition: ctx => {
        const loc = (ctx.assetInfo.location || '').toLowerCase();
        return /border|frontier|crossing|checkpoint/.test(loc);
      },
      alternatives: [
        'New customs friction reducing cross-border trade volume',
        'Currency depreciation eroding real income',
        'Political tension reducing cross-border footfall',
      ],
    },

    // ─── Political / Regulatory Rules ────────────────────

    {
      id: 'POL_RENT_CONTROL',
      category: 'political',
      label: 'Rent control ceiling — statutory challenge or mid-lease regulation',
      weight: 0.78,
      condition: ctx => {
        const loc = (ctx.assetInfo.location || '').toLowerCase();
        const rentControlCities = /berlin|amsterdam|paris|new york|nyc|san francisco|sf|stockholm|vienna|vienna/;
        return rentControlCities.test(loc) &&
          ctx.metric.section === 'INCOME' &&
          ctx.anomaly.pnl === 'loss';
      },
      alternatives: [
        'Voluntary rent freeze adopted by operator',
        'Legal challenge to above-cap review',
        'Tenant turnover below projection under controlled regime',
      ],
    },

    {
      id: 'POL_EXPENSE_OVERSHOOT_REGULATORY',
      category: 'political',
      label: 'New municipal tax, environmental compliance charge or EPC upgrade cost',
      weight: 0.62,
      condition: ctx =>
        ctx.metric.section === 'EXPENSES' &&
        ctx.anomaly.pnl === 'loss',
      alternatives: [
        'Business rates revaluation increasing liability',
        'EPC upgrade capital expenditure misclassified as opex',
        'Fire safety compliance enforcement action',
      ],
    },

    // ─── Operational Rules ───────────────────────────────

    {
      id: 'OP_EMERGENCY_CAPEX',
      category: 'operational',
      label: 'Emergency capital expenditure — structural failure, M&E breakdown or enforcement action',
      weight: 0.70,
      condition: ctx => {
        // No prior anomaly pattern in this metric
        const priorAnomalies = (ctx.metric.anomalies || []).filter(i => i < ctx.monthIdx);
        return ctx.metric.section === 'EXPENSES' &&
          ctx.anomaly.pnl === 'loss' &&
          priorAnomalies.length === 0;
      },
      alternatives: [
        'Flood or fire damage remediation',
        'Lift or HVAC system replacement',
        'Emergency roof repair following storm',
      ],
    },

    {
      id: 'OP_VENDOR_ESCALATION',
      category: 'operational',
      label: 'Vendor contract escalation or service charge under-budgeting',
      weight: 0.63,
      condition: ctx => {
        // Gradual increase pattern: prior anomalies exist
        const priorAnomalies = (ctx.metric.anomalies || []).filter(i => i < ctx.monthIdx);
        return ctx.metric.section === 'EXPENSES' &&
          ctx.anomaly.pnl === 'loss' &&
          priorAnomalies.length > 0;
      },
      alternatives: [
        'FM contract renewal at above-inflation rates',
        'Reactive maintenance spiral from deferred works',
        'Inflation pass-through from utilities supplier',
      ],
    },

    {
      id: 'OP_LEASE_TENANT_EVENT',
      category: 'operational',
      label: 'Lease or tenant event — rent review, new tenant, lease restructure or break clause',
      weight: 0.65,
      condition: ctx => ctx.metric.section === 'INCOME',
      alternatives: [
        'Tenant break clause exercised early',
        'Rent review settlement materially above or below ERV',
        'New tenant at different rent from predecessor',
      ],
    },

    // ─── Market Rules ────────────────────────────────────

    {
      id: 'MKT_PORTFOLIO_INCOME',
      category: 'market',
      label: 'Market-wide signal — macro cycle turning or regulatory change affecting all comparable assets',
      weight: 0.65,  // reduced: supporting rule, not dominant
      condition: ctx => {
        // ALL THREE conditions must hold:
        // A — at least 3 peer metrics (4 total) with anomaly within ±1 month, same direction
        // B — peers span both INCOME and EXPENSES sections (true market-wide signal)
        // C — every qualifying peer must have |effectiveZ| > 1.5
        const qualifying = ctx.allMetrics.filter(m => {
          if (m.id === ctx.metric.id) return false;
          return (m.anomalies || []).some(ai => {
            if (Math.abs(ai - ctx.monthIdx) > 1) return false;
            const mZ = m.zScores[ai];
            return mZ &&
              Math.sign(mZ.effectiveZ) === Math.sign(ctx.anomaly.effectiveZ) &&
              Math.abs(mZ.effectiveZ) > 1.5;  // C: minimum Z threshold
          });
        });
        ctx.peerCount = qualifying.length;
        if (qualifying.length < 3) return false;  // A
        const hasIncome   = qualifying.some(m => m.section === 'INCOME');
        const hasExpenses = qualifying.some(m => m.section === 'EXPENSES');
        return hasIncome && hasExpenses;  // B
      },
      alternatives: [
        'Systemic projection error in budget model',
        'Portfolio-wide lease expiry cluster',
        'Macro interest rate or inflation shock',
      ],
    },

    {
      id: 'MKT_PORTFOLIO_EXPENSE',
      category: 'market',
      label: 'Macro inflation or repricing signal — portfolio-wide insurance renewal or compliance cost',
      weight: 0.65,  // reduced: supporting rule, not dominant
      condition: ctx => {
        if (ctx.metric.section !== 'EXPENSES') return false;
        // ALL THREE conditions must hold:
        // A — at least 3 peer metrics (4 total) with anomaly within ±1 month, same direction
        // B — peers span both INCOME and EXPENSES sections (true market-wide signal)
        // C — every qualifying peer must have |effectiveZ| > 1.5
        const qualifying = ctx.allMetrics.filter(m => {
          if (m.id === ctx.metric.id) return false;
          return (m.anomalies || []).some(ai => {
            if (Math.abs(ai - ctx.monthIdx) > 1) return false;
            const mZ = m.zScores[ai];
            return mZ &&
              Math.sign(mZ.effectiveZ) === Math.sign(ctx.anomaly.effectiveZ) &&
              Math.abs(mZ.effectiveZ) > 1.5;  // C: minimum Z threshold
          });
        });
        ctx.peerCount = qualifying.length;
        if (qualifying.length < 3) return false;  // A
        const hasIncome   = qualifying.some(m => m.section === 'INCOME');
        const hasExpenses = qualifying.some(m => m.section === 'EXPENSES');
        return hasIncome && hasExpenses;  // B
      },
      alternatives: [
        'Service charge reconciliation quarter',
        'Insurance market hardening across portfolio',
        'Regulatory compliance cost affecting all assets',
      ],
    },

    {
      id: 'MKT_ISOLATED',
      category: 'market',
      label: 'Asset-specific operational issue — single tenant event, maintenance emergency or data entry error',
      weight: 0.55,
      condition: ctx => {
        // Anomaly isolated while peers are normal
        const peerAnomalies = ctx.allMetrics.filter(m =>
          m.id !== ctx.metric.id &&
          m.section === ctx.metric.section &&
          (m.anomalies || []).includes(ctx.monthIdx)
        );
        return peerAnomalies.length === 0;
      },
      alternatives: [
        'Data entry or accounting error',
        'Single-tenant specific lease event',
        'One-off maintenance or insurance claim',
      ],
    },

    // ─── Seasonality Rule Engine Additions ───────────────

    {
      id: 'SEAS_Q1_HEATING',
      category: 'seasonality',
      label: 'Winter heating costs — Q1 expense spike typical for residential assets',
      weight: 0.72,
      condition: ctx => {
        const mo = ctx.monthLabel ? ctx.monthLabel.split(' ')[0] : '';
        return /jan|feb|mar/i.test(mo) &&
          /residential|multifamily|apartment/i.test(ctx.assetInfo.type || '') &&
          ctx.metric.section === 'EXPENSES' &&
          ctx.anomaly.pnl === 'loss';
      },
      alternatives: [
        'Boiler or heating system replacement',
        'Increased service charge for communal heating',
        'Gas price spike pass-through',
      ],
    },

    {
      id: 'SEAS_Q3_RESI_INCOME_SHORTFALL',
      category: 'seasonality',
      label: 'Peak season income anomaly on residential — major red flag if Q3 shows shortfall',
      weight: 0.82,
      condition: ctx => {
        const mo = ctx.monthLabel ? ctx.monthLabel.split(' ')[0] : '';
        return /jul|aug|sep/i.test(mo) &&
          /residential|multifamily|apartment|short.?term/i.test(ctx.assetInfo.type || '') &&
          ctx.metric.section === 'INCOME' &&
          ctx.anomaly.pnl === 'loss';
      },
      alternatives: [
        'Renovation or refurbishment during peak season',
        'Competing new supply entering market in Q3',
        'Platform algorithm change reducing booking volume',
      ],
    },

    {
      id: 'SEAS_Q4_EXPENSE',
      category: 'seasonality',
      label: 'Year-end tax provisioning, deferred maintenance or insurance renewal',
      weight: 0.70,
      condition: ctx => {
        const mo = ctx.monthLabel ? ctx.monthLabel.split(' ')[0] : '';
        return /oct|nov|dec/i.test(mo) &&
          ctx.metric.section === 'EXPENSES' &&
          ctx.anomaly.pnl === 'loss';
      },
      alternatives: [
        'Annual insurance premium renewal',
        'Q4 maintenance catchup from deferred works',
        'Year-end accounting provision for accruals',
      ],
    },

    {
      id: 'SEAS_Q2_CONSTRUCTION',
      category: 'seasonality',
      label: 'Construction season — planned maintenance front-loaded into spring',
      weight: 0.65,
      condition: ctx => {
        const mo = ctx.monthLabel ? ctx.monthLabel.split(' ')[0] : '';
        return /apr|may|jun/i.test(mo) &&
          ctx.metric.section === 'EXPENSES' &&
          ctx.anomaly.pnl === 'loss';
      },
      alternatives: [
        'Annual exterior decoration or landscaping works',
        'Planned M&E servicing scheduled for spring',
        'Contractor availability driving Q2 concentration',
      ],
    },

    {
      id: 'SEAS_STR_EVENT',
      category: 'seasonality',
      label: 'Event-driven income spike on short-term rental — conference, holiday or platform surge',
      weight: 0.73,
      condition: ctx =>
        /short.?term|str|vacation|holiday|bnb/i.test(ctx.assetInfo.type || '') &&
        ctx.metric.section === 'INCOME' &&
        ctx.anomaly.pnl === 'profit',
      alternatives: [
        'Holiday period or local festival driving occupancy',
        'Platform promotional campaign boosting listings',
        'Corporate conference or event in catchment area',
      ],
    },

    {
      id: 'SEAS_RAMADAN',
      category: 'seasonality',
      label: 'Ramadan trading pattern shift — retail/office income volatility in Middle East markets',
      weight: 0.68,
      condition: ctx => {
        const loc = (ctx.assetInfo.location || '').toLowerCase();
        return /dubai|abu dhabi|riyadh|jeddah|doha|kuwait|bahrain|amman|beirut|cairo|middle east|uae|ksa|saudi/
          .test(loc) &&
          /retail|office/i.test(ctx.assetInfo.type || '') &&
          ctx.metric.section === 'INCOME';
      },
      alternatives: [
        'Eid holiday period disrupting trading pattern',
        'Summer exodus of expatriate workers',
        'Cooling season energy cost spike',
      ],
    },
  ];

  // ── CATEGORY PRIORITY ─────────────────────────────────
  // Lower number = more specific = ranks higher when selecting primary reason.
  const CATEGORY_PRIORITY = {
    asset_type:  1,
    location:    2,
    seasonality: 3,
    political:   3,
    operational: 4,
    market:      5,
  };

  // ── JACCARD SIMILARITY ────────────────────────────────

  function jaccard(setA, setB) {
    const a = new Set(setA);
    const b = new Set(setB);
    const inter = [...a].filter(x => b.has(x)).length;
    const union = new Set([...a, ...b]).size;
    return union === 0 ? 0 : inter / union;
  }

  // ── SCORE RULES FOR ONE ANOMALY ───────────────────────

  function scoreRules(ctx) {
    const fired = [];
    RULES.forEach(rule => {
      try {
        if (rule.condition(ctx)) fired.push({ ...rule });
      } catch (_) {}
    });
    // Sort: specific categories first, then weight descending within the same category.
    fired.sort((a, b) => {
      const pa = CATEGORY_PRIORITY[a.category] ?? 99;
      const pb = CATEGORY_PRIORITY[b.category] ?? 99;
      if (pa !== pb) return pa - pb;   // more specific category wins
      return b.weight - a.weight;      // higher weight wins within same category
    });
    return fired;
  }

  // ── PRIMARY RULE SELECTION ────────────────────────────
  // Preliminary selection only — enrichment.js re-ranks by evidence score.
  // The initial primary is the highest category-priority / weight rule,
  // which is overridden by evidence-based ranking in enrichment.

  function selectPrimary(fired) {
    if (!fired || fired.length === 0) return null;

    // PASS 1 — Any non-market rule is preferred over the market rule.
    // fired is already sorted by category priority + weight (from scoreRules).
    const nonMarket = fired.filter(r => r.category !== 'market');
    if (nonMarket.length > 0) return nonMarket[0];

    // PASS 2 — Market rule only when no specific rule fired.
    const market = fired.filter(r => r.category === 'market');
    if (market.length > 0) return market[0];

    // PASS 3 — Fallback: no rules classified (shouldn't normally reach here).
    return fired[0] || null;
  }

  // ── CLUSTER ANOMALIES ─────────────────────────────────

  function clusterAnomalies(allResults) {
    // allResults: [{ metricId, monthIdx, firedRuleIds, pnl, effectiveZ }]
    const clusters = [];

    allResults.forEach((a, i) => {
      let assigned = false;
      for (const cluster of clusters) {
        const rep = cluster.members[0];
        const sim = jaccard(a.firedRuleIds, rep.firedRuleIds);
        const dirMatch = Math.sign(a.effectiveZ) === Math.sign(rep.effectiveZ);
        const score = sim * (dirMatch ? 1 : 0.7);
        if (score >= 0.5) {
          cluster.members.push(a);
          if (score >= 0.65) cluster.core.push(a);
          assigned = true;
          break;
        }
      }
      if (!assigned) clusters.push({ members: [a], core: [a] });
    });

    // Label clusters
    clusters.forEach(c => {
      const topRule = (() => {
        const freq = {};
        c.core.forEach(m => m.firedRuleIds.forEach(id => { freq[id] = (freq[id] || 0) + 1; }));
        return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
      })();
      const rule = RULES.find(r => r.id === topRule);
      const dirLabel = c.core[0]?.pnl === 'profit' ? 'Surplus' : 'Shortfall/Overspend';
      c.label = rule ? `${rule.category.replace(/_/g, ' ')} — ${dirLabel}` : 'Unclassified Cluster';
    });

    return clusters;
  }

  // ── CORROBORATING ANOMALIES ───────────────────────────

  function findCorroborating(targetResult, allResults) {
    return allResults
      .filter(r => r !== targetResult)
      .map(r => {
        const sim = jaccard(targetResult.firedRuleIds, r.firedRuleIds);
        const dirMatch = Math.sign(targetResult.effectiveZ) === Math.sign(r.effectiveZ);
        const score = sim * (dirMatch ? 1 : 0.7);
        return { ...r, similarity: Math.round(score * 100) };
      })
      .filter(r => r.similarity >= 50)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 5);
  }

  // ── MAIN ENTRY ────────────────────────────────────────

  /**
   * Run reason engine on all anomalies across all metrics.
   * Returns enriched results and cluster data.
   */
  function analyse(metrics, months, assetInfo) {
    const allResults = [];

    metrics.forEach(metric => {
      (metric.anomalies || []).forEach(relIdx => {
        const absMonthIdx = metric.displayMonths ? metric.displayMonths[relIdx] : relIdx;
        const monthLabel = months[absMonthIdx] || '';
        const z = metric.zScores[relIdx];
        if (!z) return;

        const ctx = {
          anomaly: { ...z, pnl: z.pnl },
          metric,
          allMetrics: metrics,
          assetInfo,
          monthIdx: relIdx,
          monthLabel,
          peerCount: 0,
        };

        const fired = scoreRules(ctx);
        const firedRuleIds = fired.map(r => r.id);

        const primary = selectPrimary(fired) || {
          label: 'Unclassified anomaly — insufficient context to determine primary cause',
          weight: 0,
          alternatives: [
            'Data entry or reporting error',
            'One-off event not captured in historical data',
            'Classification or budget reclassification',
          ],
        };

        // Alternatives: all other fired rules except the primary, in priority order
        const altRules = fired.filter(r => r.id !== primary.id);
        const alternatives = altRules.length > 0
          ? altRules.slice(0, 3).map(r => r.label)
          : primary.alternatives.slice(0, 3);

        // Pad alternatives to minimum 3
        while (alternatives.length < 3) {
          alternatives.push('Insufficient data for additional hypothesis');
        }

        const result = {
          metricId: metric.id,
          metricName: metric.name,
          section: metric.section,
          monthIdx: relIdx,
          absMonthIdx,
          monthLabel,
          firedRuleIds,
          effectiveZ: z.effectiveZ,
          pnl: z.pnl,
          primary,
          alternatives,
          allFiredRules: fired,        // full rule objects for evidence scoring in enrichment
          peerCount: ctx.peerCount || 0,
          anomalyCount: (metric.anomalies || []).length,
        };

        allResults.push(result);

        if (!metric.reasonData) metric.reasonData = {};
        metric.reasonData[relIdx] = result;
      });
    });

    const clusters = clusterAnomalies(allResults);

    allResults.forEach(r => {
      r.corroborating = findCorroborating(r, allResults);
    });

    return { results: allResults, clusters };
  }

  return { analyse, RULES, jaccard };
})();
