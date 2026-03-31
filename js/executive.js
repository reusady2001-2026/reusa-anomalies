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

function isSporadic(metric) {
  return metric.type === 'sporadic';
}

const CATEGORY_MAP = {
  'RENTAL INCOME': ['Market Rent','(Loss)/Gain to Lease','Less: Vacancy','Residential Rent','Concession','Military Discount Concession','Preferred Employer Concession','First Responder Concession','Employee Concession','Courtesy Patrol','Rent Adjustment','Preferential Rent','Section 8','Down Units','Admin Units','Model Unit','Month to Month','Seller Arrears','Delinquency'],
  'COST RECOVERY': ['Reimbursed Water/Sewer','Reimbursed Trash','Reimbursed Utilities','Reimbursed Renters Insurance','Reimbursed Utility Fee','Reimbursed Deposit Alternatives','Rev Share','Other Reimbursed costs'],
  'OTHER INCOME': ['Condo Assoc Fee','Estoppel Fee','Marketing Service Agreement','Amenity Fee','Charging Station Income','Legal Fees','Pet Rent','Key Charge','Pet Fee','Pest Control','Laundry','Interest income','Interest Expense','Cable','Parking Income','Transfer Apartment','Late Fees','Bike','Administrative Fee','Cleaning Fee','Furnished Unit Expenses','Lockout Fee','Inspection Fee','Smoking Fee','Damages Fee','Application Fee','Early Termination Fee','Bounced Check Fee','Court Cost','Miscellaneous','Licensing fees','Unallocated Payments','Storage Income'],
  'COMMERCIAL INCOME': ['COMMERCIAL RENT','CAM Income','Antenna Income'],
  'AUTO EXPENSE': ['Vehicle Registration','Auto Leasing','EZ Pass','Gas','Auto Insurance','Parking','Parking Fine','Auto Repairs','Tolls'],
  'GENERAL AND ADMINISTRATIVE': ['Ramp Plus Charges','Bank Service Charges','Clickpay','Yardi expense','Yardi Payment Processing Fees','Deposit Alternative','Renters Insurance','Wire Transfer Fee','Tenant Screening','Travel Expense','Temp Housing','BlueMoon','Tech Costs','Shipping (UPS FEDEX)','Postage','Printing Expense','Escrow Admin Fee','Alert Services/ Security Alarm','Messaging/ Answering Service','Phones/Internet/Cable','Employee Gifts','Food & Entertaiment','Water/ Coffee/ Drinks for Office','Staff Retention & Entertainment','Staff Merchandise','Software Subscriptions','Holiday Party','Seasonal Decorations','Recruiting Expense','Contributions','Affordable Housing Management & Compliance','Legal L & T','Broker of Record (L&T)','Security','Consulting Fees','Corporation Tax','Professional Fees','Union Dues','Office Furniture','Office Supplies','Office Equipment','Financing fee','Office Expense','Training/ Seminars','Uniforms','Property Registration','Fees and Permits','Memberships','Website & Domain Services','Licenses','Miscellaneous Expense','Online Payment Fee'],
  'MANAGEMENT FEES': ['Management Fees'],
  'LEASING & MARKETING': ['Online Marketing Expense','Print Marketing','Marketing Concessions','Resident Pet Program','Marketing Software','Resident Events','Resident Retention','Resident Coffee Station','Other Marketing Expense','Promotion and entertainment','Community Functions','Signage Marketing','Resident Referral','Brokers fee'],
  'ADMIN PAYROLL': ['Payroll - Admin Assistant Property Manager','Assistant Manager','Payroll Taxes - Administrative','Workers Comp - Administrative','Health Insurance - Administrative','Overtime - Administrative','Bonus - Administrative'],
  'LEASING PAYROLL': ['Payroll - Leasing','Leasing Consultant','Payroll Taxes - Leasing','Workers Comp - Leasing','Health Insurance - Leasing','Overtime - Leasing','Bonus - Leasing'],
  'MAINTENANCE PAYROLL': ['Payroll - Maintenance','Maintenance Tech','Payroll Taxes - Maintenance','Workers Comp - Maintenance','Health Insurance - Maintenance','Overtime - Maintenance','Bonus - Maintenance'],
  'PROPERTY MANAGER PAYROLL': ['Payroll - Property Manager'],
  'OTHER PAYROLL': ['Reimbursement - Phones/Gas/Tolls','Payroll Services','Outside Services','Severance Pay'],
  'TAXES AND INSURANCE': ['Property & Liability Insurance','Umbrella Insurance','Flood Insurance','ELPI Insurance','Real Estate Taxes','Consultant'],
  'UTILITIES': ['Electric Expense','Electric Expense - vacant units','Gas Expense','Gas Expense - Vacant Units','Water expense','Sewer Expense','Rubbish Removal/Sanitation','Utility Billing','Recoverable Elec/Gas/Water'],
  'UNIT TURNOVER': ['Unit Turnover - Carpet Cleaning & Repairs','Paint & Plaster Contract','Paint & Plaster Contract - Extra service','Unit Turnover - Painting','Unit Turnover - Cleaning','Unit Turnover - Countertop Repairs','Unit Turnover - Vinyl Repairs','Unit Turnover - Appliances','Unit Turnover - HVAC Repairs','Unit Turnover - Bathroom Repairs','Unit Turnover - Inspection Fees','Unit Turnover - Resurfacing','Unit Turnover - Floor Repairs','Unit Turnover - General Repairs','Unit Turnover - Kitchen Repairs','Unit Turnover - Supplies'],
  'CONTRACT REPAIRS': ['Amazon Locker Lease','Intercom Software Contract','Software Contract','EV Station Software Contract','Exterminating Contract','Exterminating Contract - Extra service','Pool Maintenance Contract','Pool Maintenance Contract - Extra service','Power Washing','Landscaping Contract','Landscaping Contract - Extra service','Concierge Services Contract','Cleaning Contract','Valet Trash','Sprinkler contract','Scent Services Contract','Gym Fees','Peloton Contract','Vent Cleaning','HVAC Contract','Aquarium Servicing Contract','Generator Inspection Contract','Cleaning Contract - Extra service','Shuttle Contract','Flooring & Carpeting Contract','Snow Removal Contract','Snow Removal Contract - Extra service','Pond Treatment Contract','Storage Unit Contract','Washer & Dryer Rental Contract','Fire/Sprinkler Inspections & Monitoring Contract','Fire Alarm Monitoring Contract','Elevator Contract','Security - Live Monitoring Contract'],
  'REPAIRS & MAINTENANCE': ['Elevator Consultant','Plumber - In House','Fire Pump Fuel','Boiler Repairs & Maint','Hot water Heaters','Fitness center repairs/contract','Flooring & Carpeting','Parking Pass','PTAC Repair Parts','Signs and Safety','Welding','Fireplace/Chimney Repairs','Package Locker Service','Fencing','Lead Abatement & Testing','Paint & Plaster','Plumbing Repairs & Maint','Exterior Repairs & Maint','Hallway Cleaning','Interior Repairs & Maint','Elevator Repairs & Maint','Gutter Repairs & Maint','Bathroom Repairs & Maint','Amenities Supplies/Equipment','Amenity Repairs & Maint','Roof Repairs & Maint','Carpet Cleaning','Compactor','Generator Expenses','Landscape Repairs','One time Cleanup','Doors/Garage','Mold','Sewer and Drain Cleaning','Leak Repair','Fire Extinguisher','HVAC Repairs & Maint','HVAC Cleaning','Intercom','Electrical Repairs & Maint','Towing costs','Carpet Repairs & Maint','Golf Cart Repairs & Maint','Security camera','Kitchen supplies','Bathroom Supplies','Plumbing supplies','Paint Supplies','Landscaping Supplies','Tiles','Hardware Supplies','Pool Supplies','Outdoor Sports/Activities/Equipment','Janitorial Supplies','Ground Supplies','Building & Maintenance Supplies','Electrical Supplies','Miscellaneous Supplies','First Aid & Safety Supplies','Appliances','Appliance Parts','Tools','Hvac Parts','Covid19 Expenses','Filters','Elevator Inspections and Permits','Inspections and Permits','Sprinklers','Pool Repairs/Maintenance','Windows/Screens','Window Shades','Locks & Keys','Fire Alarms','Smoke Alarms','Paving','Screen','Environmental Compliance','PO Suspense Expense','Locksmith'],
  'OTHER EXPENSES': ['Parking Lot Lease','Property Inspection','Late Fee','Bad debts expense','Bad Debt Recoveries','Violation Penalty','Violation Removal'],
};

const INCOME_CATEGORIES = new Set(['RENTAL INCOME','COST RECOVERY','OTHER INCOME','COMMERCIAL INCOME']);

function computeCategoryTotals(metrics, months) {
  return Object.entries(CATEGORY_MAP).map(([categoryName, metricNames]) => {
    const matchingMetrics = metrics.filter(m => metricNames.includes(m.name));
    const values = months.map((_, i) => {
      let total = 0, hasData = false;
      matchingMetrics.forEach(metric => {
        const val = metric.values?.[i];
        if (val != null) { total += val; hasData = true; }
      });
      return hasData ? total : null;
    });
    return {
      name: categoryName,
      section: INCOME_CATEGORIES.has(categoryName) ? 'INCOME' : 'EXPENSES',
      values,
      metricCount: matchingMetrics.length,
      matchedMetricCount: matchingMetrics.filter(m => m.values?.some(v => v != null)).length,
    };
  });
}

function analyse(metrics, months, purchasePrice, stateAbbr, city) {
  const threshold = (purchasePrice || 0) * THRESHOLD_RATE;
  const results = [];

  metrics.forEach(metric => {
    const values = metric.values || [];
    const flags = {}; // monthIdx → flag details
    const sporadic = isSporadic(metric);

    months.forEach((monthLabel, i) => {
      // Skip first 12 months
      if (i < MIN_MONTHS_REQUIRED) return;
      // Need at least 3 months before current for T3_prior
      if (i < 3) return;

      const v = values[i];
      if (v == null) return;

      const nullIfSporadic = val => (sporadic && val === 0) ? null : val;

      // T3_current: sum of values[i-2], values[i-1], values[i], annualized ×4
      const t3Vals = [values[i-2], values[i-1], values[i]].map(nullIfSporadic);
      if (t3Vals.some(v => v == null)) return;
      const T3_current = t3Vals.reduce((a,b) => a+b, 0) * 4;

      // T3_prior: sum of values[i-3], values[i-2], values[i-1], annualized ×4
      const t3PriorVals = [values[i-3], values[i-2], values[i-1]].map(nullIfSporadic);
      if (t3PriorVals.some(v => v == null)) return;
      const T3_prior = t3PriorVals.reduce((a,b) => a+b, 0) * 4;

      // T12: sum of values[i-11] through values[i]
      if (i < 11) return;
      const t12Vals = values.slice(i-11, i+1).map(nullIfSporadic);
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
    narrative += ` ${evidence.slice(0, 2).join('. ')}.`;
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

function analyseCategories(metrics, months, purchasePrice) {
  const threshold = (purchasePrice || 0) * THRESHOLD_RATE;
  const categories = computeCategoryTotals(metrics, months);
  const results = [];

  categories.forEach(category => {
    const values = category.values;
    const flags = {};

    months.forEach((monthLabel, i) => {
      if (i >= months.length - 2) return; // skip last 2 months
      if (i < MIN_MONTHS_REQUIRED) return;
      if (i < 3) return;

      const v = values[i];
      if (v == null) return;

      const t3Vals = [values[i-2], values[i-1], values[i]];
      if (t3Vals.some(v => v == null)) return;
      const T3_current = t3Vals.reduce((a,b) => a+b, 0) * 4;

      const t3PriorVals = [values[i-3], values[i-2], values[i-1]];
      if (t3PriorVals.some(v => v == null)) return;
      const T3_prior = t3PriorVals.reduce((a,b) => a+b, 0) * 4;

      if (i < 11) return;
      const t12Vals = values.slice(i-11, i+1);
      if (t12Vals.some(v => v == null)) return;
      const T12 = t12Vals.reduce((a,b) => a+b, 0);

      const movementFromPrior = Math.abs(T3_current - T3_prior);
      const movementFromT12 = Math.abs(T3_current - T12);
      const flaggedByPrior = movementFromPrior > threshold;
      const flaggedByT12 = movementFromT12 > threshold;

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
          maxMovement: Math.max(movementFromPrior, movementFromT12),
        };
      }
    });

    if (Object.keys(flags).length > 0) {
      const worstFlag = Object.values(flags).sort((a,b) => b.maxMovement - a.maxMovement)[0];
      results.push({
        name: category.name,
        section: category.section,
        values: category.values,
        flags,
        worstMovement: worstFlag.maxMovement,
        worstMonthLabel: worstFlag.monthLabel,
        worstDirection: worstFlag.direction,
        matchedMetricCount: category.matchedMetricCount,
      });
    }
  });

  results.sort((a, b) => b.worstMovement - a.worstMovement);

  return { results, months, threshold };
}

const Executive = { analyse, generateEANarrative, computeCategoryTotals, analyseCategories };
