// api/get-file.js
// Downloads a file from the `property-files` Supabase Storage bucket
// and streams it back to the client as an Excel file.
//
// Usage: GET /api/get-file?path=PropertyName/filename.xlsx
//
// Uses SUPABASE_URL + SUPABASE_SERVICE_KEY.

export const config = { api: { responseLimit: '20mb' } };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BUCKET    = 'property-files';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method !== 'GET') {
    res.writeHead(405, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    res.writeHead(500, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'SUPABASE_URL or SUPABASE_SERVICE_KEY not configured' }));
    return;
  }

  const { path } = req.query;
  if (!path) {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing query param: path' }));
    return;
  }

  // Encode each path segment individually so slashes are preserved in the URL.
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const downloadUrl = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${encodedPath}`;

  let storageRes;
  try {
    storageRes = await fetch(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey':        SERVICE_KEY,
      },
    });
  } catch (e) {
    res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Network error reaching Supabase Storage', detail: e.message }));
    return;
  }

  if (!storageRes.ok) {
    const detail = await storageRes.text().catch(() => '');
    const status = storageRes.status === 404 ? 404 : 502;
    res.writeHead(status, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Storage fetch failed (${storageRes.status})`, detail }));
    return;
  }

  // Derive filename from the path for the Content-Disposition header.
  const filename = path.split('/').pop();

  const fileBuffer = Buffer.from(await storageRes.arrayBuffer());
  res.writeHead(200, {
    ...CORS_HEADERS,
    'Content-Type':        XLSX_MIME,
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length':      fileBuffer.length,
    'Cache-Control':       'no-store',
  });
  res.end(fileBuffer);
}
