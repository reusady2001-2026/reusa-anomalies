#!/usr/bin/env node
// ============================================================
// scripts/create-bucket.js
// One-time setup: creates the `property-files` Supabase Storage
// bucket (private, service-role access only).
//
// Usage:
//   SUPABASE_URL=https://xxx.supabase.co \
//   SUPABASE_SERVICE_KEY=<service_role_key> \
//   node scripts/create-bucket.js
// ============================================================

'use strict';

const https = require('https');

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SERVICE_KEY      = process.env.SUPABASE_SERVICE_KEY;
const BUCKET_NAME      = 'property-files';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.');
  process.exit(1);
}

const url = new URL(`${SUPABASE_URL}/storage/v1/bucket`);
const body = JSON.stringify({ id: BUCKET_NAME, name: BUCKET_NAME, public: false });

const options = {
  hostname: url.hostname,
  path:     url.pathname,
  method:   'POST',
  headers: {
    'Content-Type':  'application/json',
    'Content-Length': Buffer.byteLength(body),
    'apikey':         SERVICE_KEY,
    'Authorization':  `Bearer ${SERVICE_KEY}`,
  },
};

const req = https.request(options, res => {
  let data = '';
  res.on('data', chunk => { data += chunk; });
  res.on('end', () => {
    let parsed = null;
    try { parsed = JSON.parse(data); } catch (_) {}
    if (res.statusCode === 200 || res.statusCode === 201) {
      console.log(`✓ Bucket '${BUCKET_NAME}' created successfully.`);
    } else if (res.statusCode === 409 || parsed?.error === 'Duplicate') {
      console.log(`✓ Bucket '${BUCKET_NAME}' already exists — nothing to do.`);
    } else {
      console.error(`✗ Unexpected response (${res.statusCode}):`, data);
      process.exit(1);
    }
  });
});

req.on('error', err => {
  console.error('✗ Request failed:', err.message);
  process.exit(1);
});

req.write(body);
req.end();
