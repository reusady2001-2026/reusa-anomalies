// api/upload-file.js
// Accepts POST with raw binary body (Content-Type: application/octet-stream).
// Query params: propertyName (string), filename (string)
// Uploads to Supabase Storage: property-files/{propertyName}/{filename}
// Returns: { path, url }
//
// Uses SUPABASE_URL + SUPABASE_SERVICE_KEY (service role — required for storage writes).

export const config = { api: { bodyParser: false, sizeLimit: '20mb' } };

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BUCKET = 'property-files';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function bufferBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
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

  const { propertyName, filename } = req.query;
  if (!propertyName || !filename) {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing query params: propertyName, filename' }));
    return;
  }

  let body;
  try {
    body = await bufferBody(req);
  } catch (e) {
    res.writeHead(400, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to read request body' }));
    return;
  }

  // Path inside the bucket: propertyName/filename (slashes preserved, components encoded)
  const storagePath = `${encodeURIComponent(propertyName)}/${encodeURIComponent(filename)}`;
  const uploadUrl   = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;

  let uploadRes;
  try {
    uploadRes = await fetch(uploadUrl, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'apikey':        SERVICE_KEY,
        'Content-Type':  XLSX_MIME,
        'x-upsert':      'true',
      },
      body,
    });
  } catch (e) {
    res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Network error reaching Supabase Storage', detail: e.message }));
    return;
  }

  if (!uploadRes.ok) {
    const detail = await uploadRes.text().catch(() => '');
    res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Supabase upload failed (${uploadRes.status})`, detail }));
    return;
  }

  const path = `${propertyName}/${filename}`;
  const url  = `${SUPABASE_URL}/storage/v1/object/${BUCKET}/${storagePath}`;

  res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ path, url }));
}
