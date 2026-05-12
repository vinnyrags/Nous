/**
 * Pre-flight audit for sync-cards-production. Compares each Sheet row's
 * column E (display price) against the corresponding Stripe product's
 * current default_price.unit_amount.
 *
 * Why this exists: push-cards.js's update path REUSES the existing
 * Stripe price ID when Sheet price === Stripe price, but CREATES A NEW
 * price (and updates the product's default_price) when they differ.
 * After a test→live price ID migration, any Sheet/Stripe divergence
 * would silently generate fresh live prices, undoing the migration's
 * carefully-mapped IDs.
 *
 * This script is READ-ONLY. It reads the Sheet, queries Stripe, and
 * prints a diff report. No writes anywhere.
 *
 * Usage:
 *   node scripts/shop/audit-card-prices.mjs              # plain output
 *   node scripts/shop/audit-card-prices.mjs --verbose    # also list matches
 *
 * Exit code is 0 regardless — this is informational only.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { google } from 'googleapis';
import Stripe from 'stripe';

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';

const VERBOSE = process.argv.includes('--verbose');

const COL_A_INDEX = 0;   // name (for reporting)
const COL_E_INDEX = 4;   // price (display string like "$5", "$1,000")
const COL_S_INDEX = 18;  // stripe_product_id

/**
 * Parse a display price string like "$25", "$1,000", or "$24.99" into
 * Stripe's integer-cents format. Returns NaN on parse failure. Mirrors
 * the priceToCents() helper in push-cards.js so the diff catches
 * exactly what push-cards would do.
 */
function priceToCents(raw) {
    if (!raw) return NaN;
    const cleaned = String(raw).replace(/[^\d.]/g, '');
    const dollars = parseFloat(cleaned);
    if (isNaN(dollars) || dollars <= 0) return NaN;
    return Math.round(dollars * 100);
}

function formatCents(cents) {
    if (typeof cents !== 'number' || isNaN(cents)) return '?';
    return '$' + (cents / 100).toFixed(2);
}

function readProductionStripeKey() {
    const cmd = `ssh root@174.138.70.29 "grep '^STRIPE_SECRET_KEY=' /opt/nous-bot/.env | cut -d= -f2-"`;
    const key = execSync(cmd, { encoding: 'utf8' }).trim();
    if (!key.startsWith('sk_live_')) {
        throw new Error(`Expected sk_live_* from production, got: ${key.slice(0, 12)}…`);
    }
    return key;
}

async function main() {
    console.log(`\n=== Card price audit (Sheet column E ↔ Stripe default_price) ===\n`);

    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:T`,
    });
    const rows = dataRes.data.values || [];
    console.log(`Singles rows: ${rows.length}`);

    const candidates = [];
    let unparseable = 0;
    let noStripeId = 0;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = (row[COL_A_INDEX] || '').trim();
        const priceStr = (row[COL_E_INDEX] || '').trim();
        const stripeId = (row[COL_S_INDEX] || '').trim();
        if (!name) continue;
        const priceCents = priceToCents(priceStr);
        if (isNaN(priceCents)) {
            unparseable++;
            continue;
        }
        if (!stripeId) {
            noStripeId++;
            continue;
        }
        candidates.push({ rowNumber: i + 2, name, sheetPriceCents: priceCents, stripeId });
    }
    console.log(`  Rows with valid price + Stripe ID: ${candidates.length}`);
    if (unparseable) console.log(`  Rows skipped (column E unparseable): ${unparseable}`);
    if (noStripeId) console.log(`  Rows skipped (no Stripe product ID in column S): ${noStripeId}`);
    console.log('');

    console.log(`Fetching live Stripe key from production droplet...`);
    const stripeKey = readProductionStripeKey();
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-04-10' });
    console.log(`  ✓ Stripe key acquired\n`);

    console.log(`Fetching default prices for ${candidates.length} products...\n`);

    const mismatches = [];
    const productGone = [];
    const noPrice = [];
    const matches = [];

    for (const c of candidates) {
        let product;
        try {
            product = await stripe.products.retrieve(c.stripeId, { expand: ['default_price'] });
        } catch (err) {
            productGone.push({ ...c, error: err.message });
            continue;
        }
        const dp = product.default_price;
        if (!dp || typeof dp !== 'object') {
            noPrice.push({ ...c });
            continue;
        }
        if (dp.unit_amount === c.sheetPriceCents) {
            matches.push({ ...c, stripePriceCents: dp.unit_amount, priceId: dp.id });
        } else {
            mismatches.push({
                ...c,
                stripePriceCents: dp.unit_amount,
                priceId: dp.id,
            });
        }
    }

    if (VERBOSE && matches.length) {
        console.log(`=== Matches (${matches.length}) ===`);
        for (const m of matches) {
            console.log(`  ✓ row ${m.rowNumber}: ${m.name} — ${formatCents(m.sheetPriceCents)} (price ${m.priceId})`);
        }
        console.log('');
    }

    if (mismatches.length) {
        console.log(`=== ⚠ PRICE MISMATCHES (${mismatches.length}) ===\n`);
        console.log(`These rows would get NEW Stripe prices created during the next sync,`);
        console.log(`overwriting the price IDs currently in WP postmeta.\n`);
        for (const m of mismatches) {
            console.log(`  row ${m.rowNumber}: ${m.name}`);
            console.log(`    Sheet column E:        ${formatCents(m.sheetPriceCents)}`);
            console.log(`    Stripe default_price:  ${formatCents(m.stripePriceCents)} (${m.priceId})`);
            console.log(`    Stripe product:        ${m.stripeId}`);
            console.log('');
        }
    }

    if (productGone.length) {
        console.log(`=== Skipped: Stripe product not found (${productGone.length}) ===`);
        for (const s of productGone) {
            console.log(`  row ${s.rowNumber}: ${s.name} (${s.stripeId}) — ${s.error}`);
        }
        console.log('');
    }

    if (noPrice.length) {
        console.log(`=== Skipped: Stripe product has no default_price (${noPrice.length}) ===`);
        for (const s of noPrice) {
            console.log(`  row ${s.rowNumber}: ${s.name} (${s.stripeId})`);
        }
        console.log('');
    }

    console.log(`=== Summary ===`);
    console.log(`  Matches:               ${matches.length}`);
    console.log(`  Mismatches:            ${mismatches.length}  ${mismatches.length === 0 ? '✓ safe to sync' : '⚠ would create new prices'}`);
    console.log(`  Stripe product gone:   ${productGone.length}`);
    console.log(`  No default_price:      ${noPrice.length}`);
    console.log('');
}

main().catch((err) => {
    console.error(`\nFATAL: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
