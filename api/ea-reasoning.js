const FRED_KEY = process.env.FRED_KEY;

function sbFetch(supabaseUrl, anonKey, path, opts = {}) {
  return fetch(`${supabaseUrl}/rest/v1${path}`, {
    ...opts,
    headers: {
      'Content-Type':  'application/json',
      'apikey':        anonKey,
      'Authorization': `Bearer ${anonKey}`,
      ...(opts.headers || {}),
    },
  });
}

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const STATE_CENTROIDS = {
  'AL':[32.8,-86.8],'AK':[64.2,-153.4],'AZ':[34.3,-111.1],'AR':[34.9,-92.4],
  'CA':[36.8,-119.4],'CO':[39.0,-105.5],'CT':[41.6,-72.7],'DE':[39.0,-75.5],
  'FL':[28.7,-82.5],'GA':[32.2,-83.4],'HI':[20.3,-156.4],'ID':[44.4,-114.6],
  'IL':[40.0,-89.2],'IN':[39.8,-86.1],'IA':[42.1,-93.5],'KS':[38.5,-98.4],
  'KY':[37.5,-85.3],'LA':[31.1,-91.9],'ME':[45.4,-69.2],'MD':[39.1,-76.8],
  'MA':[42.2,-71.5],'MI':[44.3,-85.4],'MN':[46.4,-93.1],'MS':[32.7,-89.7],
  'MO':[38.5,-92.5],'MT':[47.0,-109.6],'NE':[41.5,-99.9],'NV':[39.3,-116.6],
  'NH':[43.7,-71.6],'NJ':[40.1,-74.7],'NM':[34.4,-106.1],'NY':[42.9,-75.5],
  'NC':[35.5,-79.8],'ND':[47.5,-100.5],'OH':[40.4,-82.8],'OK':[35.6,-96.9],
  'OR':[44.6,-122.1],'PA':[40.6,-77.2],'RI':[41.7,-71.5],'SC':[33.9,-80.9],
  'SD':[44.4,-100.2],'TN':[35.8,-86.3],'TX':[31.5,-99.3],'UT':[39.3,-111.1],
  'VT':[44.1,-72.7],'VA':[37.8,-78.2],'WA':[47.4,-120.4],'WV':[38.6,-80.6],
  'WI':[44.3,-89.8],'WY':[43.0,-107.6]
};

const STATE_REGIONS = {
  Northeast: ['ME','NH','VT','MA','RI','CT','NY','NJ','PA'],
  Southeast: ['DE','MD','VA','WV','NC','SC','GA','FL','AL','MS','TN','KY','AR','LA'],
  Midwest: ['OH','IN','IL','MI','WI','MN','IA','MO','ND','SD','NE','KS'],
  Southwest: ['TX','OK','NM','AZ'],
  West: ['CO','WY','MT','ID','WA','OR','CA','NV','UT','AK','HI'],
};

function getRegion(stateAbbr) {
  for (const [region, states] of Object.entries(STATE_REGIONS)) {
    if (states.includes(stateAbbr)) return region;
  }
  return 'Unknown';
}

function parseMonthLabel(label) {
  // "Oct 2025" → { month: 10, year: 2025, date: Date }
  const parts = (label || '').split(' ');
  const mo = MONTH_NAMES.indexOf(parts[0]);
  const yr = parseInt(parts[1]);
  if (mo < 0 || isNaN(yr)) return null;
  return { month: mo + 1, year: yr, date: new Date(yr, mo, 1) };
}

async function fetchFREDSeries(seriesId, startDate, endDate) {
  try {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&observation_start=${startDate}&observation_end=${endDate}&api_key=${FRED_KEY}&file_type=json`;
    const res = await fetch(url);
    const data = await res.json();
    const result = {};
    (data.observations || []).forEach(o => {
      const d = new Date(o.date);
      const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
      result[label] = parseFloat(o.value);
    });
    return result;
  } catch(e) { return {}; }
}

const FRED_UR_MAP = {
  'NJ':'NJUR','NY':'NYUR','CA':'CAUR','TX':'TXUR','FL':'FLUR','PA':'PAUR',
  'IL':'ILUR','OH':'OHUR','GA':'GAUR','NC':'NCUR','MI':'MIUR','VA':'VAUR',
  'WA':'WAUR','AZ':'AZUR','MA':'MAUR','TN':'TNUR','IN':'INUR','MO':'MOUR',
  'MD':'MDUR','WI':'WIUR','CO':'COUR','MN':'MNUR','SC':'SCUR','AL':'ALUR',
  'LA':'LAUR','KY':'KYUR','OR':'ORUR','OK':'OKUR','CT':'CTUR','IA':'IAUR',
  'UT':'UTUR','NV':'NVUR','AR':'ARUR','MS':'MSUR','KS':'KSUR','NM':'NMUR',
  'NE':'NEUR','WV':'WVUR','ID':'IDUR','HI':'HIUR','NH':'NHUR','ME':'MEUR',
  'RI':'RIUR','MT':'MTUR','DE':'DEUR','SD':'SDUR','ND':'NDUR','AK':'AKUR',
  'VT':'VTUR','WY':'WYUR',
};

const METRIC_INTERPRETATIONS = {
  // ── RENTAL INCOME ────────────────────────────────────────────────────────
  'Market Rent': {
    up: 'rent growth — market rents have been rising above the annual average',
    down: 'rent decline — market rents have softened vs the annual average',
    verify: 'rentCPI',
    verifyUp: 'rentCPI_rising',
    verifyDown: 'rentCPI_falling',
  },
  'Less: Vacancy': {
    up: 'occupancy improvement — fewer vacant units vs the annual average',
    down: 'occupancy deterioration — more vacant units vs the annual average',
    verify: 'stateUR',
    verifyUp: 'stateUR_low',
    verifyDown: 'stateUR_high',
  },
  '(Loss)/Gain to Lease': {
    up: 'leases are being signed closer to or above asking rent — loss to lease narrowing',
    down: 'leases are being signed below asking rent — concessions or loss to lease widening',
    verify: 'rentCPI',
    verifyUp: 'rentCPI_rising',
    verifyDown: 'rentCPI_falling',
    contradictNote: 'Despite rising market rents, leases are being signed below asking — suggesting property-specific pricing or concession pressure',
  },
  'Concession': {
    up: 'concessions reduced — less incentive needed to lease units',
    down: 'concessions increased — more incentive needed to attract tenants',
    verify: 'stateUR',
    verifyUp: 'stateUR_low',
    verifyDown: 'stateUR_high',
  },
  'Residential Rent': {
    up: 'residential rent income rising above annual average',
    down: 'residential rent income declining vs annual average',
    verify: 'rentCPI',
    verifyUp: 'rentCPI_rising',
    verifyDown: 'rentCPI_falling',
  },
  'Military Discount Concession': { up: 'military concessions reduced', down: 'military concessions increased', verify: null },
  'Preferred Employer Concession': { up: 'employer concessions reduced', down: 'employer concessions increased', verify: null },
  'First Responder Concession': { up: 'first responder concessions reduced', down: 'first responder concessions increased', verify: null },
  'Employee Concession': { up: 'employee concessions reduced', down: 'employee concessions increased', verify: null },
  'Rent Adjustment': { up: 'rent adjustments net positive vs annual average', down: 'rent adjustments net negative vs annual average', verify: null },
  'Month to Month': { up: 'month-to-month leases increasing — possible retention or lease-up activity', down: 'month-to-month leases declining', verify: null },
  'Delinquency': { up: 'delinquency income rising — more late fees collected', down: 'delinquency income declining', verify: 'stateUR', verifyDown: 'stateUR_high' },
  'Section 8': { up: 'Section 8 income above annual average', down: 'Section 8 income below annual average', verify: null },
  'Preferential Rent': { up: 'preferential rent income rising', down: 'preferential rent income declining', verify: null },

  // ── COST RECOVERY ────────────────────────────────────────────────────────
  'Reimbursed Water/Sewer': { up: 'water/sewer reimbursements rising — higher utility usage or rate pass-through', down: 'water/sewer reimbursements declining', verify: null },
  'Reimbursed Trash': { up: 'trash reimbursements rising', down: 'trash reimbursements declining', verify: null },
  'Reimbursed Utilities': { up: 'utility reimbursements rising — tenants paying more of utility costs', down: 'utility reimbursements declining', verify: 'energyCPI', verifyUp: 'energyCPI_rising' },
  'Other Reimbursed costs': { up: 'other cost recoveries increasing', down: 'other cost recoveries declining', verify: null },

  // ── OTHER INCOME ─────────────────────────────────────────────────────────
  'Late Fees': { up: 'late fee income rising — more late payments being collected', down: 'late fee income declining', verify: 'stateUR', verifyUp: 'stateUR_high' },
  'Pet Rent': { up: 'pet rent income rising — more pet-owning tenants or higher pet fees', down: 'pet rent declining', verify: null },
  'Parking Income': { up: 'parking income above annual average', down: 'parking income below annual average', verify: null },
  'Laundry': { up: 'laundry income rising', down: 'laundry income declining', verify: null },
  'Early Termination Fee': { up: 'early termination fees rising — more lease breaks than annual average', down: 'early termination fees declining', verify: null },
  'Bad Debt Recoveries': { up: 'bad debt recoveries improving — collecting on prior delinquencies', down: 'bad debt recoveries declining', verify: null },
  'Application Fee': { up: 'application fees rising — higher leasing activity', down: 'application fees declining — less leasing activity', verify: 'stateUR', verifyUp: 'stateUR_low' },
  'Storage Income': { up: 'storage income above annual average', down: 'storage income below annual average', verify: null },

  // ── AUTO EXPENSE ─────────────────────────────────────────────────────────
  'Gas': { up: 'fuel costs rising above annual average', down: 'fuel costs declining', verify: 'energyCPI', verifyUp: 'energyCPI_rising' },
  'Auto Insurance': { up: 'auto insurance costs rising', down: 'auto insurance costs declining', verify: null },
  'Auto Repairs': { up: 'vehicle repair costs above annual average', down: 'vehicle repair costs declining', verify: null },

  // ── G&A ──────────────────────────────────────────────────────────────────
  'Yardi expense': { up: 'property management software costs rising', down: 'software costs declining', verify: null },
  'Management Fees': { up: 'management fees above annual average — may reflect higher revenue base', down: 'management fees below annual average', verify: null },
  'Legal L & T': { up: 'legal costs rising — more eviction or tenant legal activity', down: 'legal costs declining', verify: 'stateUR', verifyUp: 'stateUR_high' },
  'Professional Fees': { up: 'professional fees above annual average', down: 'professional fees below annual average', verify: null },
  'Insurance': { up: 'insurance costs rising', down: 'insurance costs declining', verify: null },

  // ── PAYROLL ───────────────────────────────────────────────────────────────
  'Payroll - Admin Assistant Property Manager': { up: 'admin payroll rising — staffing increases or wage growth', down: 'admin payroll declining', verify: 'avgHourlyEarnings', verifyUp: 'wages_rising' },
  'Assistant Manager': { up: 'assistant manager payroll above annual average', down: 'assistant manager payroll declining', verify: 'avgHourlyEarnings', verifyUp: 'wages_rising' },
  'Payroll - Leasing': { up: 'leasing payroll rising — more leasing staff or higher wages', down: 'leasing payroll declining', verify: 'avgHourlyEarnings', verifyUp: 'wages_rising' },
  'Payroll - Maintenance': { up: 'maintenance payroll above annual average — staffing or overtime increases', down: 'maintenance payroll declining', verify: 'avgHourlyEarnings', verifyUp: 'wages_rising' },
  'Payroll - Property Manager': { up: 'property manager payroll above annual average', down: 'property manager payroll declining', verify: 'avgHourlyEarnings', verifyUp: 'wages_rising' },
  'Health Insurance - Administrative': { up: 'health insurance costs rising — benefit cost increases', down: 'health insurance costs declining', verify: null },
  'Workers Comp - Administrative': { up: 'workers comp costs rising', down: 'workers comp declining', verify: null },

  // ── TAXES AND INSURANCE ───────────────────────────────────────────────────
  'Property & Liability Insurance': { up: 'property insurance costs rising above annual average', down: 'property insurance costs declining', verify: null },
  'Real Estate Taxes': { up: 'real estate taxes above annual average — possible reassessment or rate increase', down: 'real estate taxes declining', verify: null },
  'Flood Insurance': { up: 'flood insurance costs rising', down: 'flood insurance declining', verify: 'fema', verifyUp: 'fema_active' },

  // ── UTILITIES ─────────────────────────────────────────────────────────────
  'Electric Expense': { up: 'electricity costs above annual average', down: 'electricity costs declining', verify: 'energyCPI', verifyUp: 'energyCPI_rising', weatherVerify: 'cdd_or_hdd' },
  'Gas Expense': { up: 'gas costs above annual average', down: 'gas costs declining', verify: 'energyCPI', verifyUp: 'energyCPI_rising', weatherVerify: 'hdd' },
  'Water expense': { up: 'water costs above annual average', down: 'water costs declining', verify: null },
  'Sewer Expense': { up: 'sewer costs above annual average', down: 'sewer costs declining', verify: null },
  'Rubbish Removal/Sanitation': { up: 'sanitation costs above annual average', down: 'sanitation costs declining', verify: null },

  // ── CONTRACT REPAIRS ──────────────────────────────────────────────────────
  'Snow Removal Contract': { up: 'snow removal costs above annual average', down: 'snow removal costs below annual average', verify: 'hdd', verifyUp: 'hdd_high', verifyDown: 'hdd_low', contradictNote: 'Snow removal costs are above average despite mild weather — review contract terms or extra service charges' },
  'Landscaping Contract': { up: 'landscaping costs above annual average', down: 'landscaping costs below annual average', verify: 'cdd', verifyUp: 'cdd_high' },
  'Exterminating Contract': { up: 'exterminating costs rising', down: 'exterminating costs declining', verify: null },
  'HVAC Contract': { up: 'HVAC contract costs above annual average', down: 'HVAC costs declining', verify: 'energyCPI', verifyUp: 'energyCPI_rising' },
  'Elevator Contract': { up: 'elevator maintenance costs rising', down: 'elevator costs declining', verify: null },
  'Cleaning Contract': { up: 'cleaning contract costs above annual average', down: 'cleaning costs declining', verify: null },
  'Valet Trash': { up: 'valet trash costs above annual average', down: 'valet trash costs declining', verify: null },
  'Pool Maintenance Contract': { up: 'pool maintenance costs rising — peak season or additional service', down: 'pool costs declining', verify: 'cdd', verifyUp: 'cdd_high' },

  // ── REPAIRS & MAINTENANCE ─────────────────────────────────────────────────
  'Plumbing Repairs & Maint': { up: 'plumbing repair costs above annual average', down: 'plumbing costs declining', verify: 'fema', verifyUp: 'fema_active' },
  'HVAC Repairs & Maint': { up: 'HVAC repair costs above annual average', down: 'HVAC costs declining', verify: 'energyCPI', verifyUp: 'energyCPI_rising', weatherVerify: 'cdd_or_hdd' },
  'Roof Repairs & Maint': { up: 'roof repair costs above annual average', down: 'roof costs declining', verify: 'fema', verifyUp: 'fema_active' },
  'Exterior Repairs & Maint': { up: 'exterior repair costs above annual average', down: 'exterior costs declining', verify: 'fema', verifyUp: 'fema_active' },
  'Elevator Repairs & Maint': { up: 'elevator repair costs above annual average', down: 'elevator costs declining', verify: null },
  'Interior Repairs & Maint': { up: 'interior repair costs above annual average', down: 'interior costs declining', verify: null },
  'Appliances': { up: 'appliance costs above annual average — replacements or upgrades', down: 'appliance costs declining', verify: null },
  'Paint & Plaster': { up: 'paint and plaster costs above annual average', down: 'costs declining', verify: null },
  'Leak Repair': { up: 'leak repair costs above annual average', down: 'leak costs declining', verify: 'fema', verifyUp: 'fema_active' },
  'Mold': { up: 'mold remediation costs above annual average', down: 'mold costs declining', verify: 'fema', verifyUp: 'fema_active' },

  // ── UNIT TURNOVER ─────────────────────────────────────────────────────────
  'Unit Turnover - Carpet Cleaning & Repairs': { up: 'carpet turnover costs above annual average — higher unit turnover', down: 'carpet costs declining', verify: null },
  'Unit Turnover - Painting': { up: 'unit painting costs above annual average — more units turning over', down: 'painting costs declining', verify: null },
  'Unit Turnover - Cleaning': { up: 'unit cleaning costs above annual average', down: 'cleaning costs declining', verify: null },
  'Paint & Plaster Contract': { up: 'paint and plaster contract costs above annual average', down: 'costs declining', verify: null },

  // ── OTHER EXPENSES ────────────────────────────────────────────────────────
  'Bad debts expense': { up: 'bad debt expense rising — tenant delinquencies increasing', down: 'bad debt expense declining — collections improving', verify: 'stateUR', verifyUp: 'stateUR_high', contradictNote: 'Bad debt is rising despite a healthy labor market — may reflect property-specific tenant issues rather than broad economic stress' },
  'Property Inspection': { up: 'property inspection costs above annual average', down: 'inspection costs declining', verify: null },
  'Violation Penalty': { up: 'violation penalties above annual average — compliance issues', down: 'penalties declining', verify: null },
  'Interest Expense': { up: 'interest expense declining — lower debt costs', down: 'interest expense rising above annual average — higher financing costs', verify: 'fedfunds', verifyDown: 'fedfunds_high' },
  'Damages Fee': { up: 'damage fee income rising — more tenant damage charges collected', down: 'damage fee income declining', verify: null },
  'Cleaning Fee': { up: 'cleaning fee income rising', down: 'cleaning fee income declining', verify: null },
  'Furnished Unit Expenses': { up: 'furnished unit costs declining', down: 'furnished unit expenses rising', verify: null },
  'Miscellaneous': { up: 'miscellaneous income rising', down: 'miscellaneous income declining', verify: null },
  'Amenity Fee': { up: 'amenity fee income above annual average', down: 'amenity fee income declining', verify: null },
  'Administrative Fee': { up: 'administrative fee income above annual average', down: 'administrative fee income declining', verify: null },
};

function getVerificationStatus(metricName, direction, externalContext) {
  const interp = METRIC_INTERPRETATIONS[metricName];
  if (!interp || !interp.verify) return 'unverified';

  const { rentCPI, stateUR, energyCPI, hdd, cdd, fema, avgHourlyEarnings, fedfunds } = externalContext || {};
  const isUp = direction === 'up';
  const verifyKey = isUp ? interp.verifyUp : interp.verifyDown;

  switch (verifyKey) {
    case 'rentCPI_rising': {
      if (rentCPI == null) return 'unverified';
      return rentCPI > 310 ? 'confirmed' : 'contradicted';
    }
    case 'rentCPI_falling': {
      if (rentCPI == null) return 'unverified';
      return rentCPI < 305 ? 'confirmed' : 'contradicted';
    }
    case 'stateUR_low': {
      if (stateUR == null) return 'unverified';
      return stateUR < 4.5 ? 'confirmed' : stateUR > 6 ? 'contradicted' : 'unverified';
    }
    case 'stateUR_high': {
      if (stateUR == null) return 'unverified';
      return stateUR > 5.5 ? 'confirmed' : stateUR < 4 ? 'contradicted' : 'unverified';
    }
    case 'energyCPI_rising': {
      if (energyCPI == null) return 'unverified';
      return energyCPI > 320 ? 'confirmed' : energyCPI < 300 ? 'contradicted' : 'unverified';
    }
    case 'hdd_high': {
      if (hdd == null) return 'unverified';
      return hdd > 400 ? 'confirmed' : hdd < 100 ? 'contradicted' : 'unverified';
    }
    case 'hdd_low': {
      if (hdd == null) return 'unverified';
      return hdd < 100 ? 'confirmed' : hdd > 400 ? 'contradicted' : 'unverified';
    }
    case 'cdd_high': {
      if (cdd == null) return 'unverified';
      return cdd > 50 ? 'confirmed' : cdd < 10 ? 'contradicted' : 'unverified';
    }
    case 'fedfunds_high': {
      if (fedfunds == null) return 'unverified';
      return fedfunds > 4 ? 'confirmed' : fedfunds < 2 ? 'contradicted' : 'unverified';
    }
    case 'fema_active': {
      if (!fema || fema.length === 0) return 'unverified';
      return fema.length > 0 ? 'confirmed' : 'unverified';
    }
    case 'wages_rising': {
      if (avgHourlyEarnings == null) return 'unverified';
      return avgHourlyEarnings > 30 ? 'confirmed' : 'unverified';
    }
    default:
      return 'unverified';
  }
}

function generateReasoning(data) {
  const {
    categoryName, section, monthLabel, stateAbbr,
    dominantDriver, dominantPct, topDrivers, activeDrivers, compositionType,
    trendType, oaContext, portfolioContext, externalContext,
    seasonalPattern, flag,
  } = data;

  const { stateUR, mortgage30, hdd, cdd, energyCPI, avgHourlyEarnings, fema } = externalContext || {};

  const isIncome = section === 'INCOME';
  const fmt = n => '$' + Math.round(Math.abs(n || 0)).toLocaleString();
  const sentences = [];

  const triggeredByPrior = flag.flaggedByPrior;
  const triggeredByT12 = flag.flaggedByT12;
  const conflicting = flag.conflicting;

  // ── Opening: what triggered the anomaly ──────────────────────────────────
  if (triggeredByPrior && triggeredByT12 && !conflicting) {
    sentences.push(`${categoryName} is running ${fmt(Math.abs(flag.T3_current - flag.T3_prior))} above the prior quarter run rate and ${fmt(Math.abs(flag.T3_current - flag.T12))} above the annual baseline — both short-term momentum and structural drift are flagged.`);
  } else if (triggeredByPrior && !triggeredByT12) {
    const dir = flag.T3_current > flag.T3_prior ? 'above' : 'below';
    sentences.push(`${categoryName} shifted ${fmt(Math.abs(flag.T3_current - flag.T3_prior))} ${dir} the prior quarter run rate — a short-term momentum change.`);
  } else if (triggeredByT12 && !triggeredByPrior) {
    const dir = flag.T3_current > flag.T12 ? 'above' : 'below';
    sentences.push(`${categoryName} is running ${fmt(Math.abs(flag.T3_current - flag.T12))} ${dir} the trailing 12-month baseline — a structural drift from the annual average.`);
  } else if (conflicting) {
    sentences.push(`${categoryName} shows conflicting signals — short-term momentum and the annual baseline are pointing in opposite directions.`);
  }

  // ── First appearance drivers ──────────────────────────────────────────────
  const firstAppearanceDrivers = topDrivers.filter(d => d.firstAppearance);
  if (firstAppearanceDrivers.length > 0) {
    firstAppearanceDrivers.forEach(d => {
      const interp = METRIC_INTERPRETATIONS[d.name];
      const interpText = interp ? (d.direction === 'up' ? interp.up : interp.down) : null;
      let faSentence = `${d.name} appeared for the first time this quarter at ${fmt(d.absMovement)}`;
      if (interpText) faSentence += ` — ${interpText}`;
      faSentence += `. No prior activity in the trailing 12 months.`;
      sentences.push(faSentence);
    });
  }

  // ── Dominant driver ───────────────────────────────────────────────────────
  const firstAppearanceNames = firstAppearanceDrivers.map(d => d.name);
  const remainingDrivers = topDrivers.slice(0, 3).filter(d => !firstAppearanceNames.includes(d.name));
  if (remainingDrivers.length >= 1) {
    const reference = triggeredByT12 && !triggeredByPrior ? 'vs the annual baseline' : 'vs the prior quarter';

    const driverSentences = remainingDrivers.map(d => {
      const interp = METRIC_INTERPRETATIONS[d.name];
      const interpText = interp ? (d.direction === 'up' ? interp.up : interp.down) : null;
      const verification = getVerificationStatus(d.name, d.direction, externalContext);
      const sign = d.movement >= 0 ? '+' : '-';
      const amount = `${sign}${fmt(d.absMovement)}`;

      let sentence = `${d.name} (${amount} ${reference})`;
      if (interpText) sentence += ` — ${interpText}`;

      if (verification === 'confirmed') {
        sentence += ` [confirmed by market data]`;
      } else if (verification === 'contradicted') {
        const contradictNote = interp?.contradictNote;
        if (contradictNote) {
          sentence += ` ⚠ ${contradictNote}`;
        } else {
          sentence += ` ⚠ market data points in the opposite direction`;
        }
      }

      return sentence;
    });

    sentences.push(driverSentences.join('. ') + '.');
  }

  // ── Counter-movement driver ───────────────────────────────────────────────
  const categoryDir = flag.T3_current > (triggeredByT12 && !triggeredByPrior ? flag.T12 : flag.T3_prior) ? 'up' : 'down';
  const topThreeNames = topDrivers.slice(0, 3).map(d => d.name);
  const counterDrivers = (activeDrivers || [])
    .filter(d => d.direction !== categoryDir && !topThreeNames.includes(d.name))
    .filter(d => dominantDriver && d.absMovement >= dominantDriver.absMovement * 0.10)
    .slice(0, 1);
  if (counterDrivers.length > 0) {
    const cd = counterDrivers[0];
    const interp = METRIC_INTERPRETATIONS[cd.name];
    const interpText = interp ? (cd.direction === 'up' ? interp.up : interp.down) : null;
    const sign = cd.movement >= 0 ? '+' : '-';
    const reference = triggeredByT12 && !triggeredByPrior ? 'vs the annual baseline' : 'vs the prior quarter';
    let counterSentence = `Partially offset by ${cd.name} (${sign}${fmt(cd.absMovement)} ${reference})`;
    if (interpText) counterSentence += ` — ${interpText}`;
    sentences.push(counterSentence + '.');
  }

  // ── Composition ───────────────────────────────────────────────────────────
  if (compositionType === 'mixed' && topDrivers.length >= 2) {
    const ups = topDrivers.filter(m => m.direction === 'up');
    const downs = topDrivers.filter(m => m.direction === 'down');
    if (ups.length > 0 && downs.length > 0) {
      sentences.push(`Partially offset — ${ups.map(m => m.name).join(' and ')} moving up while ${downs.map(m => m.name).join(' and ')} moving down.`);
    }
  }

  // ── Trend ─────────────────────────────────────────────────────────────────
  if (triggeredByPrior && !triggeredByT12) {
    if (trendType === 'accelerating') {
      sentences.push(`Momentum is accelerating — the gap between current and prior quarter T3 is widening each month.`);
    } else if (trendType === 'decelerating') {
      sentences.push(`Momentum is decelerating — the gap between current and prior quarter T3 is shrinking each month.`);
    }
  }

  // ── Seasonal ──────────────────────────────────────────────────────────────
  if (seasonalPattern?.recurring) {
    sentences.push(`This pattern has appeared in ${monthLabel.split(' ')[0]} in prior years (${seasonalPattern.years.join(', ')}) — a likely seasonal component.`);
  }

  // ── Portfolio context ─────────────────────────────────────────────────────
  const sameState = portfolioContext.filter(p => p.locationProximity === 'same-state');
  const sameRegion = portfolioContext.filter(p => p.locationProximity === 'same-region');
  if (sameState.length >= 2) {
    sentences.push(`${sameState.length} other ${stateAbbr} properties show similar movement — likely a state-level driver.`);
  } else if (sameRegion.length >= 2) {
    sentences.push(`${sameRegion.length} regional properties show similar movement — consistent with a broader trend.`);
  }

  // ── External context — only when it directly explains the dominant driver ──
  const dominantName = dominantDriver?.name || '';
  const catLower = categoryName.toLowerCase();

  if (section === 'INCOME') {
    const rentDriven = ['Market Rent', 'Less: Vacancy', 'Concession', 'Residential Rent', '(Loss)/Gain to Lease'].includes(dominantName);
    if (rentDriven && stateUR != null) {
      const laborCtx = stateUR < 4 ? 'tight labor market supporting rental demand'
        : stateUR > 6 ? 'elevated unemployment may be pressuring demand'
        : null;
      if (laborCtx) sentences.push(`${stateAbbr} unemployment at ${stateUR.toFixed(1)}% — ${laborCtx}.`);
    }
  } else if (catLower.includes('utilit')) {
    const utilDriven = ['Electric Expense', 'Gas Expense', 'Water expense'].includes(dominantName);
    if (utilDriven) {
      if (hdd != null && hdd > 400) sentences.push(`${hdd} heating degree days in ${stateAbbr} — cold weather driving utility costs.`);
      else if (cdd != null && cdd > 150) sentences.push(`${cdd} cooling degree days — summer heat elevating utility demand.`);
    }
  } else if (catLower.includes('payroll')) {
    const payrollDriven = dominantName.toLowerCase().includes('payroll') || dominantName.toLowerCase().includes('salary') || dominantName.toLowerCase().includes('salaries');
    if (payrollDriven && avgHourlyEarnings != null && avgHourlyEarnings > 30) {
      sentences.push(`National avg hourly earnings at $${avgHourlyEarnings.toFixed(2)} — wage growth context for payroll costs.`);
    }
  } else if (catLower.includes('repair') || catLower.includes('maintenance')) {
    const repairDriven = dominantName.toLowerCase().includes('repair') || dominantName.toLowerCase().includes('maint');
    if (repairDriven && fema && fema.length > 0) {
      sentences.push(`FEMA disaster declarations active in ${stateAbbr} — may be driving elevated repair costs.`);
    }
  } else if (catLower.includes('contract')) {
    if (dominantName === 'Snow Removal Contract' && hdd != null) {
      if (hdd > 400) sentences.push(`${hdd} heating degree days in ${stateAbbr} — cold weather consistent with elevated snow removal costs.`);
      else if (hdd < 100) sentences.push(`Low heating degree days in ${stateAbbr} — mild weather makes elevated snow removal costs unexpected.`);
    }
  }

  // ── Trim to 200 words ─────────────────────────────────────────────────────
  let result = sentences.join(' ');
  const words = result.split(' ');
  if (words.length > 210) result = words.slice(0, 200).join(' ') + '…';

  return result || `${categoryName} moved ${fmt(Math.abs(flag.T3_current - flag.T3_prior))} vs the prior quarter in ${monthLabel}. Review individual metric breakdown above for details.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const SUPABASE_URL      = process.env.SUPABASE_URL;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  const {
    categoryName,
    section,
    monthLabel,
    metricBreakdown,   // [{name, T3_current, T3_prior, T12, values}]
    flag,              // full flag object
    stateAbbr,
    city,
    propertyName,
    purchasePrice,
    recentCategoryT3,  // last 3 months of category T3: [{monthLabel, T3}]
    fema,              // FEMA disaster declarations array (optional, from client)
  } = req.body;

  const parsed = parseMonthLabel(monthLabel);
  if (!parsed) return res.status(400).json({ error: 'Invalid monthLabel' });

  const startDate = `${parsed.year - 1}-${String(parsed.month).padStart(2,'0')}-01`;
  const endDate = `${parsed.year}-${String(parsed.month).padStart(2,'0')}-01`;

  // ── Step 1: Dominant driver ──────────────────────────────────────────────
  // T3 momentum drivers — which metric moved most vs prior quarter
  const t3Drivers = (metricBreakdown || [])
    .map(m => ({
      name: m.name,
      movement: (m.T3_current || 0) - (m.T3_prior || 0),
      absMovement: Math.abs((m.T3_current || 0) - (m.T3_prior || 0)),
      direction: (m.T3_current || 0) >= (m.T3_prior || 0) ? 'up' : 'down',
      T3_current: m.T3_current,
      T3_prior: m.T3_prior,
      T12: m.T12,
      firstAppearance: (m.T3_prior === 0 || m.T3_prior == null) && Math.abs(m.T3_current || 0) > 0,
    }))
    .filter(m => m.absMovement > 0)
    .sort((a, b) => b.absMovement - a.absMovement);

  // T12 drift drivers — which metric's current T3 diverges most from T12
  const t12Drivers = (metricBreakdown || [])
    .map(m => ({
      name: m.name,
      movement: (m.T3_current || 0) - (m.T12 || 0),
      absMovement: Math.abs((m.T3_current || 0) - (m.T12 || 0)),
      direction: (m.T3_current || 0) >= (m.T12 || 0) ? 'up' : 'down',
      T3_current: m.T3_current,
      T3_prior: m.T3_prior,
      T12: m.T12,
      firstAppearance: (m.T12 === 0 || m.T12 == null) && Math.abs(m.T3_current || 0) > 0,
    }))
    .filter(m => m.absMovement > 0)
    .sort((a, b) => b.absMovement - a.absMovement);

  // Pick active drivers based on trigger
  const activeDrivers = flag.flaggedByPrior ? t3Drivers : t12Drivers;
  const dominantDriver = activeDrivers[0] || null;
  const totalMovement = flag.flaggedByPrior
    ? (flag.T3_current - flag.T3_prior)
    : (flag.T3_current - flag.T12);
  const dominantPct = dominantDriver && totalMovement !== 0
    ? Math.round((dominantDriver.movement / totalMovement) * 100)
    : null;
  const topDrivers = activeDrivers.slice(0, 3);

  // ── Step 2: Composition analysis ────────────────────────────────────────
  const upCount = activeDrivers.filter(m => m.direction === 'up').length;
  const downCount = activeDrivers.filter(m => m.direction === 'down').length;
  let compositionType;
  if (upCount === 0 || downCount === 0) compositionType = 'broad-based';
  else if (dominantPct && Math.abs(dominantPct) >= 60) compositionType = 'single-driver';
  else compositionType = 'mixed';

  // ── Step 3: Trend acceleration ───────────────────────────────────────────
  let trendType = 'unknown';
  if (recentCategoryT3 && recentCategoryT3.length >= 2) {
    // Each entry has { monthLabel, T3, T3_prior }
    // Compute the T3 vs T3_prior gap for each recent month
    const gaps = recentCategoryT3
      .filter(r => r.T3 != null && r.T3_prior != null)
      .map(r => Math.abs(r.T3 - r.T3_prior));

    if (gaps.length >= 2) {
      const isAccelerating = gaps.every((g, i) => i === 0 || g >= gaps[i-1]);
      const isDecelerating = gaps.every((g, i) => i === 0 || g <= gaps[i-1]);
      if (isAccelerating) trendType = 'accelerating';
      else if (isDecelerating) trendType = 'decelerating';
      else trendType = 'volatile';
    }
  }

  // ── Step 4: OA context from Supabase ────────────────────────────────────
  let oaContext = [];
  try {
    const oaRes = await sbFetch(
      SUPABASE_URL, SUPABASE_ANON_KEY,
      `/analyses?property_name=eq.${encodeURIComponent(propertyName)}&select=anomalies,property_name&limit=10`,
      { method: 'GET' }
    );
    const analyses = oaRes.ok ? await oaRes.json() : null;

    if (analyses) {
      analyses.forEach(analysis => {
        const anomalies = typeof analysis.anomalies === 'string'
          ? JSON.parse(analysis.anomalies) : (analysis.anomalies || []);
        anomalies.forEach(a => {
          if (a.monthLabel === monthLabel &&
              (metricBreakdown || []).some(m => m.name === a.metricName)) {
            oaContext.push({
              metricName: a.metricName,
              angle: a.angle,
              primaryLabel: a.primary?.label || '',
              section: a.section,
            });
          }
        });
      });
    }
  } catch(e) {}

  // ── Step 5: Portfolio context from Supabase ──────────────────────────────
  let portfolioContext = [];
  try {
    const portRes = await sbFetch(
      SUPABASE_URL, SUPABASE_ANON_KEY,
      `/analyses?property_name=neq.${encodeURIComponent(propertyName)}&select=anomalies,property_name,state_abbr&limit=50`,
      { method: 'GET' }
    );
    const allAnalyses = portRes.ok ? await portRes.json() : null;

    if (allAnalyses) {
      const propertyRegion = getRegion(stateAbbr);
      allAnalyses.forEach(analysis => {
        const anomalies = typeof analysis.anomalies === 'string'
          ? JSON.parse(analysis.anomalies) : (analysis.anomalies || []);
        const matchingAnomalies = anomalies.filter(a =>
          a.monthLabel === monthLabel &&
          (metricBreakdown || []).some(m => m.name === a.metricName)
        );
        if (matchingAnomalies.length > 0) {
          const propRegion = getRegion(analysis.state_abbr || '');
          const locationProximity = analysis.state_abbr === stateAbbr ? 'same-state'
            : propRegion === propertyRegion ? 'same-region' : 'different-region';
          portfolioContext.push({
            propertyName: analysis.property_name,
            stateAbbr: analysis.state_abbr,
            locationProximity,
            anomalyCount: matchingAnomalies.length,
            directions: matchingAnomalies.map(a => a.direction || ''),
          });
        }
      });
    }
  } catch(e) {}

  // ── Step 6: External context ─────────────────────────────────────────────
  const externalContext = {};
  try {
    const [fedfunds, rentCPI, stateUR, energyCPI, mortgage30, avgHourlyEarningsSeries] = await Promise.all([
      fetchFREDSeries('FEDFUNDS', startDate, endDate),
      fetchFREDSeries('CUUR0000SEHA', startDate, endDate),
      fetchFREDSeries(FRED_UR_MAP[stateAbbr] || 'UNRATE', startDate, endDate),
      fetchFREDSeries('CUUR0000SEHE', startDate, endDate),
      fetchFREDSeries('MORTGAGE30US', startDate, endDate),
      fetchFREDSeries('CES0500000003', startDate, endDate),
    ]);
    externalContext.fedfunds = fedfunds[monthLabel];
    externalContext.rentCPI = rentCPI[monthLabel];
    externalContext.stateUR = stateUR[monthLabel];
    externalContext.energyCPI = energyCPI[monthLabel];
    externalContext.mortgage30 = mortgage30[monthLabel];
    externalContext.avgHourlyEarnings = avgHourlyEarningsSeries[monthLabel];
    externalContext.fema = fema || [];
  } catch(e) {}

  // Fetch weather
  try {
    const coords = STATE_CENTROIDS[stateAbbr];
    if (coords) {
      const weatherRes = await fetch(
        `https://archive-api.open-meteo.com/v1/archive?latitude=${coords[0]}&longitude=${coords[1]}&start_date=${startDate}&end_date=${endDate}&daily=temperature_2m_max,temperature_2m_min&timezone=auto&temperature_unit=fahrenheit`
      );
      const weatherData = await weatherRes.json();
      const dates = weatherData?.daily?.time || [];
      const maxT = weatherData?.daily?.temperature_2m_max || [];
      const minT = weatherData?.daily?.temperature_2m_min || [];
      let hdd = 0, cdd = 0, count = 0;
      dates.forEach((dateStr, i) => {
        const d = new Date(dateStr);
        const label = `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
        if (label === monthLabel) {
          const avg = ((maxT[i]||0) + (minT[i]||0)) / 2;
          hdd += Math.max(0, 65 - avg);
          cdd += Math.max(0, avg - 65);
          count++;
        }
      });
      externalContext.hdd = Math.round(hdd);
      externalContext.cdd = Math.round(cdd);
    }
  } catch(e) {}

  // ── Step 7: Seasonal check ───────────────────────────────────────────────
  let seasonalPattern = null;
  try {
    const seasonRes = await sbFetch(
      SUPABASE_URL, SUPABASE_ANON_KEY,
      `/analyses?property_name=eq.${encodeURIComponent(propertyName)}&select=anomalies&limit=20`,
      { method: 'GET' }
    );
    const historicalAnalyses = seasonRes.ok ? await seasonRes.json() : null;

    if (historicalAnalyses) {
      const sameMonthPriorYears = [];
      historicalAnalyses.forEach(analysis => {
        const anomalies = typeof analysis.anomalies === 'string'
          ? JSON.parse(analysis.anomalies) : (analysis.anomalies || []);
        anomalies.forEach(a => {
          const aParsed = parseMonthLabel(a.monthLabel);
          if (aParsed && aParsed.month === parsed.month && aParsed.year < parsed.year &&
              (metricBreakdown || []).some(m => m.name === a.metricName)) {
            sameMonthPriorYears.push({ year: aParsed.year, metricName: a.metricName });
          }
        });
      });
      if (sameMonthPriorYears.length >= 2) {
        seasonalPattern = {
          recurring: true,
          occurrences: sameMonthPriorYears.length,
          years: [...new Set(sameMonthPriorYears.map(s => s.year))].sort(),
        };
      }
    }
  } catch(e) {}

  // ── Return structured reasoning data ─────────────────────────────────────
  const reasoning = generateReasoning({
    categoryName, section, monthLabel, stateAbbr,
    dominantDriver, dominantPct, topDrivers, activeDrivers, compositionType,
    trendType, oaContext, portfolioContext, externalContext,
    seasonalPattern, flag,
  });

  return res.status(200).json({
    categoryName,
    section,
    monthLabel,
    stateAbbr,
    propertyName,
    t3Drivers,
    t12Drivers,
    dominantDriver,
    dominantPct,
    topDrivers,
    compositionType,
    trendType,
    oaContext,
    portfolioContext,
    externalContext,
    seasonalPattern,
    flag,
    reasoning,
  });
}
