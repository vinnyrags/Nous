/**
 * Enrich the "Yu-Gi-Oh" tab from the YGOPRODeck API (free, no key).
 *
 * Fills (only when blank) per card, matched by Card Name (col A) with the
 * Card Number (col B, e.g. "SDK-001") used to pick the right set:
 *   G Set Name · H Set Code · J Rarity · K Game · L Language · M Image URL
 *   P (API ID slot) ← YGOPRODeck card id (passcode)
 *
 * Pricing (C/D/E), Stock (F), Name (A) and Number (B) are never touched.
 *
 * Dry-run by default; pass --apply to write. --limit=N to sample.
 *
 * YGO tab schema (NOTE: differs from Singles):
 *   A name · B number · C collectr · D auction · E AP override · F stock ·
 *   G set name · H set code · I variant · J rarity · K game · L language ·
 *   M image · N/O release · P api id · Q join key · R notes
 */
import fs from 'node:fs';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const TAB = 'Yu-Gi-Oh';
const APPLY = process.argv.includes('--apply');
const LIMIT = (() => { const a = process.argv.find((x) => x.startsWith('--limit=')); return a ? parseInt(a.split('=')[1], 10) : Infinity; })();
const CREDENTIALS_PATH = `${process.env.HOME}/.config/google/sheets-credentials.json`;
const API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (s) => (s || '').toString().trim();
const prefix = (num) => norm(num).split('-')[0].toUpperCase(); // "SDK-001" -> "SDK"

async function lookup(name, number) {
  // exact name first, then fuzzy
  for (const q of [`?name=${encodeURIComponent(name)}`, `?fname=${encodeURIComponent(name)}`]) {
    try {
      const res = await fetch(API + q);
      if (!res.ok) continue;
      const json = await res.json();
      const card = (json.data || [])[0];
      if (!card) continue;
      // pick the set matching this card's number prefix, else first set
      const pfx = prefix(number);
      const sets = card.card_sets || [];
      const set = sets.find((s) => norm(s.set_code).toUpperCase().startsWith(pfx + '-') || norm(s.set_code).toUpperCase() === norm(number).toUpperCase())
        || sets.find((s) => norm(s.set_code).toUpperCase().includes(pfx))
        || sets[0] || {};
      const img = (card.card_images || [])[0] || {};
      return {
        id: String(card.id || ''),
        setName: set.set_name || '',
        setCode: pfx,
        rarity: set.set_rarity || '',
        image: img.image_url || '',
        matched: q.startsWith('?name=') ? 'exact' : 'fuzzy',
      };
    } catch { /* try next */ }
  }
  return null;
}

const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const auth = new google.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });

const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `'${TAB}'!A2:R` })).data.values || [];
const data = rows.map((r, i) => ({ r, row: i + 2 })).filter(({ r }) => norm(r[0]));

let matched = 0, fuzzy = 0; const misses = []; const updates = [];
let n = 0;
for (const { r, row } of data) {
  if (n++ >= LIMIT) break;
  const name = norm(r[0]); const number = norm(r[1]);
  const hit = await lookup(name, number);
  await sleep(120); // be polite to YGOPRODeck
  if (!hit) { misses.push(`${name} (${number})`); continue; }
  matched++; if (hit.matched === 'fuzzy') fuzzy++;
  // only fill blanks (G,H,J,K,L,M,P)
  const set = (col, idx, val) => { if (val && !norm(r[idx])) updates.push({ range: `'${TAB}'!${col}${row}`, values: [[val]] }); };
  set('G', 6, hit.setName);
  set('H', 7, hit.setCode);
  set('J', 9, hit.rarity);
  set('K', 10, 'Yu-Gi-Oh');
  set('L', 11, 'English');
  set('M', 12, hit.image);
  set('P', 15, hit.id);
}

console.log(`\nCards: ${Math.min(data.length, LIMIT)} · matched: ${matched} (${fuzzy} fuzzy) · misses: ${misses.length}`);
console.log(`Cells to fill: ${updates.length}`);
if (misses.length) console.log('Misses:\n  ' + misses.join('\n  '));

if (!APPLY) { console.log('\nDry run — re-run with --apply to write.'); process.exit(0); }
// batch write in chunks
for (let i = 0; i < updates.length; i += 200) {
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { valueInputOption: 'RAW', data: updates.slice(i, i + 200) } });
}
console.log(`\n✓ Applied ${updates.length} cell updates.`);
