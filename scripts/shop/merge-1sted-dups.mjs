/**
 * One-off cleanup: collapse the Stripe-migration double-entries for three
 * 1st Ed Team Rocket cards in the Singles tab.
 *
 * Each card has two rows that are the SAME physical card recorded twice:
 *   KEEP   — set "Team Rocket" + variant "First Edition" (clean convention)
 *   DELETE — set "Team Rocket (First Edition)" + blank/lowercase variant
 *
 * Per the owner: each is 2 physical copies total (the double-entry = 1 card,
 * plus 1 new copy from the To Be Added staging tab). So the kept row's stock
 * is set to 2 and the duplicate row is removed.
 *
 * Re-verifies every row's identity before deleting. Backs up Singles first.
 * Dry-run by default; APPLY=1 to write.
 */
import fs from 'node:fs';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SINGLES = 'Singles';
const CREDENTIALS_PATH = `${process.env.HOME}/.config/google/sheets-credentials.json`;
const APPLY = !!process.env.APPLY;
const DATE = process.env.BACKUP_DATE || '2026-06-28';
const FINAL_STOCK = 2;

// Each: keepRow (canonical), delRow (duplicate), name, numerator.
const PAIRS = [
  { name: 'Drowzee', num: '54', keep: 276, del: 559 },
  { name: 'Koffing', num: '58', keep: 273, del: 558 },
  { name: 'Mankey',  num: '61', keep: 274, del: 557 },
];

const norm = (s) => (s || '').toString().trim();
const numr = (s) => norm(s).split('/')[0].replace(/^0+/, '').toLowerCase();

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const singlesSheetId = meta.data.sheets.find((s) => s.properties.title === SINGLES)?.properties.sheetId;

const all = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${SINGLES}'!A2:R` })).data.values || [];
const row = (n) => all[n - 2] || [];

console.log(`${APPLY ? 'APPLYING' : 'DRY RUN (set APPLY=1 to write)'}\n`);
let ok = true;
for (const p of PAIRS) {
  const k = row(p.keep);
  const d = row(p.del);
  // Assertions: both rows must be the expected card; keep = clean convention, del = polluted.
  const keepOk = norm(k[0]).toLowerCase() === p.name.toLowerCase() && numr(k[5]) === p.num
    && norm(k[6]) === 'Team Rocket' && /first/i.test(norm(k[8]));
  const delOk = norm(d[0]).toLowerCase() === p.name.toLowerCase() && numr(d[5]) === p.num
    && /first edition/i.test(norm(d[6]));
  console.log(`${p.name} #${p.num}:`);
  console.log(`  KEEP row${p.keep}: "${norm(k[0])}" set="${norm(k[6])}" variant="${norm(k[8])}" stock=${norm(k[3])} -> ${FINAL_STOCK}  ${keepOk ? '✓' : '✗ ASSERT FAIL'}`);
  console.log(`  DEL  row${p.del}: "${norm(d[0])}" set="${norm(d[6])}" variant="${norm(d[8])}" stock=${norm(d[3])}  ${delOk ? '✓' : '✗ ASSERT FAIL'}`);
  if (!keepOk || !delOk) ok = false;
}
if (!ok) { console.log('\nAborting — row assertions failed (sheet may have shifted). No writes.'); process.exit(1); }

if (!APPLY) { console.log('\nRe-run with APPLY=1 to back up, set kept stock=2, and delete the 3 duplicate rows.'); process.exit(0); }

// Backup.
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: { requests: [{ duplicateSheet: { sourceSheetId: singlesSheetId, newSheetName: `Singles_Backup_${DATE}_preMerge` } }] },
});
console.log(`\nBacked up ${SINGLES} -> Singles_Backup_${DATE}_preMerge`);

// Set kept rows' stock.
await sheets.spreadsheets.values.batchUpdate({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: { valueInputOption: 'USER_ENTERED', data: PAIRS.map((p) => ({ range: `'${SINGLES}'!D${p.keep}`, values: [[FINAL_STOCK]] })) },
});
console.log(`Set stock=${FINAL_STOCK} on ${PAIRS.length} kept rows.`);

// Delete duplicate rows — highest row first so earlier indices don't shift.
const delRows = PAIRS.map((p) => p.del).sort((a, b) => b - a);
await sheets.spreadsheets.batchUpdate({
  spreadsheetId: SPREADSHEET_ID,
  requestBody: {
    requests: delRows.map((rn) => ({
      deleteDimension: { range: { sheetId: singlesSheetId, dimension: 'ROWS', startIndex: rn - 1, endIndex: rn } },
    })),
  },
});
console.log(`Deleted duplicate rows: ${delRows.join(', ')}.`);
console.log('\nNote: each card likely has a parallel duplicate WP post too (the two rows carried different join keys) — reconcile during the next WP sync.');
