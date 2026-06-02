/**
 * Export sealed-product prices from the Products sheet tab for a direct
 * Sheet → WordPress price sync (Stripe-free; sibling of export-card-prices.mjs
 * but for the `product` CPT). Stripe is parked, so the old Sheet → Stripe → WP
 * chain no longer refreshes product prices.
 *
 * The Products tab has no Stripe/WP id column, so the WP-side importer joins by
 * product NAME (col A) → post_title. Output (stdout): JSON array of
 *   { name, price }   price = col B, normalized "$N.NN"
 *
 * Usage: node export-product-prices.mjs > /tmp/product-prices.json
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
const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: 'Products!A2:B',
});

const out = [];
for (const r of res.data.values || []) {
    const name = (r[0] || '').trim();                                  // col A
    const priceNum = parseFloat(String(r[1] || '').replace(/[^0-9.]/g, '')); // col B
    if (name && Number.isFinite(priceNum) && priceNum > 0) {
        out.push({ name, price: '$' + priceNum.toFixed(2) });
    }
}

process.stdout.write(JSON.stringify(out));
