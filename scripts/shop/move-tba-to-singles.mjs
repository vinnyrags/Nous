/**
 * Move new cards from the "To Be Added" staging tab into "Singles".
 *
 * "To Be Added" is a sparse staging queue (name, number, prices, stock,
 * variant, language). This script:
 *   1. Matches each To Be Added row against Singles by name + numerator
 *      (the part of the card number before "/", so "42" matches "42/82")
 *      + EDITION. First Edition is a distinct SKU from Unlimited, so a
 *      1st-Ed To Be Added card whose only Singles match is Unlimited is
 *      treated as missing (and vice versa). Edition is read from the
 *      variant column on both sides, and also the Singles set name (some
 *      rows encode it as "Team Rocket (First Edition)").
 *   2. Appends the rows NOT already in Singles, mapping the two tabs'
 *      differing column layouts. Enrichment columns (set, code, rarity,
 *      image, release, API id) are left blank for enrich-singles.js to fill.
 *   3. Clears the processed rows from "To Be Added".
 *
 * Backs up both tabs (duplicateSheet) before any write. Dry-run by default;
 * set APPLY=1 to write.
 *
 * To Be Added schema: A Name · B PriceCharting · C Collectr · D Auction ·
 *   E BIN · F Stock · G AP Override · H Number · I Set · J Set Code ·
 *   K Variant · L Rarity · M Game · N Language · O Image · P Release ·
 *   Q Release · R API ID · S Stripe ID · T Notes.
 *
 * Singles schema: A Name · B Collectr · C Auction · D Stock · E AP Override ·
 *   F Number · G Set · H Code · I Variant · J Rarity · K Game · L Language ·
 *   M Image · N Release · O Release · P API ID · Q WP Join Key · R Notes.
 *
 * Usage:  node scripts/shop/move-tba-to-singles.mjs           (dry run)
 *  apply: APPLY=1 node scripts/shop/move-tba-to-singles.mjs
 */
import fs from 'node:fs';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const TBA = 'To Be Added';
const SINGLES = 'Singles';
const CREDENTIALS_PATH = `${process.env.HOME}/.config/google/sheets-credentials.json`;
const APPLY = !!process.env.APPLY;
const DATE = process.env.BACKUP_DATE || '2026-06-28';

const norm = (s) => (s || '').toString().trim();
const numr = (s) => norm(s).split('/')[0].replace(/^0+/, '').toLowerCase();
const is1st = (...vals) => vals.some((v) => /1st|first\s*ed/i.test(norm(v)));
// Edition-aware key: name + numerator + edition flag.
const ekey = (name, num, ed) => `${norm(name).toLowerCase()}|${numr(num)}|${ed ? '1' : '0'}`;

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const auth = new google.auth.GoogleAuth({
  credentials: creds,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const sheetId = (title) => meta.data.sheets.find((s) => s.properties.title === title)?.properties.sheetId;

const tbaRows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TBA}'!A2:T` })).data.values || [];
const singlesRows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SINGLES}'!A2:R` })).data.values || [];

// Singles: A name · F number · G set · I variant. Edition from variant OR set name.
const singlesKeys = new Set();
for (const r of singlesRows) {
  if (norm(r[0])) singlesKeys.add(ekey(r[0], r[5], is1st(r[8], r[6])));
}

// Map a To Be Added row -> Singles row (A-R).
const toSinglesRow = (t) => [
  norm(t[0]),                 // A Name
  norm(t[2]),                 // B Collectr      <- TBA C
  norm(t[3]),                 // C Auction       <- TBA D
  norm(t[5]),                 // D Stock         <- TBA F
  norm(t[6]),                 // E AP Override   <- TBA G
  norm(t[7]),                 // F Number        <- TBA H
  norm(t[8]),                 // G Set           <- TBA I (blank -> enrich)
  norm(t[9]),                 // H Code          <- TBA J
  norm(t[10]),                // I Variant       <- TBA K
  norm(t[11]),                // J Rarity        <- TBA L
  norm(t[12]) || 'pokemon',   // K Game          <- TBA M (default pokemon)
  norm(t[13]) || 'English',   // L Language      <- TBA N (default English)
  norm(t[14]),                // M Image         <- TBA O
  norm(t[15]),                // N Release       <- TBA P
  norm(t[16]),                // O Release       <- TBA Q
  norm(t[17]),                // P API ID        <- TBA R
  '',                         // Q WP Join Key   (set when added to WP)
  norm(t[19]),                // R Notes         <- TBA T
];

const present = [];
const missing = [];
for (const t of tbaRows) {
  const name = norm(t[0]); if (!name) continue;
  // To Be Added: H number · K variant (carries "First Edition").
  if (singlesKeys.has(ekey(name, t[7], is1st(t[10])))) present.push(t);
  else missing.push(t);
}

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (set APPLY=1 to write)'}\n`);
console.log(`To Be Added: ${present.length + missing.length} cards | already in Singles: ${present.length} | to move: ${missing.length}\n`);
console.log('Will append to Singles:');
missing.forEach((t) => console.log(`  + ${norm(t[0])} #${norm(t[7])}  ${is1st(t[10]) ? '[1st Ed]' : '[Unl]'}  stock=${norm(t[5])}  auction=${norm(t[3])}`));

if (!APPLY) {
  console.log('\nRe-run with APPLY=1 to back up both tabs, append, and clear To Be Added.');
  process.exit(0);
}

// 1. Back up both tabs.
const backups = [
  { src: SINGLES, name: `Singles_Backup_${DATE}_preTBA` },
  { src: TBA, name: `ToBeAdded_Backup_${DATE}` },
];
for (const b of backups) {
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { requests: [{ duplicateSheet: { sourceSheetId: sheetId(b.src), newSheetName: b.name } }] },
  });
  console.log(`Backed up ${b.src} -> ${b.name}`);
}

// 2. Append missing rows to Singles.
if (missing.length) {
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `'${SINGLES}'!A1`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: missing.map(toSinglesRow) },
  });
  console.log(`\nAppended ${missing.length} row(s) to ${SINGLES}.`);
}

// 3. Clear the processed To Be Added data region.
await sheets.spreadsheets.values.clear({ spreadsheetId: SPREADSHEET_ID, range: `'${TBA}'!A2:T` });
console.log(`Cleared ${TBA} (A2:T).`);
console.log('\nNext: run `node scripts/shop/enrich-singles.js --dry-run` then without --dry-run to enrich the new rows.');
