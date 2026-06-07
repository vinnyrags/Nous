/**
 * Backfill Singles col S with WP post IDs for rows that have no join key.
 *
 * Col S is the sheet↔WP join key: legacy rows hold a `prod_…` Stripe product
 * ID (inert join handle since the Stripe retirement), and Stripe-free-created
 * cards hold the numeric WP post ID. Cards created by create-cards-from-sheet
 * start with col S blank on the sheet — this script stamps it so
 * update-card-prices*, export-new-cards (blank col S = "new card" marker),
 * and the Whatnot CSV builders can all join exactly.
 *
 * Matching: sheet row (name col A, number col H, set col I) → inventory card
 * (card_name, card_number, set_name) — case-insensitive name+number, with a
 * loose set-name containment tiebreak when multiple match. Ambiguous or
 * unmatched rows are reported and left blank.
 *
 * Input: a WP inventory JSON (export-inventory-json.php shape) — run
 * `make export-inventory-production` first. Production IDs are canonical;
 * never run this against a staging/local inventory (their post IDs diverge).
 *
 * Safety: read sheet + compute + write in ONE execution (rows are located by
 * content at write time, never by remembered index). Dry-run by default;
 * pass --apply to write.
 *
 * Usage: node backfill-card-postids.mjs [--apply] [--inventory=/tmp/inventory.json]
 */

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const APPLY = process.argv.includes('--apply');
const invArg = process.argv.find((a) => a.startsWith('--inventory='));
const INVENTORY_PATH = invArg ? invArg.split('=')[1] : '/tmp/inventory.json';

const norm = (s) => String(s || '').trim().toLowerCase();
const setMatches = (a, b) => {
    a = norm(a); b = norm(b);
    return a !== '' && b !== '' && (a.includes(b) || b.includes(a));
};

const inventory = JSON.parse(fs.readFileSync(INVENTORY_PATH, 'utf8'));
const cards = inventory.filter((i) => i.post_type === 'card');
console.log(`Inventory: ${cards.length} cards (${INVENTORY_PATH})`);

// name|number → [{id, set}]
const byNameNumber = new Map();
for (const c of cards) {
    const m = c.meta || {};
    const key = `${norm(m.card_name)}|${norm(m.card_number)}`;
    if (!byNameNumber.has(key)) byNameNumber.set(key, []);
    byNameNumber.get(key).push({ id: c.id, set: m.set_name || '', title: c.title });
}

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth });

// One snapshot drives everything below.
const rows = (await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: 'Singles!A2:T',
})).data.values || [];

const writes = [];
let ambiguous = 0, unmatchedCount = 0;
rows.forEach((v, i) => {
    const name = String(v[0] || '').trim();
    const joinKey = String(v[18] || '').trim();
    if (!name || joinKey) return;            // only blank-col-S rows

    const number = String(v[7] || '').trim();
    const set = String(v[8] || '').trim();
    let hits = byNameNumber.get(`${norm(name)}|${norm(number)}`) || [];
    if (hits.length > 1 && set) {
        hits = hits.filter((h) => setMatches(h.set, set));
    }
    if (hits.length === 1) {
        console.log(`  row ${i + 2}: ${name} #${number} (${set}) → WP ${hits[0].id}`);
        writes.push({ range: `Singles!S${i + 2}`, values: [[String(hits[0].id)]] });
    } else if (hits.length > 1) {
        ambiguous++;
        console.warn(`  ⚠ row ${i + 2}: ${name} #${number} matches ${hits.length} WP cards — left blank`);
    } else {
        unmatchedCount++;
        console.warn(`  ⚠ row ${i + 2}: ${name} #${number} (${set}) — no WP card found (not created yet?)`);
    }
});

console.log(`\n${writes.length} col-S backfill(s) pending · ${ambiguous} ambiguous · ${unmatchedCount} unmatched`);
if (!writes.length) process.exit(0);
if (!APPLY) {
    console.log('Dry run — re-run with --apply to write.');
    process.exit(0);
}

await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data: writes },
});
console.log(`✓ Wrote ${writes.length} WP post ID(s) to col S.`);
