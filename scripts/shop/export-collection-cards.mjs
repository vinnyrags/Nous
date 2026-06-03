/**
 * Export Collection-tab rows that have no WP card yet (col O blank) for a
 * Sheet → WordPress collection-card CREATE. Companion to export-new-cards.mjs
 * but sourced from the Collection tab, in the create-cards-from-sheet.php JSON
 * shape, with price = AP Override (G) else Auction Price (E). The WP importer
 * is run with IS_COLLECTION=1 so these land as is_personal_collection cards.
 *
 * Output (stdout): JSON array of card objects.
 * Usage: node export-collection-cards.mjs > /tmp/collection-cards.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });
// Collection: A name, B number, C set, D Collectr, E Auction, F BIN, G Override,
// H Variant, I Language, J Rarity, K Release, L Artist, M Image, N API, O WP id.
const rows = (await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Collection!A2:P',
})).data.values || [];

const num = (s) => parseFloat(String(s || '').replace(/[^0-9.]/g, ''));

const out = [];
for (const r of rows) {
    const name = (r[0] || '').trim();
    const wpId = (r[14] || '').trim();    // O
    if (!name || wpId) continue;          // already has a WP card → skip
    const override = num(r[6]);           // G
    const auction = num(r[4]);            // E
    const priceNum = Number.isFinite(override) && override > 0 ? override : auction;

    out.push({
        name,
        number: (r[1] || '').trim(),      // B
        set_name: (r[2] || '').trim(),    // C
        set_code: '',
        variant: (r[7] || '').trim(),     // H
        rarity: (r[9] || '').trim(),      // J
        game: 'pokemon',
        language: (r[8] || '').trim(),    // I
        image: (r[12] || '').trim(),      // M
        release_date: (r[10] || '').trim(), // K
        artist: (r[11] || '').trim(),     // L
        price: Number.isFinite(priceNum) && priceNum > 0 ? '$' + priceNum.toFixed(2) : '',
        stock: 0,
    });
}

process.stdout.write(JSON.stringify(out));
