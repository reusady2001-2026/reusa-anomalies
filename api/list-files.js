// api/list-files.js
// Returns all files in the `property-files` Supabase Storage bucket,
// grouped by property name (top-level folder).
//
// Response shape:
//   {
//     properties: {
//       "Crest": [{ name, path, size, mimetype, created_at, updated_at }, ...],
//       "Mews":  [...],
//     }
//   }
//
// Uses SUPABASE_URL + SUPABASE_SERVICE_KEY.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const BUCKET = 'property-files';

function storageList(supabaseUrl, serviceKey, prefix) {
  return fetch(`${supabaseUrl}/storage/v1/object/list/${BUCKET}`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${serviceKey}`,
      'apikey':        serviceKey,
    },
    body: JSON.stringify({
      prefix,
      limit:  1000,
      offset: 0,
      sortBy: { column: 'name', order: 'asc' },
    }),
  }).then(r => {
    if (!r.ok) return r.text().then(t => { throw new Error(`${r.status}: ${t}`); });
    return r.json();
  });
}

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

  try {
    // Pass 1: list root — Supabase returns virtual folder entries (id: null) and any root files.
    const rootItems = await storageList(SUPABASE_URL, SERVICE_KEY, '');

    const folders   = rootItems.filter(item => item.id === null);
    const rootFiles = rootItems.filter(item => item.id !== null);

    // Pass 2: list each folder's contents in parallel.
    const folderResults = await Promise.all(
      folders.map(async folder => {
        const files = await storageList(SUPABASE_URL, SERVICE_KEY, `${folder.name}/`);
        return {
          propertyName: decodeURIComponent(folder.name),
          files: files
            .filter(f => f.id !== null)
            .map(f => ({
              name:       decodeURIComponent(f.name),
              path:       `${decodeURIComponent(folder.name)}/${decodeURIComponent(f.name)}`,
              size:       f.metadata?.size       ?? null,
              mimetype:   f.metadata?.mimetype   ?? null,
              created_at: f.created_at,
              updated_at: f.updated_at,
            })),
        };
      })
    );

    // Build grouped map.
    const properties = {};
    folderResults.forEach(({ propertyName, files }) => {
      properties[propertyName] = files;
    });

    // Include any files sitting directly in the bucket root (shouldn't happen normally).
    if (rootFiles.length > 0) {
      properties[''] = rootFiles.map(f => ({
        name:       decodeURIComponent(f.name),
        path:       decodeURIComponent(f.name),
        size:       f.metadata?.size     ?? null,
        mimetype:   f.metadata?.mimetype ?? null,
        created_at: f.created_at,
        updated_at: f.updated_at,
      }));
    }

    res.writeHead(200, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ properties }));
  } catch (e) {
    res.writeHead(502, { ...CORS_HEADERS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Failed to list files', detail: e.message }));
  }
}
