// api/proxy.js
// Unified server-side proxy for all external API calls.
// Called with GET ?source=<source>&<other params>
// No external dependencies — native fetch only.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  const { source, ...params } = req.query;

  if (!source) {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing required query param: source' }));
    return;
  }

  const FRED_KEY     = process.env.FRED_KEY;
  const CONGRESS_KEY = process.env.CONGRESS_KEY;

  let targetUrl;

  try {
    switch (source) {
      case 'fred': {
        const { series_id, observation_start, observation_end } = params;
        targetUrl = `https://api.stlouisfed.org/fred/series/observations` +
          `?series_id=${encodeURIComponent(series_id)}` +
          `&observation_start=${encodeURIComponent(observation_start)}` +
          `&observation_end=${encodeURIComponent(observation_end)}` +
          `&api_key=${FRED_KEY}` +
          `&file_type=json`;
        break;
      }

      case 'fema': {
        const { state, startDate, endDate } = params;
        targetUrl = `https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries` +
          `?$filter=state%20eq%20'${encodeURIComponent(state)}'` +
          `%20and%20declarationDate%20ge%20'${encodeURIComponent(startDate)}'` +
          `%20and%20declarationDate%20le%20'${encodeURIComponent(endDate)}'` +
          `&$orderby=declarationDate%20desc` +
          `&$top=50` +
          `&$format=json`;
        break;
      }

      case 'congress': {
        const q = JSON.stringify({
          query: 'housing rent "real estate" multifamily "property tax" mortgage eviction zoning',
        });
        targetUrl = `https://api.congress.gov/v3/bill` +
          `?q=${encodeURIComponent(q)}` +
          `&sort=date+asc` +
          `&limit=20` +
          `&format=json` +
          `&api_key=${CONGRESS_KEY}`;
        break;
      }

      case 'openstates': {
        const { stateName } = params;
        targetUrl = `https://v3.openstates.org/bills` +
          `?jurisdiction=${encodeURIComponent(stateName)}` +
          `&q=rent%20landlord%20tenant%20property%20tax%20eviction%20zoning` +
          `&sort=updated_at` +
          `&page=1` +
          `&per_page=15`;
        const osRes  = await fetch(targetUrl, {
          headers: { 'X-API-KEY': process.env.OPENSTATES_KEY || '' }
        });
        const osData = await osRes.json();
        res.writeHead(osRes.status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(osData));
        return;
      }

      case 'census': {
        const { fips } = params;
        targetUrl = `https://api.census.gov/data/2022/acs/acs5` +
          `?get=NAME,B01003_001E,B19013_001E,B25003_002E,B25003_001E` +
          `&for=place:*` +
          `&in=state:${encodeURIComponent(fips)}`;
        break;
      }

      case 'hud': {
        const { state } = params;
        targetUrl = `https://www.huduser.gov/hudapi/public/fmr/statedata/${encodeURIComponent(state)}`;
        break;
      }

      case 'census_permits': {
        const { state_fips } = params;
        const cpUrl = `https://api.census.gov/data/timeseries/eits/bps` +
          `?get=cell_value,time_slot_id,category_code` +
          `&for=state:${state_fips}` +
          `&seasonally_adj=no` +
          `&time=from+2023`;
        const cpRes  = await fetch(cpUrl);
        const cpData = await cpRes.json();
        res.writeHead(cpRes.status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(cpData));
        return;
      }

      case 'openmeteo': {
        const { lat, lon, startDate, endDate } = params;
        const omUrl = `https://archive-api.open-meteo.com/v1/archive` +
          `?latitude=${lat}&longitude=${lon}` +
          `&start_date=${startDate}&end_date=${endDate}` +
          `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum` +
          `&timezone=auto&temperature_unit=fahrenheit`;
        const omRes  = await fetch(omUrl);
        const omData = await omRes.json();
        res.writeHead(omRes.status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify(omData));
        return;
      }

      default:
        res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Unrecognized source: ${source}` }));
        return;
    }

    const upstream = await fetch(targetUrl);
    const data     = await upstream.json();

    res.writeHead(upstream.status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));

  } catch (err) {
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  }
}
