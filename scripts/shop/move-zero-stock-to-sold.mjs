/**
 * Move every Singles row with Stock (col F) = 0 to the Sold tab.
 *
 * The Sold tab only shares columns A–E with Singles (Card Name, Price
 * Charting Price, Collectr, Auction Price, BIN Price), so that's all that
 * carries over — the Sold-side bookkeeping columns (F Sold price, G Net
 * Collectr, H Net Auction, I Market Loss) are left blank for the operator
 * to fill in (or not) later.
 *
 * Safety:
 *   - Dry-run by default; pass --apply to execute.
 *   - Reads, appends and deletes in ONE execution from ONE snapshot —
 *     never carries row numbers across runs (the operator re-sorts the
 *     sheet between sessions, so absolute rows are meaningless).
 *   - Deletes Singles rows bottom-up so earlier deletions can't shift
 *     later indexes.
 *   - Run `node backup-singles.js` first if you want a same-day restore
 *     point (it suffixes if today's backup already exists).
 *
 * Usage: node move-zero-stock-to-sold.mjs [--apply]
 */

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SINGLES_SHEET_ID = 1405390683;
const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const APPLY = process.argv.includes('--apply');

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// One snapshot drives everything below.
const singles = (await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: 'Singles!A2:T',
})).data.values || [];

const movers = []; // { dataIdx, values }
singles.forEach((v, i) => {
    if (String(v[5] ?? '').trim() === '0') movers.push({ dataIdx: i, values: v });
});

console.log(`Singles rows: ${singles.length} · Stock=0 rows to move: ${movers.length}`);
for (const m of movers.slice(0, 10)) {
    console.log(`  row ${m.dataIdx + 2}: "${m.values[0]}" #${m.values[7] || '?'} — ${m.values[8] || ''}`);
}
if (movers.length > 10) console.log(`  ... +${movers.length - 10} more`);

if (!movers.length) process.exit(0);
if (!APPLY) {
    console.log('\nDry run — re-run with --apply to move them.');
    process.exit(0);
}

// Append A–E to Sold at an explicitly computed row (values.append's table
// detection can be thrown off by the summary cells in Sold!J1:K1).
const soldColA = (await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: 'Sold!A:A',
})).data.values || [];
const soldStart = soldColA.length + 1; // first empty row (1-based)
await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `Sold!A${soldStart}:E${soldStart + movers.length - 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: movers.map((m) => m.values.slice(0, 5).map((c) => c ?? '')) },
});
console.log(`Appended ${movers.length} rows to Sold at A${soldStart}.`);

// Delete from Singles bottom-up. Data row i sits at grid index i+1 (header
// is grid index 0).
const requests = movers
    .map((m) => m.dataIdx + 1)
    .sort((a, b) => b - a)
    .map((gridIdx) => ({
        deleteDimension: {
            range: { sheetId: SINGLES_SHEET_ID, dimension: 'ROWS', startIndex: gridIdx, endIndex: gridIdx + 1 },
        },
    }));
await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests } });
console.log(`Deleted ${requests.length} rows from Singles.`);

// Post-state verification.
const after = (await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: 'Singles!A2:T',
})).data.values || [];
const leftover = after.filter((v) => String(v[5] ?? '').trim() === '0').length;
const soldAfter = ((await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: 'Sold!A:A',
})).data.values || []).length;
console.log(`Verify: Singles now ${after.length} rows (stock=0 remaining: ${leftover}) · Sold col-A rows: ${soldAfter - 1}`);
if (leftover) console.warn('⚠ stock=0 rows remain — a concurrent edit may have landed mid-run; re-run to sweep.');
