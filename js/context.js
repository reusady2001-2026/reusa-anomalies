// ============================================================
// CONTEXT.JS — Location selector data, API fetching, caching
// ============================================================

const Context = (() => {

  // ── API KEYS ──────────────────────────────────────────
  const FRED_KEY     = '85a8199d1263218d54ad0b86cfaf26db';
  const CONGRESS_KEY = 'WV28fUlsauhfLvzLwSUKTeNEZ1KJNteeY69AfbPP';

  // ── CORS PROXY ────────────────────────────────────────
  // All external API calls are routed through a CORS proxy when the app is
  // running from a browser origin that the API servers don't whitelist.
  const CORS_PROXY = 'https://corsproxy.io/?url=';
  function proxied(url) {
    try {
      const host = new URL(url).hostname;
      if (host === location.hostname || host === 'localhost' || host === '127.0.0.1') return url;
    } catch (_) { return url; }
    return CORS_PROXY + encodeURIComponent(url);
  }

  // ── STATE ABBREVIATION MAP ────────────────────────────
  const STATE_ABBR = {
    'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA',
    'Colorado':'CO','Connecticut':'CT','Delaware':'DE','Florida':'FL','Georgia':'GA',
    'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA',
    'Kansas':'KS','Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD',
    'Massachusetts':'MA','Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO',
    'Montana':'MT','Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ',
    'New Mexico':'NM','New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH',
    'Oklahoma':'OK','Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
    'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
    'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  };

  // FRED unemployment series per state
  const FRED_UR = {
    'AL':'ALUR','AK':'AKUR','AZ':'AZUR','AR':'ARUR','CA':'CAUR','CO':'COUR','CT':'CTUR',
    'DE':'DEUR','FL':'FLUR','GA':'GAUR','HI':'HIUR','ID':'IDUR','IL':'ILUR','IN':'INUR',
    'IA':'IAUR','KS':'KSUR','KY':'KYUR','LA':'LAUR','ME':'MEUR','MD':'MDUR','MA':'MAUR',
    'MI':'MIUR','MN':'MNUR','MS':'MSUR','MO':'MOUR','MT':'MTUR','NE':'NEUR','NV':'NVUR',
    'NH':'NHUR','NJ':'NJUR','NM':'NMUR','NY':'NYUR','NC':'NCUR','ND':'NDUR','OH':'OHUR',
    'OK':'OKUR','OR':'ORUR','PA':'PAUR','RI':'RIUR','SC':'SCUR','SD':'SDUR','TN':'TNUR',
    'TX':'TXUR','UT':'UTUR','VT':'VTUR','VA':'VAUR','WA':'WAUR','WV':'WVUR','WI':'WIUR',
    'WY':'WYUR',
  };

  // Census state FIPS codes
  const STATE_FIPS = {
    'AL':'01','AK':'02','AZ':'04','AR':'05','CA':'06','CO':'08','CT':'09','DE':'10',
    'FL':'12','GA':'13','HI':'15','ID':'16','IL':'17','IN':'18','IA':'19','KS':'20',
    'KY':'21','LA':'22','ME':'23','MD':'24','MA':'25','MI':'26','MN':'27','MS':'28',
    'MO':'29','MT':'30','NE':'31','NV':'32','NH':'33','NJ':'34','NM':'35','NY':'36',
    'NC':'37','ND':'38','OH':'39','OK':'40','OR':'41','PA':'42','RI':'44','SC':'45',
    'SD':'46','TN':'47','TX':'48','UT':'49','VT':'50','VA':'51','WA':'53','WV':'54',
    'WI':'55','WY':'56',
  };

  // ── STATE → CITIES MAP ────────────────────────────────
  const STATE_CITIES = {
    'Alabama':['Birmingham','Montgomery','Huntsville','Mobile','Tuscaloosa','Hoover','Dothan','Auburn','Decatur','Madison','Florence','Gadsden','Vestavia Hills','Prattville','Phenix City','Northport','Alabaster','Daphne','Opelika','Enterprise','Bessemer','Athens','Homewood','Pelham','Fairhope'],
    'Alaska':['Anchorage','Fairbanks','Juneau','Sitka','Ketchikan','Wasilla','Kenai','Kodiak','Bethel','Palmer','Homer','Unalaska','Soldotna','Valdez','Nome','Barrow','Seward','Wrangell','Petersburg','Cordova'],
    'Arizona':['Phoenix','Tucson','Mesa','Chandler','Scottsdale','Glendale','Gilbert','Tempe','Peoria','Surprise','Goodyear','Avondale','Flagstaff','Buckeye','Yuma','Casa Grande','Prescott','Maricopa','Apache Junction','Lake Havasu City','Oro Valley','Sierra Vista','Scottsdale','Kingman','Bullhead City'],
    'Arkansas':['Little Rock','Fort Smith','Fayetteville','Springdale','Jonesboro','North Little Rock','Conway','Rogers','Pine Bluff','Bentonville','Hot Springs','Benton','Texarkana','Sherwood','Jacksonville','Russellville','Bella Vista','West Memphis','Paragould','Cabot','Searcy','Van Buren','El Dorado','Marion','Bryant'],
    'California':['Los Angeles','San Diego','San Jose','San Francisco','Fresno','Sacramento','Long Beach','Oakland','Bakersfield','Anaheim','Santa Ana','Riverside','Stockton','Irvine','Chula Vista','Fremont','San Bernardino','Modesto','Fontana','Moreno Valley','Glendale','Huntington Beach','Santa Clarita','Garden Grove','Santa Rosa'],
    'Colorado':['Denver','Colorado Springs','Aurora','Fort Collins','Lakewood','Thornton','Arvada','Westminster','Pueblo','Centennial','Boulder','Highlands Ranch','Greeley','Longmont','Loveland','Broomfield','Castle Rock','Commerce City','Parker','Northglenn','Brighton','Littleton','Englewood','Wheat Ridge','Lafayette'],
    'Connecticut':['Bridgeport','New Haven','Hartford','Stamford','Waterbury','Norwalk','Danbury','New Britain','Greenwich','Meriden','West Hartford','Middletown','Torrington','Shelton','Norwalk','Milford','West Haven','Bristol','Stratford','East Hartford','Naugatuck','Enfield','Manchester','Southington','Hamden'],
    'Delaware':['Wilmington','Dover','Newark','Middletown','Bear','Glasgow','Hockessin','Smyrna','Milford','Seaford','Georgetown','Elsmere','New Castle','Edgemoor','Claymont','Lewes','Rehoboth Beach','Laurel','Harrington','Camden','Brookside','Pike Creek','Greenville','Talleyville','Odessa'],
    'Florida':['Jacksonville','Miami','Tampa','Orlando','St. Petersburg','Hialeah','Port St. Lucie','Cape Coral','Tallahassee','Fort Lauderdale','Pembroke Pines','Hollywood','Gainesville','Miramar','Coral Springs','Palm Bay','Clearwater','Pompano Beach','West Palm Beach','Lakeland','Davie','Miami Gardens','Boca Raton','Deltona','Plantation'],
    'Georgia':['Atlanta','Columbus','Augusta','Savannah','Athens','Sandy Springs','Roswell','Macon','Albany','Warner Robins','Alpharetta','Marietta','Smyrna','Valdosta','Gainesville','Peachtree City','South Fulton','Stonecrest','Johns Creek','Mableton','Kennesaw','Milton','Rome','Woodstock','Dunwoody'],
    'Hawaii':['Honolulu','Pearl City','Hilo','Kailua','Waipahu','Kaneohe','Mililani','Kahului','Ewa Beach','Kapolei','Kihei','Kailua-Kona','Makakilo','Waimalu','Aiea','Wailuku','Halawa','Royal Kunia','Nanakuli','Waianae','Schofield Barracks','Wahiawa','Kula','Lahaina','Lihue'],
    'Idaho':['Boise','Nampa','Meridian','Idaho Falls','Pocatello','Caldwell','Coeur d\'Alene','Twin Falls','Lewiston','Post Falls','Rexburg','Moscow','Eagle','Kuna','Ammon','Chubbuck','Hayden','Mountain Home','Blackfoot','Jerome','Burley','American Falls','Sandpoint','Hailey','Garden City'],
    'Illinois':['Chicago','Aurora','Joliet','Naperville','Rockford','Springfield','Elgin','Peoria','Champaign','Evanston','Decatur','Bloomington','Waukegan','Cicero','Schaumburg','Bolingbrook','Palatine','Arlington Heights','Skokie','Des Plaines','Orland Park','Oak Park','Tinley Park','Berwyn','Downers Grove'],
    'Indiana':['Indianapolis','Fort Wayne','Evansville','South Bend','Carmel','Fishers','Bloomington','Hammond','Gary','Muncie','Lafayette','Terre Haute','Kokomo','Anderson','Noblesville','Greenwood','Elkhart','Mishawaka','Lawrence','Jeffersonville','Columbus','Portage','New Albany','Richmond','Westfield'],
    'Iowa':['Des Moines','Cedar Rapids','Davenport','Sioux City','Iowa City','Waterloo','Council Bluffs','Ames','West Des Moines','Dubuque','Ankeny','Urbandale','Cedar Falls','Marion','Bettendorf','Mason City','Marshalltown','Clinton','Burlington','Ottumwa','Fort Dodge','Waukee','Coralville','Johnston','Clive'],
    'Kansas':['Wichita','Overland Park','Kansas City','Olathe','Topeka','Lawrence','Shawnee','Manhattan','Lenexa','Salina','Hutchinson','Leavenworth','Leawood','Prairie Village','Emporia','Garden City','Liberal','Derby','Hays','Dodge City','Junction City','Great Bend','Newton','McPherson','El Dorado'],
    'Kentucky':['Louisville','Lexington','Bowling Green','Owensboro','Covington','Richmond','Georgetown','Florence','Elizabethtown','Nicholasville','Hopkinsville','Frankfort','Henderson','Jeffersontown','Paducah','Erlanger','Independence','Radcliff','Ashland','Murray','Danville','Madisonville','Union','Florence','Shively'],
    'Louisiana':['New Orleans','Baton Rouge','Shreveport','Metairie','Lafayette','Lake Charles','Kenner','Bossier City','Monroe','Alexandria','Marrero','New Iberia','Laplace','Slidell','Hammond','Houma','Central','Zachary','Bayou Cane','Prairieville','Harvey','Terrytown','Ruston','Pineville','Sulphur'],
    'Maine':['Portland','Lewiston','Bangor','South Portland','Auburn','Biddeford','Sanford','Saco','Westbrook','Augusta','Waterville','Brewer','Orono','Windham','Scarborough','Gorham','Ellsworth','Rockland','Bath','Brunswick','Belfast','Presque Isle','Caribou','Old Town','Skowhegan'],
    'Maryland':['Baltimore','Columbia','Germantown','Silver Spring','Waldorf','Frederick','Ellicott City','Glen Burnie','Gaithersburg','Rockville','Bethesda','Dundalk','Towson','Bowie','Annapolis','Hagerstown','Essex','Aspen Hill','Wheaton','College Park','Greenbelt','Upper Marlboro','Catonsville','Severn','Largo'],
    'Massachusetts':['Boston','Worcester','Springfield','Lowell','Cambridge','New Bedford','Brockton','Quincy','Lynn','Fall River','Newton','Lawrence','Somerville','Framingham','Haverhill','Waltham','Medford','Taunton','Chicopee','Weymouth','Revere','Peabody','Methuen','Barnstable','Pittsfield'],
    'Michigan':['Detroit','Grand Rapids','Warren','Sterling Heights','Ann Arbor','Lansing','Flint','Dearborn','Livonia','Westland','Troy','Farmington Hills','Kalamazoo','Wyoming','Saginaw','Southfield','Pontiac','Roseville','Dearborn Heights','Rochester Hills','Taylor','Royal Oak','Novi','Waterford','Eastpointe'],
    'Minnesota':['Minneapolis','St. Paul','Rochester','Duluth','Brooklyn Park','Plymouth','St. Cloud','Eagan','Woodbury','Coon Rapids','Bloomington','Apple Valley','Edina','Burnsville','Maple Grove','Eden Prairie','Blaine','Lakeville','Minnetonka','Mankato','Maplewood','St. Louis Park','Moorhead','Oakdale','Fridley'],
    'Mississippi':['Jackson','Gulfport','Southaven','Hattiesburg','Biloxi','Meridian','Tupelo','Olive Branch','Greenville','Horn Lake','Pearl','Madison','Brandon','Clinton','Ridgeland','Starkville','Columbus','Vicksburg','Pascagoula','Oxford','Gautier','Ocean Springs','D\'Iberville','Hernando','Moss Point'],
    'Missouri':['Kansas City','St. Louis','Springfield','Columbia','Independence','Lee\'s Summit','O\'Fallon','St. Joseph','St. Charles','Blue Springs','Joplin','Chesterfield','Jefferson City','Cape Girardeau','Florissant','Lees Summit','Wildwood','Raytown','Liberty','Wentzville','Belton','University City','Kirkwood','Hazelwood','Ballwin'],
    'Montana':['Billings','Missoula','Great Falls','Bozeman','Butte','Helena','Kalispell','Havre','Anaconda','Miles City','Belgrade','Livingston','Laurel','Whitefish','Lewistown','Glasgow','Sidney','Glendive','Columbia Falls','Polson','Hardin','Lolo','Hamilton','Dillon','Wolf Point'],
    'Nebraska':['Omaha','Lincoln','Bellevue','Grand Island','Kearney','Fremont','Hastings','North Platte','Norfolk','Columbus','Papillion','La Vista','Scottsbluff','South Sioux City','Beatrice','Gering','Alliance','Lexington','Seward','York','Blair','McCook','Nebraska City','Plattsmouth','Schuyler'],
    'Nevada':['Las Vegas','Henderson','Reno','North Las Vegas','Sparks','Carson City','Fernley','Elko','Mesquite','Boulder City','Enterprise','Sunrise Manor','Paradise','Whitney','Summerlin South','Spring Valley','Winchester','Gardnerville','Minden','Fallon','Winnemucca','Battle Mountain','Pahrump','Laughlin','Tonopah'],
    'New Hampshire':['Manchester','Nashua','Concord','Derry','Dover','Rochester','Salem','Merrimack','Hudson','Keene','Amherst','Londonderry','Claremont','Laconia','Lebanon','Portsmouth','Exeter','Goffstown','Bedford','Milford','Hampton','Hooksett','Windham','Pelham','Gilford'],
    'New Jersey':['Newark','Jersey City','Paterson','Elizabeth','Edison','Woodbridge','Lakewood','Toms River','Hamilton','Trenton','Clifton','Camden','Brick','Cherry Hill','Passaic','Middletown','Union City','Bayonne','East Orange','Piscataway','Irvington','Perth Amboy','Sayreville','Hoboken','Old Bridge'],
    'New Mexico':['Albuquerque','Las Cruces','Rio Rancho','Santa Fe','Roswell','Farmington','Clovis','Hobbs','Alamogordo','Carlsbad','Gallup','Taos','Artesia','Los Lunas','Portales','Grants','Deming','Lovington','Clovis','Las Vegas','Bernalillo','Silver City','Ruidoso','Espanola','Aztec'],
    'New York':['New York City','Buffalo','Rochester','Yonkers','Syracuse','Albany','New Rochelle','Mount Vernon','Schenectady','Utica','Binghamton','White Plains','Niagara Falls','Troy','Brooklyn','Manhattan','Queens','Bronx','Staten Island','Long Island City','Flushing','Jamaica','Harlem','Astoria','Babylon'],
    'North Carolina':['Charlotte','Raleigh','Greensboro','Durham','Winston-Salem','Fayetteville','Cary','Wilmington','High Point','Concord','Asheville','Gastonia','Chapel Hill','Greenville','Rocky Mount','Apex','Kannapolis','Burlington','Wilson','Huntersville','Hickory','Indian Trail','Monroe','Mooresville','Sanford'],
    'North Dakota':['Fargo','Bismarck','Grand Forks','Minot','West Fargo','Williston','Dickinson','Mandan','Jamestown','Wahpeton','Devils Lake','Valley City','Grafton','Lincoln','Beulah','Watford City','Hazen','Rugby','Bottineau','Cavalier','Carrington','Hillsboro','Lisbon','Ellendale','Oakes'],
    'Ohio':['Columbus','Cleveland','Cincinnati','Toledo','Akron','Dayton','Parma','Canton','Youngstown','Lorain','Hamilton','Springfield','Kettering','Elyria','Lakewood','Cuyahoga Falls','Euclid','Middletown','Mentor','Beavercreek','Cleveland Heights','Fairfield','Newark','Warren','Strongsville'],
    'Oklahoma':['Oklahoma City','Tulsa','Norman','Broken Arrow','Lawton','Edmond','Moore','Midwest City','Enid','Stillwater','Muskogee','Bartlesville','Owasso','Shawnee','Ponca City','Ardmore','Bixby','Yukon','Jenks','Mustang','Claremore','Duncan','Sand Springs','Sapulpa','Bethany'],
    'Oregon':['Portland','Salem','Eugene','Gresham','Hillsboro','Bend','Beaverton','Medford','Springfield','Corvallis','Albany','Tigard','Lake Oswego','Keiser','Roseburg','Grants Pass','Oregon City','McMinnville','Redmond','Tualatin','Bethany','Aloha','West Linn','Wilsonville','Sherwood'],
    'Pennsylvania':['Philadelphia','Pittsburgh','Allentown','Erie','Reading','Scranton','Bethlehem','Lancaster','Harrisburg','York','Wilkes-Barre','Chester','Norristown','Altoona','Easton','Levittown','McKeesport','Hazleton','New Castle','State College','Upper Darby','Abington','Bethel Park','Bucks County','Lower Merion'],
    'Rhode Island':['Providence','Warwick','Cranston','Pawtucket','East Providence','Woonsocket','Coventry','Cumberland','North Providence','South Kingstown','Johnston','West Warwick','Central Falls','North Smithfield','Smithfield','Lincoln','Burrillville','North Kingstown','Bristol','Westerly','East Greenwich','Middletown','Portsmouth','Charlestown','Barrington'],
    'South Carolina':['Charleston','Columbia','North Charleston','Mount Pleasant','Rock Hill','Greenville','Sumter','Goose Creek','Hilton Head','Spartanburg','Florence','Conway','Anderson','Myrtle Beach','Greer','Beaufort','Hanahan','Lexington','Bluffton','Aiken','Irmo','Cayce','Fort Mill','Clemson','Easley'],
    'South Dakota':['Sioux Falls','Rapid City','Aberdeen','Brookings','Watertown','Mitchell','Yankton','Pierre','Huron','Vermillion','Spearfish','Brandon','Box Elder','Madison','Tea','Sturgis','Harrisburg','Dell Rapids','Milbank','Mobridge','Lead','Hot Springs','Chamberlain','Winner','Sisseton'],
    'Tennessee':['Memphis','Nashville','Knoxville','Chattanooga','Clarksville','Murfreesboro','Franklin','Jackson','Johnson City','Bartlett','Hendersonville','Kingsport','Collierville','Smyrna','Cleveland','Brentwood','Germantown','Columbia','Spring Hill','La Vergne','Cookeville','Gallatin','Mount Juliet','Maryville','Bristol'],
    'Texas':['Houston','San Antonio','Dallas','Austin','Fort Worth','El Paso','Arlington','Corpus Christi','Plano','Laredo','Lubbock','Garland','Irving','Amarillo','Grand Prairie','McKinney','Frisco','Pasadena','Mesquite','Killeen','McAllen','Waco','Carrollton','Midland','Denton'],
    'Utah':['Salt Lake City','West Valley City','Provo','West Jordan','Orem','Sandy','Ogden','St. George','Layton','Millcreek','Taylorsville','Riverton','Logan','Murray','Lehi','South Jordan','Herriman','Draper','Bountiful','Clearfield','Spanish Fork','Eagle Mountain','Toelle','American Fork','Pleasant Grove'],
    'Vermont':['Burlington','South Burlington','Rutland','Barre','Montpelier','Winooski','St. Albans','Newport','Vergennes','Middlebury','Morrisville','Hyde Park','Lyndonville','Brattleboro','Springfield','St. Johnsbury','Essex Junction','Shelburne','Williston','Colchester','Milton','Stowe','Bennington','Manchester','Randolph'],
    'Virginia':['Virginia Beach','Norfolk','Chesapeake','Richmond','Newport News','Alexandria','Hampton','Roanoke','Portsmouth','Suffolk','Lynchburg','Harrisonburg','Charlottesville','Reston','Arlington','Leesburg','Blacksburg','Manassas','Herndon','Fredericksburg','Dale City','Centreville','McLean','Woodbridge','Springfield'],
    'Washington':['Seattle','Spokane','Tacoma','Vancouver','Bellevue','Kent','Everett','Renton','Yakima','Kirkland','Bellingham','Kennewick','Federal Way','Spokane Valley','Marysville','Redmond','Shoreline','Pasco','Sammamish','Richland','Lakewood','Burien','Lakewood','Kenmore','Edmonds'],
    'West Virginia':['Charleston','Huntington','Parkersburg','Morgantown','Wheeling','Fairmont','Beckley','Clarksburg','Martinsburg','South Charleston','Saint Albans','Vienna','Lewisburg','Weirton','Elkins','Nitro','Bluefield','Princeton','Bridgeport','Oak Hill','Dunbar','Cross Lanes','Hurricane','Moundsville','New Martinsville'],
    'Wisconsin':['Milwaukee','Madison','Green Bay','Kenosha','Racine','Appleton','Waukesha','Eau Claire','Oshkosh','Janesville','West Allis','La Crosse','Sheboygan','Wauwatosa','Fond du Lac','New Berlin','Wausau','Brookfield','Beloit','Greenfield','Franklin','Oak Creek','Caledonia','Manitowoc','West Bend'],
    'Wyoming':['Cheyenne','Casper','Laramie','Gillette','Rock Springs','Sheridan','Green River','Evanston','Riverton','Jackson','Cody','Lander','Torrington','Douglas','Rawlins','Worland','Powell','Thermopolis','Buffalo','Wheatland','Kemmerer','Afton','Star Valley Ranch','Glenrock','Greybull'],
  };

  const STATES = Object.entries(STATE_ABBR)
    .map(([name, abbr]) => ({ name, abbr }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── CACHE ─────────────────────────────────────────────
  const CACHE_KEY = 'oaas_context_v3'; // bumped to bust stale empty-FRED caches from pre-proxy era
  const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  function _cacheKey(stateAbbr, city, months) {
    const start = (months || [])[0] || '';
    const end   = (months || [])[(months || []).length - 1] || '';
    return `${stateAbbr}_${(city || '').replace(/\s+/g,'_')}_${start}_${end}`;
  }

  function loadCache(key) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      const entry = all[key];
      if (!entry || Date.now() - entry.ts > CACHE_TTL) return null;
      // Reject entries where FRED is entirely empty — cached during CORS failures
      const fred = entry.data?.fred || {};
      const hasFredData = Object.values(fred).some(map => Object.keys(map || {}).length > 0);
      if (!hasFredData) return null;
      return entry.data;
    } catch { return null; }
  }

  function saveCache(key, data) {
    try {
      const all = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
      all[key] = { ts: Date.now(), data };
      const keys = Object.keys(all).sort((a, b) => (all[b].ts || 0) - (all[a].ts || 0));
      keys.slice(10).forEach(k => delete all[k]);
      localStorage.setItem(CACHE_KEY, JSON.stringify(all));
    } catch {}
  }

  // ── DATE UTILITIES ────────────────────────────────────
  const MO_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function monthLabelToDate(label) {
    if (!label) return null;
    const parts = String(label).split(' ');
    const m = MO_ABBR.indexOf(parts[0]);
    const y = parseInt(parts[1]);
    if (m < 0 || isNaN(y)) return null;
    return new Date(y, m, 1);
  }

  function dateToMonthLabel(d) {
    return `${MO_ABBR[d.getMonth()]} ${d.getFullYear()}`;
  }

  function toISO(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dy}`;
  }

  function getDateRange(months) {
    if (!months || months.length === 0) return {};
    const first = monthLabelToDate(months[0]);
    const last  = monthLabelToDate(months[months.length - 1]);
    if (!first || !last) return {};
    // 13-month lookback so YoY calcs work
    const lookback = new Date(first.getFullYear(), first.getMonth() - 13, 1);
    const endDate  = new Date(last.getFullYear(), last.getMonth() + 1, 0); // last day
    return { startDate: toISO(lookback), endDate: toISO(endDate) };
  }

  // ── FETCH HELPER ──────────────────────────────────────
  function fetchWithTimeout(url, ms) {
    const ctrl = new AbortController();
    const tid  = setTimeout(() => ctrl.abort(), ms || 9000);
    return fetch(proxied(url), { signal: ctrl.signal }).finally(() => clearTimeout(tid));
  }

  // ── FRED API ──────────────────────────────────────────
  async function fetchFREDSeries(seriesId, startDate, endDate) {
    const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&observation_start=${startDate}&observation_end=${endDate}&api_key=${FRED_KEY}&file_type=json`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) throw new Error(`FRED ${seriesId}: HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.error_message) throw new Error(`FRED ${seriesId}: ${json.error_message}`);
    const map = {};
    (json.observations || []).forEach(obs => {
      if (!obs.value || obs.value === '.') return;
      const d = new Date(obs.date + 'T00:00:00');
      map[dateToMonthLabel(d)] = parseFloat(obs.value);
    });
    return map;
  }

  async function fetchFRED(stateAbbr, startDate, endDate) {
    const urCode = FRED_UR[stateAbbr];
    const series = [
      ['FEDFUNDS',       'fedfunds'],
      ['CPIAUCSL',       'cpi'],
      ['CUUR0000SEHC',   'rentCPI'],
      ['HOUST',          'housingStarts'],
      ['MORTGAGE30US',   'mortgage30'],
    ];
    if (urCode) series.push([urCode, 'stateUR']);

    const settled = await Promise.allSettled(
      series.map(([id]) => fetchFREDSeries(id, startDate, endDate))
    );
    const out = {};
    series.forEach(([, key], i) => {
      out[key] = settled[i].status === 'fulfilled' ? settled[i].value : {};
    });
    return out;
  }

  // ── FEMA API ──────────────────────────────────────────
  async function fetchFEMA(stateAbbr, startDate, endDate) {
    const filter = `state%20eq%20'${stateAbbr}'%20and%20declarationDate%20ge%20'${startDate}'%20and%20declarationDate%20le%20'${endDate}'`;
    const url = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$filter=${filter}&$orderby=declarationDate%20desc&$top=50&$format=json`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) throw new Error(`FEMA: HTTP ${resp.status}`);
    const json = await resp.json();
    return (json.DisasterDeclarationsSummaries || []).map(d => ({
      title: d.declarationTitle || '',
      date:  (d.declarationDate || '').slice(0, 10),
      type:  d.incidentType || '',
      number: String(d.disasterNumber || ''),
    }));
  }

  // ── CONGRESS.GOV API ──────────────────────────────────
  async function fetchCongress(startDate, endDate) {
    const terms = 'housing rent "real estate" multifamily "property tax" mortgage eviction zoning';
    const q = encodeURIComponent(JSON.stringify({ query: terms }));
    const url = `https://api.congress.gov/v3/bill?q=${q}&sort=date+asc&limit=20&format=json&api_key=${CONGRESS_KEY}`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) throw new Error(`Congress: HTTP ${resp.status}`);
    const json = await resp.json();
    const start = new Date(startDate);
    const end   = new Date(endDate);
    return (json.bills || [])
      .filter(b => {
        const d = new Date(b.introducedDate || '');
        return d >= start && d <= end;
      })
      .map(b => ({
        title:      b.title || '',
        number:     `${b.type || ''} ${b.number || ''}`.trim(),
        introduced: (b.introducedDate || '').slice(0, 10),
        congress:   String(b.congress || ''),
      }));
  }

  // ── OPENSTATES API ────────────────────────────────────
  async function fetchOpenStates(stateName, startDate, endDate) {
    const q = encodeURIComponent('rent landlord tenant property tax eviction zoning');
    const url = `https://v3.openstates.org/bills?jurisdiction=${encodeURIComponent(stateName)}&q=${q}&sort=updated_at&page=1&per_page=15`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) throw new Error(`OpenStates: HTTP ${resp.status}`);
    const json = await resp.json();
    const start = new Date(startDate);
    const end   = new Date(endDate);
    return (json.results || [])
      .filter(b => {
        const d = new Date(b.firstActionDate || b.createdAt || '');
        return isNaN(d) || (d >= start && d <= end);
      })
      .map(b => ({
        title:      b.title || '',
        id:         b.id || '',
        introduced: (b.firstActionDate || b.createdAt || '').slice(0, 10),
        session:    b.session || '',
      }));
  }

  // ── CENSUS ACS API ────────────────────────────────────
  async function fetchCensus(stateAbbr, city) {
    const fips = STATE_FIPS[stateAbbr];
    if (!fips) return {};
    const vars = 'B01003_001E,B19013_001E,B25003_002E,B25003_001E';
    const url = `https://api.census.gov/data/2022/acs/acs5?get=NAME,${vars}&for=place:*&in=state:${fips}`;
    const resp = await fetchWithTimeout(url, 10000);
    if (!resp.ok) throw new Error(`Census: HTTP ${resp.status}`);
    const rows = await resp.json();
    if (!Array.isArray(rows) || rows.length < 2) return {};
    const header = rows[0]; // ['NAME', 'B01003_001E', ...]
    const cityL  = city.toLowerCase().replace(/\s*city\s*$/i, '').trim();
    const match  = rows.slice(1).find(r => {
      const name = (r[0] || '').toLowerCase().replace(/\s*city\s*,.*/, '').trim();
      return name.includes(cityL) || cityL.includes(name);
    });
    if (!match) return {};
    const get = key => { const i = header.indexOf(key); return i >= 0 ? parseInt(match[i]) || null : null; };
    const renters = get('B25003_002E'), total = get('B25003_001E');
    return {
      population:         get('B01003_001E'),
      medianIncome:       get('B19013_001E'),
      renterUnits:        renters,
      totalHousingUnits:  total,
      renterRatio:        (renters && total) ? renters / total : null,
    };
  }

  // ── HUD FAIR MARKET RENTS ─────────────────────────────
  async function fetchHUD(stateAbbr) {
    const url = `https://www.huduser.gov/hudapi/public/fmr/statedata/${stateAbbr}`;
    const resp = await fetchWithTimeout(url, 9000);
    if (!resp.ok) throw new Error(`HUD: HTTP ${resp.status}`);
    const json = await resp.json();
    const rows = (json.data || []).slice(0, 5);
    return { year: json.year || null, rows };
  }

  // ── MAIN ENTRY POINT ──────────────────────────────────
  /**
   * Fetches all data sources for the given location + file period.
   * Caches the result in localStorage.
   * Never throws — any failed source is silently skipped.
   * @param {string} stateAbbr  e.g. 'CA'
   * @param {string} city       e.g. 'Los Angeles'
   * @param {string[]} months   e.g. ['Jan 2022', 'Feb 2022', ...]
   * @param {function} onProgress  optional callback(msg)
   * @returns {Promise<Object>} dataContext
   */
  async function fetchDataContext(stateAbbr, city, months, onProgress) {
    const ck = _cacheKey(stateAbbr, city, months);
    const cached = loadCache(ck);
    if (cached) return cached;

    const { startDate, endDate } = getDateRange(months);
    if (!startDate || !endDate) return {};

    const stateName = Object.entries(STATE_ABBR).find(([, a]) => a === stateAbbr)?.[0] || stateAbbr;

    if (onProgress) onProgress(`Fetching economic context for ${city}, ${stateAbbr}…`);

    const [fredR, femaR, congressR, osR, censusR, hudR] = await Promise.allSettled([
      fetchFRED(stateAbbr, startDate, endDate),
      fetchFEMA(stateAbbr, startDate, endDate),
      fetchCongress(startDate, endDate),
      fetchOpenStates(stateName, startDate, endDate),
      fetchCensus(stateAbbr, city),
      fetchHUD(stateAbbr),
    ]);

    const ctx = {
      stateAbbr, stateName, city,
      startDate, endDate,
      fetchedAt: Date.now(),
      fred:       fredR.status       === 'fulfilled' ? fredR.value       : {},
      fema:       femaR.status       === 'fulfilled' ? femaR.value       : [],
      congress:   congressR.status   === 'fulfilled' ? congressR.value   : [],
      openStates: osR.status         === 'fulfilled' ? osR.value         : [],
      census:     censusR.status     === 'fulfilled' ? censusR.value     : {},
      hud:        hudR.status        === 'fulfilled' ? hudR.value        : {},
    };

    saveCache(ck, ctx);
    return ctx;
  }

  // ── PUBLIC ────────────────────────────────────────────
  return {
    STATES,
    STATE_CITIES,
    STATE_ABBR,
    fetchDataContext,
    monthLabelToDate,
    dateToMonthLabel,
  };

})();
