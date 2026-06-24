/**
 * Export card prices from the Singles sheet for a direct Sheet → WordPress
 * price sync (Stripe-free).
 *
 * Background: card `price`/`stock` meta in WP used to be refreshed by
 * pull-cards.php reading Stripe (Sheet → Stripe → WP). Stripe is retired
 * (Whatnot pivot), so the sheet syncs straight into WP. Col S is the join
 * key: either a numeric WP post ID (cards created Stripe-free; stamped by
 * backfill-card-postids.mjs) or a legacy `prod_…` Stripe product ID (still
 * present as `stripe_product_id` postmeta — an inert join handle). Rows with
 * a blank col S are emitted too: the WP-side update-card-prices.php falls
 * back to a card_name + card_number (+ set) join for those.
 *
 * Output (stdout): JSON array of
 *   { joinKey, name, number, set, price?, stock?, doNotSell? }
 *   joinKey   — col S verbatim ('' when blank)
 *   number    — col H (Card Number), set — col I (Set Name): fallback join
 *   price     — col D (Auction Price), normalized "$N.NN"
 *   stock     — col F, integer (0 included; sold-out rows zero out WP stock)
 *   doNotSell — true when the sheet row is red-filled (WP post → draft)
 * Rows with no name, or no price/stock/red signal, are skipped.
 *
 * Usage: node export-card-prices.mjs > /tmp/card-prices.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');

// Same red-dominant heuristic as build-whatnot-full-import.mjs: red clearly
// above green and blue with green ≈ blue, so orange/brown/yellow highlights and
// the grey SOLD rows don't trip it.
function isRedFill(color) {
    if (!color) return false;
    const r = color.red ?? 0, g = color.green ?? 0, b = color.blue ?? 0;
    return r >= 0.4 && (r - g) > 0.15 && (r - b) > 0.15 && Math.abs(g - b) < 0.18;
}

const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});
const sheets = google.sheets({ version: 'v4', auth });
const res = await sheets.spreadsheets.get({
    spreadsheetId: SPREADSHEET_ID,
    ranges: ['Singles!A2:R'],
    includeGridData: true,
    fields: 'sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor,effectiveFormat.backgroundColorStyle)',
});
const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];

const out = [];
for (const row of rowData) {
    const cells = row.values || [];
    const text = (i) => (cells[i]?.formattedValue || '').trim();
    const name = text(0);                    // col A
    if (!name) continue;

    const isRed = cells.some((c) => {
        const ef = c?.effectiveFormat;
        return isRedFill(ef?.backgroundColorStyle?.rgbColor || ef?.backgroundColor);
    });
    const priceNum = parseFloat(text(2).replace(/[^0-9.]/g, ''));   // col C (Auction Price)
    const stockRaw = text(3).replace(/[^0-9-]/g, '');               // col D (Stock)

    const entry = {
        joinKey: text(16),                   // col Q (WP post ID or legacy prod_…)
        name,
        number: text(5),                     // col F (Card Number)
        set: text(6),                        // col G (Set Name)
    };
    if (Number.isFinite(priceNum) && priceNum > 0) entry.price = '$' + priceNum.toFixed(2);
    if (stockRaw !== '' && Number.isFinite(parseInt(stockRaw, 10))) entry.stock = parseInt(stockRaw, 10);
    if (isRed) entry.doNotSell = true;

    if (entry.price !== undefined || entry.stock !== undefined || entry.doNotSell) {
        out.push(entry);
    }
}

process.stdout.write(JSON.stringify(out));
