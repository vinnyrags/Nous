/**
 * Export sealed-product price + stock from the Products sheet tab for a direct
 * Sheet → WordPress sync (Stripe-free; sibling of export-card-prices.mjs but
 * for the `product` CPT). The Products tab is the source of truth for both
 * product price and stock; WP (and the Whatnot CSV built from it) follow.
 *
 * The Products tab has no Stripe/WP id column, so the WP-side importer joins by
 * product NAME (col A) → post_title. Output (stdout): JSON array of
 *   { name, price, stock }
 *   price = col B, normalized "$N.NN" (omitted if blank/zero)
 *   stock = col D, integer (0 included — sold-out products zero out WP stock
 *           and drop from the CSV; omitted only if col D is blank)
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
    range: 'Products!A2:D',
});

const out = [];
for (const r of res.data.values || []) {
    const name = (r[0] || '').trim();                                       // col A
    if (!name) continue;
    const entry = { name };
    const priceNum = parseFloat(String(r[1] || '').replace(/[^0-9.]/g, '')); // col B
    if (Number.isFinite(priceNum) && priceNum > 0) entry.price = '$' + priceNum.toFixed(2);
    const stockRaw = String(r[3] ?? '').replace(/[^0-9-]/g, '');             // col D
    if (stockRaw !== '' && Number.isFinite(parseInt(stockRaw, 10))) entry.stock = parseInt(stockRaw, 10);
    if (entry.price !== undefined || entry.stock !== undefined) out.push(entry);
}

process.stdout.write(JSON.stringify(out));
