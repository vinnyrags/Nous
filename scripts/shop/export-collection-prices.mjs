/**
 * Export collection-card prices from the Collection sheet tab for a direct
 * Collection → WordPress price sync (Stripe-free). Sibling of
 * export-card-prices.mjs but for personal-collection cards.
 *
 * Displayed price = AP Override (col G) when set, else Auction Price (col E) —
 * mirrors the Singles override logic. The WP-side importer joins by WP Post ID
 * (col O) when present, else by card name + number among personal-collection
 * cards (and backfills col O).
 *
 * Output (stdout): JSON array of
 *   { rowIndex, name, number, set, wpPostId, price }
 *
 * Usage: node export-collection-prices.mjs > /tmp/collection-prices.json
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
// Collection cols: A name, B number, C set, D Collectr, E Auction, F BIN,
// G AP Override, ..., O WP Post ID, P Notes.
const rows = (await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Collection!A2:P',
})).data.values || [];

const num = (s) => parseFloat(String(s || '').replace(/[^0-9.]/g, ''));

const out = [];
rows.forEach((r, i) => {
    const name = (r[0] || '').trim();
    if (!name) return;
    const override = num(r[6]);   // G — AP Override
    const auction = num(r[4]);    // E — Auction Price
    const priceNum = Number.isFinite(override) && override > 0 ? override : auction;
    if (!(Number.isFinite(priceNum) && priceNum > 0)) return; // no price yet — skip
    out.push({
        rowIndex: i + 2,
        name,
        number: (r[1] || '').trim(),
        set: (r[2] || '').trim(),
        wpPostId: (r[14] || '').trim(),   // O
        price: '$' + priceNum.toFixed(2),
    });
});

process.stdout.write(JSON.stringify(out));
