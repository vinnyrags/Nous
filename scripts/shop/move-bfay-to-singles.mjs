/**
 * Add consignment cards from the "Bfay" tab into "Singles" — WITHOUT
 * clearing Bfay (its Sold / Vin Cut / Bfay Cut columns track the profit
 * split, so the reference must stay).
 *
 * Each appended Singles row is tagged Notes = "Bfay consignment" for
 * traceability. Cards already in Singles (matched by name + numerator +
 * edition) have their existing stock BUMPED by the Bfay qty (the staging
 * entry is a new physical copy), rather than being added as a duplicate
 * row. A card matching more than one Singles row is left for manual
 * handling (reported, not bumped) to avoid guessing which row to credit.
 *
 * Enrichment columns (set, code, rarity, image, release, API id) are left
 * blank for enrich-singles.js to fill afterward.
 *
 * Bfay schema:    A Name · B Number · C Stock · D Collectr · E Whatnot Price ·
 *   F Whatnot Override · G Sold · H Sold-8% · I Vin Cut · J Bfay Cut.
 * Singles schema: A Name · B Collectr · C Auction · D Stock · E AP Override ·
 *   F Number · G Set · H Code · I Variant · J Rarity · K Game · L Language ·
 *   M Image · N Release · O Release · P API ID · Q WP Join Key · R Notes.
 *
 * Usage:  node scripts/shop/move-bfay-to-singles.mjs           (dry run)
 *  apply: APPLY=1 node scripts/shop/move-bfay-to-singles.mjs
 */
import fs from 'node:fs';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const BFAY = 'Bfay';
const SINGLES = 'Singles';
const NOTE = 'Bfay consignment';
const CREDENTIALS_PATH = `${process.env.HOME}/.config/google/sheets-credentials.json`;
const APPLY = !!process.env.APPLY;
const DATE = process.env.BACKUP_DATE || '2026-06-28';

const norm = (s) => (s || '').toString().trim();
const numr = (s) => norm(s).split('/')[0].replace(/^0+/, '').toLowerCase();
const is1st = (...vals) => vals.some((v) => /1st|first\s*ed/i.test(norm(v)));
const ekey = (name, num, ed) => `${norm(name).toLowerCase()}|${numr(num)}|${ed ? '1' : '0'}`;

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const sheetId = (title) => meta.data.sheets.find((s) => s.properties.title === title)?.properties.sheetId;

const bfayRows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${BFAY}'!A2:J` })).data.values || [];
const singlesRows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SINGLES}'!A2:R` })).data.values || [];

// Map edition-key -> [{rowNum, stock}] so we can bump matched rows and
// detect ambiguous multi-row matches. rowNum is the 1-based sheet row.
const singlesIdx = new Map();
singlesRows.forEach((r, i) => {
  if (!norm(r[0])) return;
  const k = ekey(r[0], r[5], is1st(r[8], r[6]));
  if (!singlesIdx.has(k)) singlesIdx.set(k, []);
  singlesIdx.get(k).push({ rowNum: i + 2, stock: parseInt(norm(r[3]), 10) || 0 });
});

// Bfay row -> Singles row (A-R). Bfay carries no edition column -> Unlimited.
const toSinglesRow = (b) => [
  norm(b[0]),       // A Name
  norm(b[3]),       // B Collectr     <- Bfay D
  norm(b[4]),       // C Auction      <- Bfay E (Whatnot Price)
  norm(b[2]),       // D Stock        <- Bfay C
  norm(b[5]),       // E AP Override  <- Bfay F (Whatnot Override)
  norm(b[1]),       // F Number       <- Bfay B
  '',               // G Set          (enrich)
  '',               // H Code         (enrich)
  '',               // I Variant
  '',               // J Rarity       (enrich)
  'pokemon',        // K Game
  'English',        // L Language     (enrich/JP may correct)
  '',               // M Image        (enrich)
  '',               // N Release      (enrich)
  '',               // O Release      (enrich)
  '',               // P API ID       (enrich)
  '',               // Q WP Join Key
  NOTE,             // R Notes
];

const bumps = [];     // { rowNum, name, num, from, to }
const ambiguous = []; // matched >1 row — manual
const missing = [];   // append as new
for (const b of bfayRows) {
  const name = norm(b[0]); if (!name) continue;
  const qty = parseInt(norm(b[2]), 10) || 0;
  const hits = singlesIdx.get(ekey(name, b[1], false)) || [];
  if (hits.length === 1) {
    const h = hits[0];
    bumps.push({ rowNum: h.rowNum, name, num: norm(b[1]), from: h.stock, to: h.stock + qty, qty });
  } else if (hits.length > 1) {
    ambiguous.push({ name, num: norm(b[1]), rows: hits.map((h) => h.rowNum) });
  } else {
    missing.push(b);
  }
}

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (set APPLY=1 to write)'}\n`);
console.log(`Bfay: ${bfayRows.filter((b) => norm(b[0])).length} cards | bump: ${bumps.length} | add: ${missing.length} | ambiguous: ${ambiguous.length}\n`);
if (bumps.length) {
  console.log('Bump existing Singles stock (matched — Bfay reference kept):');
  bumps.forEach((u) => console.log(`  ↑ ${u.name} #${u.num}  row${u.rowNum}  stock ${u.from} -> ${u.to}  (+${u.qty})`));
  console.log('');
}
if (ambiguous.length) {
  console.log('AMBIGUOUS (matches >1 Singles row — NOT bumped, handle manually):');
  ambiguous.forEach((a) => console.log(`  ? ${a.name} #${a.num}  rows ${a.rows.join(', ')}`));
  console.log('');
}
console.log('Will append to Singles (tagged "Bfay consignment"):');
missing.forEach((b) => console.log(`  + ${norm(b[0])} #${norm(b[1])}  stock=${norm(b[2])}  whatnot=${norm(b[4])}`));

if (!APPLY) {
  console.log('\nRe-run with APPLY=1 to back up Singles, append new rows, and bump matched stock (Bfay tab untouched).');
  process.exit(0);
}

// Back up Singles only (Bfay is not modified).
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: { requests: [{ duplicateSheet: { sourceSheetId: sheetId(SINGLES), newSheetName: `Singles_Backup_${DATE}_preBfay` } }] },
});
console.log(`\nBacked up ${SINGLES} -> Singles_Backup_${DATE}_preBfay`);

if (bumps.length) {
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: bumps.map((u) => ({ range: `'${SINGLES}'!D${u.rowNum}`, values: [[u.to]] })),
    },
  });
  console.log(`Bumped stock on ${bumps.length} matched row(s).`);
}

if (missing.length) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SINGLES}'!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: missing.map(toSinglesRow) },
  });
  console.log(`Appended ${missing.length} row(s) to ${SINGLES}. Bfay tab left intact.`);
}
console.log('\nNext: run `node scripts/shop/enrich-singles.js --dry-run` then without --dry-run.');
