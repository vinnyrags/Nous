/**
 * Build a Whatnot bulk-import CSV for Yu-Gi-Oh singles, straight from the
 * enriched "Yu-Gi-Oh" sheet tab (no WP dependency).
 *
 * Output: <vincentragosta.io>/tmp/whatnot-yugioh-import-{date}.csv
 *
 * YGO tab schema: A name · B number · C collectr · D auction · E AP override ·
 *   F stock · G set name · H set code · I variant · J rarity · K game ·
 *   L language · M image · P api id.
 *
 * Price = AP Override (E) if present, else Auction Price (D) — as-is from the
 * sheet (no markup). Cards missing an image are skipped and reported.
 */
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const TAB = 'Yu-Gi-Oh';
const SUB_CATEGORY = 'Yu-Gi-Oh! Cards'; // confirmed against Whatnot's category list
const OUT = path.resolve(process.env.HOME, 'Projects/vinnyrags/personal/vincentragosta.io', `tmp/whatnot-yugioh-import-${new Date().toISOString().slice(0, 10)}.csv`);
const CREDENTIALS_PATH = `${process.env.HOME}/.config/google/sheets-credentials.json`;

const norm = (s) => (s || '').toString().trim();
const dollars = (s) => { const n = parseFloat(norm(s).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };
const csvCell = (s) => { const v = (s ?? '').toString(); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; };

const HEADER = ['Category','Sub Category','Title','Description','Quantity','Type','Price','Shipping Profile','Offerable','Hazmat','Condition','Cost Per Item','SKU','Image URL 1','Image URL 2','Image URL 3','Image URL 4','Image URL 5','Image URL 6','Image URL 7','Image URL 8'];

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A2:R` })).data.values || [];

const out = []; const skipped = [];
for (const r of rows) {
  const name = norm(r[0]); if (!name) continue;
  const number = norm(r[1]);
  const stock = parseInt(norm(r[5]), 10) || 0;
  const setName = norm(r[6]);
  const rarity = norm(r[9]);
  const image = norm(r[12]);
  const price = dollars(r[4]) ?? dollars(r[3]); // AP override (E) else auction (D)
  if (!image) { skipped.push(`${name} (${number}) — no image`); continue; }
  if (!price) { skipped.push(`${name} (${number}) — no price`); continue; }
  if (stock < 1) { skipped.push(`${name} (${number}) — stock 0`); continue; }
  const title = `${name}${number ? ` #${number}` : ''}${setName ? ` — ${setName}` : ''}`.slice(0, 80);
  const desc = `Yu-Gi-Oh! TCG single card ${name}${number ? ` (${number})` : ''}${setName ? ` from ${setName}` : ''}.${rarity ? ` Rarity: ${rarity}.` : ''}`;
  out.push({ price, row: ['Trading Card Games', SUB_CATEGORY, title, desc, stock, 'Buy it Now', price, '0-1 oz', 'TRUE', 'Not Hazmat', 'Near Mint', '', number, image, '', '', '', '', '', '', ''] });
}
out.sort((a, b) => a.price - b.price);
const csv = [HEADER, ...out.map((o) => o.row)].map((row) => row.map(csvCell).join(',')).join('\n');
fs.writeFileSync(OUT, csv + '\n');
console.log(`Wrote ${out.length} YGO listings → ${OUT}`);
console.log(`Sub Category used: "${SUB_CATEGORY}"`);
if (skipped.length) console.log(`\nSkipped ${skipped.length}:\n  ${skipped.join('\n  ')}`);
