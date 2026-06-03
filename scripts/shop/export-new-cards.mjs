/**
 * Export brand-new, fully-enriched card rows from the Singles tab for a direct
 * Sheet → WordPress card CREATE (Stripe-free). Companion to create-cards-from-
 * sheet.php.
 *
 * Selects rows that have a name + set + image but NO Stripe product id (col S) —
 * i.e. cards added to the sheet and enriched but never pushed through the old
 * Stripe pipeline (parked). The WP-side importer creates these (deduped by
 * name + number, since several share a name) with full metadata + featured
 * image + taxonomy.
 *
 * Output (stdout): JSON array of card objects (name, number, set_name, set_code,
 * variant, rarity, game, language, image, release_date, artist, price, stock).
 *
 * Usage: node export-new-cards.mjs > /tmp/new-cards.json
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
const rows = (await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Singles!A2:T',
})).data.values || [];

const out = [];
for (const r of rows) {
    const name = (r[0] || '').trim();
    const stripeId = (r[18] || '').trim();   // col S
    const setName = (r[8] || '').trim();     // col I
    const image = (r[14] || '').trim();      // col O
    // New = no Stripe id yet; enriched = has set + image. Skip otherwise.
    if (!name || stripeId || !setName || !image) continue;

    const priceNum = parseFloat(String(r[3] || '').replace(/[^0-9.]/g, ''));   // col D
    const stockNum = parseInt(String(r[5] || '').replace(/[^0-9-]/g, ''), 10); // col F

    out.push({
        name,
        number: (r[7] || '').trim(),            // H
        set_name: setName,                       // I
        set_code: (r[9] || '').trim(),           // J
        variant: (r[10] || '').trim(),           // K
        rarity: (r[11] || '').trim(),            // L
        game: (r[12] || '').trim() || 'pokemon', // M
        language: (r[13] || '').trim(),          // N
        image,                                   // O
        release_date: (r[15] || '').trim(),      // P
        artist: (r[16] || '').trim(),            // Q
        price: Number.isFinite(priceNum) && priceNum > 0 ? '$' + priceNum.toFixed(2) : '',
        stock: Number.isFinite(stockNum) ? stockNum : 0,
    });
}

process.stdout.write(JSON.stringify(out));
