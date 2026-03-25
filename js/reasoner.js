// ============================================================
// REASONER.JS — Data-driven self-reasoning engine
// ============================================================

// ── PART 1: METRIC RELATIONSHIP MAP ──────────────────────────
// Each group defines a set of operationally-related metrics.
// When multiple metrics in a group are simultaneously anomalous,
// their co-movement is evidence for the group's named cause.
// Metric name matching is case-insensitive and whitespace-trimmed.

const METRIC_RELATIONSHIP_MAP = [

  {
    id: 'VACANCY_EVENT',
    name: 'Occupancy loss event',
    direction: 'income_down',
    minMatch: 2,
    signature: 'Multiple occupancy-related income lines dropped simultaneously — units came vacant, lease-up stalled, or a group of leases expired without renewal.',
    metrics: [
      'Less: Vacancy',
      'Market Rent',
      'Residential Rent',
      '(Loss)/Gain to Lease',
      'Delinquency',
      'Down Units',
      'Section 8',
    ],
  },

  {
    id: 'CONCESSION_PRESSURE',
    name: 'Leasing concession pressure',
    direction: 'income_down',
    minMatch: 2,
    signature: 'Multiple concession lines increased — property is offering incentives to attract or retain tenants, suggesting competition, soft demand, or lease-up pressure.',
    metrics: [
      'Concession',
      'Military Discount Concession',
      'Preferred Employer Concession',
      'First Responder Concession',
      'Employee Concession',
      'Marketing Concessions',
      'Resident Referral',
      'Brokers fee',
      'Month to Month',
    ],
  },

  {
    id: 'UTILITY_SPIKE',
    name: 'Utility cost spike',
    direction: 'expense_up',
    minMatch: 2,
    signature: 'Multiple utility lines spiked — driven by rate increase, seasonal consumption peak, equipment failure causing overconsumption, or a billing catch-up.',
    metrics: [
      'Electric Expense',
      'Electric Expense - vacant units',
      'Gas Expense',
      'Gas Expense - Vacant Units',
      'Water expense',
      'Sewer Expense',
      'Rubbish Removal/Sanitation',
      'Utility Billing',
      'Recoverable Elec/Gas/Water',
    ],
  },

  {
    id: 'TURNOVER_WAVE',
    name: 'Unit turnover wave',
    direction: 'expense_up',
    minMatch: 2,
    signature: 'Multiple turnover cost lines spiked — a wave of unit vacates triggered simultaneous make-ready costs across painting, cleaning, repairs, and supplies.',
    metrics: [
      'Unit Turnover - Carpet Cleaning & Repairs',
      'Unit Turnover - Painting',
      'Unit Turnover - Cleaning',
      'Unit Turnover - Bathroom Repairs',
      'Unit Turnover - Floor Repairs',
      'Unit Turnover - General Repairs',
      'Unit Turnover - Kitchen Repairs',
      'Unit Turnover - Supplies',
      'Unit Turnover - Appliances',
      'Unit Turnover - HVAC Repairs',
      'Unit Turnover - Resurfacing',
      'Unit Turnover - Countertop Repairs',
      'Unit Turnover - Vinyl Repairs',
      'Unit Turnover - Inspection Fees',
      'Paint & Plaster Contract',
      'Paint & Plaster Contract - Extra service',
    ],
  },

  {
    id: 'PAYROLL_INCREASE',
    name: 'Payroll cost increase',
    direction: 'expense_up',
    minMatch: 2,
    signature: 'Multiple payroll lines increased — new hire, annual raise cycle, bonus payout, overtime surge, or workers comp adjustment.',
    metrics: [
      'Payroll - Admin Assistant Property Manager',
      'Assistant Manager',
      'Payroll Taxes - Administrative',
      'Workers Comp - Administrative',
      'Health Insurance - Administrative',
      'Overtime - Administrative',
      'Bonus - Administrative',
      'Payroll - Leasing',
      'Leasing Consultant',
      'Payroll Taxes - Leasing',
      'Workers Comp - Leasing',
      'Health Insurance - Leasing',
      'Overtime - Leasing',
      'Bonus - Leasing',
      'Payroll - Maintenance',
      'Maintenance Tech',
      'Payroll Taxes - Maintenance',
      'Workers Comp - Maintenance',
      'Health Insurance - Maintenance',
      'Overtime - Maintenance',
      'Bonus - Maintenance',
      'Payroll - Property Manager',
      'Outside Services',
      'Severance Pay',
    ],
  },

  {
    id: 'MAINTENANCE_SURGE',
    name: 'Maintenance and repair surge',
    direction: 'expense_up',
    minMatch: 3,
    signature: 'Multiple repair and maintenance lines spiked — suggests a major system failure, deferred maintenance catch-up, seasonal preparation, or storm/weather damage.',
    metrics: [
      'Hot water Heaters',
      'Boiler Repairs & Maint',
      'HVAC Repairs & Maint',
      'HVAC Cleaning',
      'HVAC Contract',
      'Plumbing Repairs & Maint',
      'Leak Repair',
      'Roof Repairs & Maint',
      'Elevator Repairs & Maint',
      'Electrical Repairs & Maint',
      'Doors/Garage',
      'Mold',
      'Sewer and Drain Cleaning',
      'Fire Alarms',
      'Smoke Alarms',
      'Sprinklers',
      'Fire Extinguisher',
      'Lead Abatement & Testing',
      'Environmental Compliance',
    ],
  },

  {
    id: 'SEASONAL_WINTER',
    name: 'Winter seasonal cost pattern',
    direction: 'expense_up',
    minMatch: 2,
    signature: 'Winter-specific costs spiked together — consistent with cold weather driving heating, snow removal, and weatherization costs.',
    metrics: [
      'Gas Expense',
      'Gas Expense - Vacant Units',
      'Snow Removal Contract',
      'Snow Removal Contract - Extra service',
      'Hot water Heaters',
      'Boiler Repairs & Maint',
      'HVAC Repairs & Maint',
      'HVAC Contract',
    ],
  },

  {
    id: 'SEASONAL_SUMMER',
    name: 'Summer seasonal cost pattern',
    direction: 'expense_up',
    minMatch: 2,
    signature: 'Summer-specific costs spiked together — consistent with heat driving cooling costs, pool operation, and landscaping peak season.',
    metrics: [
      'Electric Expense',
      'Electric Expense - vacant units',
      'Pool Maintenance Contract',
      'Pool Maintenance Contract - Extra service',
      'Pool Repairs/Maintenance',
      'Pool Supplies',
      'Landscaping Contract',
      'Landscaping Contract - Extra service',
    ],
  },

  {
    id: 'LEASING_MARKETING_PUSH',
    name: 'Leasing and marketing push',
    direction: 'expense_up',
    minMatch: 2,
    signature: 'Multiple leasing and marketing costs increased — property launched a campaign to fill vacancies, suggesting occupancy pressure or a planned lease-up push for new units.',
    metrics: [
      'Online Marketing Expense',
      'Print Marketing',
      'Resident Events',
      'Resident Retention',
      'Other Marketing Expense',
      'Promotion and entertainment',
      'Brokers fee',
      'Resident Referral',
      'Marketing Software',
      'Signage Marketing',
    ],
  },

  {
    id: 'INSURANCE_TAX_RESET',
    name: 'Insurance or tax step-change',
    direction: 'expense_up',
    minMatch: 1,
    signature: 'Insurance or tax lines stepped up — consistent with annual policy renewal at higher premium, property tax reassessment, or new insurance requirement.',
    metrics: [
      'Property & Liability Insurance',
      'Umbrella Insurance',
      'Flood Insurance',
      'ELPI Insurance',
      'Real Estate Taxes',
      'Auto Insurance',
    ],
  },

  {
    id: 'BAD_DEBT_EVENT',
    name: 'Bad debt or delinquency event',
    direction: 'expense_up',
    minMatch: 1,
    signature: 'Bad debt or delinquency spiked — tenant(s) stopped paying rent, eviction proceedings were initiated, or a delinquency balance was written off.',
    metrics: [
      'Bad debts expense',
      'Bad Debt Recoveries',
      'Delinquency',
      'Legal L & T',
      'Broker of Record (L&T)',
      'Court Cost',
      'Late Fees',
    ],
  },

  {
    id: 'INCOME_RECOVERY',
    name: 'Income recovery or rebound',
    direction: 'income_up',
    minMatch: 2,
    signature: 'Multiple income lines recovered simultaneously — occupancy improved, concessions were reduced, or a rent increase took effect across units.',
    metrics: [
      'Market Rent',
      'Residential Rent',
      '(Loss)/Gain to Lease',
      'Less: Vacancy',
      'Late Fees',
      'Administrative Fee',
    ],
  },

  {
    id: 'COST_RECOVERY_SHIFT',
    name: 'Utility cost recovery change',
    direction: 'any',
    minMatch: 2,
    signature: 'Reimbursement lines changed — RUBS billing was adjusted, a new utility reimbursement program started or ended, or occupancy change affected the recoverable amount.',
    metrics: [
      'Reimbursed Water/Sewer',
      'Reimbursed Trash',
      'Reimbursed Utilities',
      'Reimbursed Renters Insurance',
      'Reimbursed Utility Fee',
      'Reimbursed Deposit Alternatives',
      'Other Reimbursed costs',
      'Rev Share',
    ],
  },

  {
    id: 'CONTRACT_REPRICING',
    name: 'Vendor contract repricing or new contracts',
    direction: 'expense_up',
    minMatch: 3,
    signature: 'Multiple contract lines increased simultaneously — annual vendor contract renewals came in higher, new service contracts were added, or a contract was restructured at a higher rate.',
    metrics: [
      'Exterminating Contract',
      'Pool Maintenance Contract',
      'Landscaping Contract',
      'Cleaning Contract',
      'Shuttle Contract',
      'Elevator Contract',
      'HVAC Contract',
      'Fire/Sprinkler Inspections & Monitoring Contract',
      'Fire Alarm Monitoring Contract',
      'Snow Removal Contract',
      'Valet Trash',
      'Security - Live Monitoring Contract',
      'Vent Cleaning',
      'Storage Unit Contract',
      'Washer & Dryer Rental Contract',
    ],
  },

];

// ── PART 2: REASONING ENGINE ──────────────────────────────────

const Reasoner = (() => {

  // ── DIRECTION CHECK ───────────────────────────────────────
  // Returns true if ALL entries in matched[] satisfy the group's direction rule.
  function directionConsistent(matched, direction) {
    if (direction === 'any') return true;
    return matched.every(cm => {
      if (direction === 'expense_up')   return cm.section === 'EXPENSES' && cm.effectiveZ > 0;
      if (direction === 'expense_down') return cm.section === 'EXPENSES' && cm.effectiveZ < 0;
      if (direction === 'income_down')  return cm.section === 'INCOME'   && cm.effectiveZ < 0;
      if (direction === 'income_up')    return cm.section === 'INCOME'   && cm.effectiveZ > 0;
      return true;
    });
  }

  function analyse(metric, monthIdx, allMetrics, months, snap) {
    if (!metric) return null;

    // ── STEP 1: Build coMovers[] ──────────────────────────
    // Include the current metric itself, then every other metric that has
    // an anomaly within ±1 month of monthIdx.

    const coMovers = [];

    // Helper: get the closest effectiveZ for a metric near monthIdx (±1)
    function nearestZ(m, idx) {
      // Prefer exact month, then idx-1, then idx+1
      for (const offset of [0, -1, 1]) {
        const ai = idx + offset;
        if (ai < 0) continue;
        if ((m.anomalies || []).includes(ai)) {
          const z = m.zScores && m.zScores[ai];
          if (z && z.effectiveZ != null) return z.effectiveZ;
        }
      }
      return null;
    }

    // Add self
    const selfZ = metric.zScores && metric.zScores[monthIdx];
    coMovers.push({
      id:          metric.id,
      name:        metric.name,
      nameLower:   metric.name.trim().toLowerCase(),
      section:     metric.section,
      effectiveZ:  selfZ ? selfZ.effectiveZ : 0,
      direction:   selfZ && selfZ.effectiveZ < 0 ? 'negative' : 'positive',
      isSelf:      true,
    });

    // Add co-moving peers
    (allMetrics || []).forEach(m => {
      if (m.id === metric.id) return;
      const ez = nearestZ(m, monthIdx);
      if (ez == null) return;
      coMovers.push({
        id:         m.id,
        name:       m.name,
        nameLower:  m.name.trim().toLowerCase(),
        section:    m.section,
        effectiveZ: ez,
        direction:  ez < 0 ? 'negative' : 'positive',
        isSelf:     false,
      });
    });

    // ── STEP 2: Match coMovers against METRIC_RELATIONSHIP_MAP ──
    const triggeredGroups = [];

    METRIC_RELATIONSHIP_MAP.forEach(group => {
      // Build a set of the group's metric names in lowercase for fast lookup
      const groupNamesLower = group.metrics.map(n => n.trim().toLowerCase());

      // A. Find which coMovers are in this group
      const matched = coMovers.filter(cm => groupNamesLower.includes(cm.nameLower));
      const matchCount = matched.length;

      if (matchCount < group.minMatch) return;

      // B. Check direction consistency across all matched entries
      if (!directionConsistent(matched, group.direction)) return;

      // C. Triggered — record it
      triggeredGroups.push({
        group,
        matchCount,
        matchedMetrics: matched,
      });
    });

    // ── STEP 3: Rank triggeredGroups[] ───────────────────
    triggeredGroups.sort((a, b) => {
      // 1. matchCount descending
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;

      // 2. Coverage ratio descending (matchCount / total metrics in group)
      const covA = a.matchCount / a.group.metrics.length;
      const covB = b.matchCount / b.group.metrics.length;
      if (Math.abs(covB - covA) > 1e-9) return covB - covA;

      // 3. Average |Z| of matchedMetrics descending
      const avgZ = tg => tg.matchedMetrics.reduce((s, cm) => s + Math.abs(cm.effectiveZ), 0)
                         / (tg.matchedMetrics.length || 1);
      return avgZ(b) - avgZ(a);
    });

    // ── STEP 4: Single-metric reason lookup ──────────────
    // Keys: "NORMALISED NAME|dir" where dir is 'up' or 'down'.
    // Lookup is applied after normalising the metric name to uppercase + trimmed.
    const SINGLE_METRIC_REASONS = {
      // Income DOWN
      'MARKET RENT|down':                    'Market rent fell — possible rent reduction, pricing correction, or unit mix change',
      '(LOSS)/GAIN TO LEASE|down':           'Loss-to-lease widened — units are leasing below market rent, suggesting concession pressure or below-market renewals',
      'LESS: VACANCY|down':                  'Vacancy loss increased — more units are empty than in prior months',
      'RESIDENTIAL RENT|down':               'Residential rent collected dropped — possible delinquency, vacant unit, or lease adjustment',
      'DELINQUENCY|down':                    'Delinquency increased — tenants are not paying on time or at all',
      'SECTION 8|down':                      'Section 8 income changed — subsidy payment timing, unit count, or voucher status changed',
      'DOWN UNITS|down':                     'Down units increased — units taken offline for repairs or compliance',
      'SELLER ARREARS|down':                 'Seller arrears balance changed — acquisition adjustment or prior owner balance movement',
      // Income UP
      'MARKET RENT|up':                      'Market rent increased — rent growth, new lease pricing uplift, or unit mix improvement',
      '(LOSS)/GAIN TO LEASE|up':             'Gain-to-lease improved — units leasing above market rent or prior loss-to-lease recovered',
      'LESS: VACANCY|up':                    'Vacancy loss decreased — occupancy improved, more units leased',
      // Expense UP
      'BAD DEBTS EXPENSE|up':                'Bad debt write-off — one or more tenant balances written off as uncollectable',
      'BAD DEBT RECOVERIES|up':              'Bad debt recovery reversed — previously recovered amount was clawed back or reclassified',
      'REAL ESTATE TAXES|up':                'Real estate tax increased — annual reassessment, new tax rate, or supplemental bill',
      'PROPERTY & LIABILITY INSURANCE|up':   'Insurance premium increased — annual renewal at higher rate, new coverage requirement, or claims history surcharge',
      'MANAGEMENT FEES|up':                  'Management fee increased — tied to gross revenue increase or fee structure change',
      'LEGAL L & T|up':                      'Legal costs increased — eviction proceedings, lease disputes, or tenant litigation',
      'SNOW REMOVAL CONTRACT|up':            'Snow removal costs spiked — heavy snowfall event requiring emergency or extra service',
      'PROPERTY INSPECTION|up':              'Property inspection cost — scheduled or unscheduled inspection occurred',
      'VIOLATION PENALTY|up':                'Violation penalty charged — regulatory or municipal violation issued against the property',
    };

    function getSingleMetricReason(m, section, ez) {
      const nameKey = (m.name || '').trim().toUpperCase();
      const dir     = (ez == null ? 0 : ez) >= 0 ? 'up' : 'down';
      const key     = `${nameKey}|${dir}`;

      if (SINGLE_METRIC_REASONS[key]) return SINGLE_METRIC_REASONS[key];

      // Dynamic fallback
      const name = m.name || 'This metric';
      if (section === 'EXPENSES') {
        return dir === 'up'
          ? `${name} increased — one-time charge, vendor invoice, or service cost above normal monthly level`
          : `${name} decreased — below-normal spend, possible delayed invoice, credit, or service reduction`;
      }
      return dir === 'down'
        ? `${name} fell below normal — revenue shortfall, possible timing issue or operational change`
        : `${name} exceeded normal — above-average revenue, possible catch-up payment, new income source, or favorable timing`;
    }

    // Steps 5-6 not yet implemented — placeholder return
    const selfEz = selfZ ? selfZ.effectiveZ : null;
    return {
      triggeredGroups,
      topGroup:           triggeredGroups[0] || null,
      singleMetricReason: getSingleMetricReason(metric, metric.section, selfEz),
    };
  }

  return { analyse };

})();
