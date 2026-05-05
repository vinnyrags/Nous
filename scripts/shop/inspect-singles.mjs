/**
 * Read-only inspector for the Singles sheet. Prints headers, row count,
 * a few sample rows, and search results for any name fragments passed
 * as args. Used to ground parsing/matching scripts in the actual
 * column-A conventions of the Sheet without making writes.
 *
 * Usage:
 *   node scripts/shop/inspect-singles.mjs                # headers + samples
 *   node scripts/shop/inspect-singles.mjs Pikachu Eevee  # search by name
 */

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';

async function main() {
    const targets = process.argv.slice(2);

    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const headerRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:T1`,
    });
    const headers = headerRes.data.values?.[0] || [];
    console.log('=== Headers (A-T) ===');
    headers.forEach((h, i) => console.log(`  ${String.fromCharCode(65 + i)}: ${h}`));

    const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:T`,
    });
    const rows = dataRes.data.values || [];
    console.log(`\n=== Total rows: ${rows.length} ===`);

    if (targets.length === 0) {
        console.log('\n=== First 3 rows (A,E,F,H,I,J for context) ===');
        rows.slice(0, 3).forEach((r, i) => {
            console.log(`  Row ${i + 2}: A="${r[0]}" E="${r[4]}" F="${r[5]}" H="${r[7]}" I="${r[8]}" J="${r[9]}"`);
        });
        return;
    }

    console.log('\n=== Search hits ===');
    for (const target of targets) {
        const hits = rows
            .map((r, i) => ({
                row: i + 2,
                a: r[0] || '',
                e: r[4] || '',
                f: r[5] || '',
                h: r[7] || '',
                i: r[8] || '',
                j: r[9] || '',
                k: r[10] || '',
            }))
            .filter((r) => r.a.toLowerCase().includes(target.toLowerCase()));
        console.log(`\n  "${target}" → ${hits.length} hit(s)`);
        hits.forEach((h) =>
            console.log(`    Row ${h.row}: A="${h.a}" | num="${h.h}" | set="${h.i}" | code="${h.j}" | variant="${h.k}" | price="${h.e}" | stock="${h.f}"`),
        );
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
