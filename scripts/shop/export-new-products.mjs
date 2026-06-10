/**
 * Export the Products sheet tab for a direct Sheet → WordPress product CREATE
 * (Stripe-free). Companion to create-products-from-sheet.php (sibling of
 * export-new-cards.mjs for the `product` CPT).
 *
 * Emits every named row; the WP-side importer dedupes by post_title and skips
 * rows with no image, so this can export the whole tab safely — only new,
 * imaged products get created.
 *
 * Output (stdout): JSON array of
 *   { name, price, category, stock, image, language }
 *   name=A, price=B ("$N.NN"), category=C, stock=D (int), image=G, language=H
 *
 * Usage: node export-new-products.mjs > /tmp/new-products.json
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
    range: 'Products!A2:H',
})).data.values || [];

const out = [];
for (const r of rows) {
    const name = (r[0] || '').trim();           // col A
    if (!name) continue;
    const entry = { name };
    const priceNum = parseFloat(String(r[1] || '').replace(/[^0-9.]/g, '')); // col B
    if (Number.isFinite(priceNum) && priceNum > 0) entry.price = '$' + priceNum.toFixed(2);
    entry.category = (r[2] || '').trim();        // col C
    const stockRaw = String(r[3] ?? '').replace(/[^0-9-]/g, ''); // col D
    if (stockRaw !== '' && Number.isFinite(parseInt(stockRaw, 10))) entry.stock = parseInt(stockRaw, 10);
    entry.image = (r[6] || '').trim();           // col G
    entry.language = (r[7] || '').trim();        // col H
    out.push(entry);
}

process.stdout.write(JSON.stringify(out));
