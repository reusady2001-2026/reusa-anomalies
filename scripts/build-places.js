#!/usr/bin/env node
// ============================================================
// scripts/build-places.js
// Fetches the Census Bureau 2023 national places gazetteer,
// parses the tab-delimited file, and writes a state → cities
// JSON map to js/data/us-places.json.
//
// Usage: node scripts/build-places.js
// ============================================================

'use strict';

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const os      = require('os');
const { execSync } = require('child_process');

const GAZETTEER_URL =
  'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2023_Gazetteer/2023_gaz_place_national.zip';

const OUT_FILE = path.resolve(__dirname, '../js/data/us-places.json');

// ── Inverted STATE_ABBR from js/context.js ────────────────
// Derived verbatim from the STATE_ABBR constant — abbr → full name.
// DC is added here so it round-trips correctly with the existing UI.
const ABBR_TO_STATE = {
  AL:'Alabama',      AK:'Alaska',        AZ:'Arizona',       AR:'Arkansas',
  CA:'California',   CO:'Colorado',      CT:'Connecticut',   DE:'Delaware',
  FL:'Florida',      GA:'Georgia',       HI:'Hawaii',        ID:'Idaho',
  IL:'Illinois',     IN:'Indiana',       IA:'Iowa',          KS:'Kansas',
  KY:'Kentucky',     LA:'Louisiana',     ME:'Maine',         MD:'Maryland',
  MA:'Massachusetts',MI:'Michigan',      MN:'Minnesota',     MS:'Mississippi',
  MO:'Missouri',     MT:'Montana',       NE:'Nebraska',      NV:'Nevada',
  NH:'New Hampshire',NJ:'New Jersey',    NM:'New Mexico',    NY:'New York',
  NC:'North Carolina',ND:'North Dakota', OH:'Ohio',          OK:'Oklahoma',
  OR:'Oregon',       PA:'Pennsylvania',  RI:'Rhode Island',  SC:'South Carolina',
  SD:'South Dakota', TN:'Tennessee',     TX:'Texas',         UT:'Utah',
  VT:'Vermont',      VA:'Virginia',      WA:'Washington',    WV:'West Virginia',
  WI:'Wisconsin',    WY:'Wyoming',       DC:'District of Columbia',
};

// ── Helpers ───────────────────────────────────────────────

function download(url, destFile) {
  return new Promise((resolve, reject) => {
    console.log(`Downloading ${url} …`);
    const file = fs.createWriteStream(destFile);
    https.get(url, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        fs.unlinkSync(destFile);
        return download(res.headers.location, destFile).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', err => { fs.unlinkSync(destFile); reject(err); });
    }).on('error', reject);
  });
}

function unzip(zipFile, destDir) {
  console.log(`Unzipping to ${destDir} …`);
  execSync(`unzip -o "${zipFile}" -d "${destDir}"`, { stdio: 'pipe' });
}

function findTxt(dir) {
  const entries = fs.readdirSync(dir);
  const txt = entries.find(e => e.toLowerCase().endsWith('.txt'));
  if (!txt) throw new Error(`No .txt file found in ${dir}`);
  return path.join(dir, txt);
}

// ── Main ──────────────────────────────────────────────────

async function main() {
  const tmpDir  = fs.mkdtempSync(path.join(os.tmpdir(), 'gaz-'));
  const zipFile = path.join(tmpDir, 'places.zip');
  const txtDir  = path.join(tmpDir, 'extracted');
  fs.mkdirSync(txtDir);

  try {
    // 1. Download
    await download(GAZETTEER_URL, zipFile);

    // 2. Unzip
    unzip(zipFile, txtDir);

    // 3. Find and parse the tab-delimited .txt file
    const txtFile = findTxt(txtDir);
    console.log(`Parsing ${path.basename(txtFile)} …`);

    const raw     = fs.readFileSync(txtFile, 'utf8');
    const lines   = raw.split(/\r?\n/);
    const header  = lines[0].split('\t').map(h => h.trim());

    const uspsIdx = header.findIndex(h => h.toUpperCase() === 'USPS');
    const nameIdx = header.findIndex(h => h.toUpperCase() === 'NAME');

    if (uspsIdx === -1) throw new Error(`USPS column not found. Header: ${header.join(', ')}`);
    if (nameIdx === -1) throw new Error(`NAME column not found. Header: ${header.join(', ')}`);

    // 4. Build state → places map
    const placesMap = {};  // stateName → Set of place names

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (!line.trim()) continue;

      const cols  = line.split('\t');
      const abbr  = (cols[uspsIdx] || '').trim().toUpperCase();
      const name  = (cols[nameIdx] || '').trim();

      if (!name || !abbr) continue;

      const stateName = ABBR_TO_STATE[abbr];
      if (!stateName) continue;  // skip territories (PR, GU, VI, …)

      if (!placesMap[stateName]) placesMap[stateName] = new Set();
      placesMap[stateName].add(name);
    }

    // 5. Convert Sets to sorted arrays; sort states alphabetically
    const result = {};
    Object.keys(placesMap)
      .sort()
      .forEach(state => {
        result[state] = [...placesMap[state]].sort((a, b) => a.localeCompare(b));
      });

    // 6. Write output
    fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), 'utf8');

    const totalPlaces = Object.values(result).reduce((s, arr) => s + arr.length, 0);
    const stateCount  = Object.keys(result).length;
    console.log(`✓ Written ${OUT_FILE}`);
    console.log(`  ${stateCount} states/territories · ${totalPlaces.toLocaleString()} places`);

  } finally {
    // Clean up temp files
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(err => { console.error('ERROR:', err.message); process.exit(1); });
