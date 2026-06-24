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
        range: `${SHEET_NAME}!A1:R1`,
    });
    const headers = headerRes.data.values?.[0] || [];
    console.log('=== Headers (A-R) ===');
    headers.forEach((h, i) => console.log(`  ${String.fromCharCode(65 + i)}: ${h}`));

    const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:R`,
    });
    const rows = dataRes.data.values || [];
    console.log(`\n=== Total rows: ${rows.length} ===`);

    // A-R schema (2026-06-23): A name, B collectr, C auction price, D stock,
    // F number, G set name, H set code, I variant.
    if (targets.length === 0) {
        console.log('\n=== First 3 rows (A,C,D,F,G for context) ===');
        rows.slice(0, 3).forEach((r, i) => {
            console.log(`  Row ${i + 2}: A="${r[0]}" C="${r[2]}" D="${r[3]}" F="${r[5]}" G="${r[6]}"`);
        });
        return;
    }

    console.log('\n=== Search hits ===');
    for (const target of targets) {
        const hits = rows
            .map((r, i) => ({
                row: i + 2,
                a: r[0] || '',
                c: r[2] || '',
                d: r[3] || '',
                f: r[5] || '',
                g: r[6] || '',
                h: r[7] || '',
                i: r[8] || '',
            }))
            .filter((r) => r.a.toLowerCase().includes(target.toLowerCase()));
        console.log(`\n  "${target}" → ${hits.length} hit(s)`);
        hits.forEach((hit) =>
            console.log(`    Row ${hit.row}: A="${hit.a}" | num="${hit.f}" | set="${hit.g}" | code="${hit.h}" | variant="${hit.i}" | auction="${hit.c}" | stock="${hit.d}"`),
        );
    }
}

main().catch((e) => { console.error(e); process.exit(1); });
