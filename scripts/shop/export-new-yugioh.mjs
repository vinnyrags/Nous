/**
 * Export the enriched "Yu-Gi-Oh" tab → JSON for create-cards-from-sheet.php.
 * Emits every card with name+image; the PHP dedupes by name+number, so
 * re-runs are safe. Writes JSON array to stdout.
 *
 * YGO tab: A name · B number · C collectr · D auction · E AP override ·
 *   F stock · G set name · H set code · I variant · J rarity · K game ·
 *   L language · M image · P api id.
 */
import fs from 'node:fs';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const TAB = 'Yu-Gi-Oh';
const CREDENTIALS_PATH = `${process.env.HOME}/.config/google/sheets-credentials.json`;
const norm = (s) => (s || '').toString().trim();
const dollars = (s) => { const n = parseFloat(norm(s).replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A2:R` })).data.values || [];

const out = [];
for (const r of rows) {
  const name = norm(r[0]); if (!name) continue;
  const image = norm(r[12]); if (!image) continue; // skip un-enriched
  const price = dollars(r[4]) ?? dollars(r[3]); // AP override (E) else auction (D)
  out.push({
    name,
    number: norm(r[1]),
    set_name: norm(r[6]),
    set_code: norm(r[7]),
    variant: norm(r[8]) || 'regular',
    rarity: norm(r[9]),
    game: 'yugioh',
    language: norm(r[11]) || 'English',
    release_date: norm(r[13]),
    price: price ?? '',
    stock: parseInt(norm(r[5]), 10) || 0,
    image,
  });
}
process.stdout.write(JSON.stringify(out, null, 2));
