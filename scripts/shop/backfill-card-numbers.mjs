/**
 * One-shot backfill for column H (card_number) on the Singles tab.
 *
 * Background: push-cards.js builds Stripe product names as
 * `${name} #${cardNumber} — ${setName}` when column H (card_number)
 * is set, and `${name} — ${setName}` (no card number) when it isn't.
 * Many older Singles rows never had column H populated. For those
 * rows, the Stripe product name and the WP post_title lose the
 * `#cardNumber` segment.
 *
 * Most of those cards DO have a `tcg_api_id` in Stripe metadata —
 * the canonical Pokemon TCG API identifier, e.g. `swsh45sv-SV116`
 * for Grimmsnarl V (Shiny Vault). The card number is everything
 * after the last dash.
 *
 * This script:
 *   1. Reads the Singles tab.
 *   2. For each row where column H is empty AND column S (Stripe
 *      product ID) is populated:
 *        - Fetches the Stripe product
 *        - Parses card_number from tcg_api_id (after the last dash)
 *        - Stages a write to column H
 *   3. Dry-run (default): print all planned writes with row numbers.
 *   4. --apply: batch-update column H in one shot.
 *
 * After running with --apply, execute `make sync-cards-production`
 * to push the new column-H values through to Stripe product names
 * and WP post titles.
 *
 * Usage:
 *   node scripts/shop/backfill-card-numbers.mjs              # dry-run
 *   node scripts/shop/backfill-card-numbers.mjs --apply
 *   node scripts/shop/backfill-card-numbers.mjs --verbose    # show skipped rows
 *
 * Stripe key resolution: SSH to production once at startup to read
 * the live key from /opt/nous-bot/.env. Avoids requiring the operator
 * to manage live keys locally.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

// A-R schema (2026-06-23: Price Charting [old B] + BIN Price [old E] removed):
// Card Number now F, WP Join Key now Q.
const COL_H_INDEX = 5;   // 0-based — column F (card number)
const COL_S_INDEX = 16;  // 0-based — column Q (WP join key / legacy stripe id)
const COL_A_INDEX = 0;   // 0-based — column A (name) — for reporting

/**
 * Pull the live Stripe secret key off the production droplet so the
 * operator doesn't need to manage live keys locally. One short SSH
 * call at startup; the key never persists to disk on the operator's
 * laptop.
 */
function readProductionStripeKey() {
    const cmd = `ssh root@174.138.70.29 "grep '^STRIPE_SECRET_KEY=' /opt/nous-bot/.env | cut -d= -f2-"`;
    const key = execSync(cmd, { encoding: 'utf8' }).trim();
    if (!key.startsWith('sk_live_')) {
        throw new Error(`Expected sk_live_* from production, got: ${key.slice(0, 12)}…`);
    }
    return key;
}

/**
 * Parse the card number out of a Pokemon TCG API id. Format is
 * `<setid>-<number>`; the number is everything after the LAST dash
 * because some set ids contain dashes (rare, but defensive).
 */
function parseCardNumber(tcgApiId) {
    if (!tcgApiId) return null;
    const lastDash = tcgApiId.lastIndexOf('-');
    if (lastDash < 0) return null;
    const num = tcgApiId.slice(lastDash + 1).trim();
    return num || null;
}

async function main() {
    console.log(`\n=== Backfill column H (card_number) on Singles tab ===\n`);
    console.log(APPLY ? `Mode: --apply (will write)` : `Mode: dry-run (no writes)`);
    console.log(`Spreadsheet: ${SPREADSHEET_ID}`);
    console.log(`Tab: ${SHEET_NAME}\n`);

    // ─── Google Sheets ───────────────────────────────────────────────────
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: APPLY
            ? ['https://www.googleapis.com/auth/spreadsheets']
            : ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const dataRes = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:R`,
    });
    const rows = dataRes.data.values || [];
    console.log(`Singles rows: ${rows.length}`);

    // ─── Filter to candidates ────────────────────────────────────────────
    const candidates = []; // { rowNumber, name, stripeId }
    let alreadyPopulated = 0;
    let missingStripeId = 0;
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const name = (row[COL_A_INDEX] || '').trim();
        const colH = (row[COL_H_INDEX] || '').trim();
        const colS = (row[COL_S_INDEX] || '').trim();
        if (!name) continue;  // blank row

        if (colH) {
            alreadyPopulated++;
            continue;
        }
        if (!colS) {
            missingStripeId++;
            if (VERBOSE) console.log(`  ⚠ row ${i + 2}: ${name} — no Stripe product ID (column S empty)`);
            continue;
        }
        candidates.push({ rowNumber: i + 2, name, stripeId: colS });
    }

    console.log(`\n  Already populated (column H non-empty): ${alreadyPopulated}`);
    console.log(`  Skipped (no Stripe product ID in column S): ${missingStripeId}`);
    console.log(`  Candidates to backfill: ${candidates.length}\n`);

    if (candidates.length === 0) {
        console.log(`Nothing to do. Exiting.\n`);
        return;
    }

    // ─── Stripe lookup ───────────────────────────────────────────────────
    console.log(`Fetching live Stripe key from production droplet...`);
    const stripeKey = readProductionStripeKey();
    const stripe = new Stripe(stripeKey, { apiVersion: '2024-04-10' });
    console.log(`  ✓ Stripe key acquired\n`);

    console.log(`Resolving tcg_api_id for ${candidates.length} candidates...\n`);
    const writes = [];        // { rowNumber, name, parsedNumber, tcgApiId }
    const skippedNoProduct = [];
    const skippedNoTcgId = [];
    const skippedParseFail = [];

    for (const c of candidates) {
        let product;
        try {
            product = await stripe.products.retrieve(c.stripeId);
        } catch (err) {
            skippedNoProduct.push({ ...c, error: err.message });
            continue;
        }
        const tcgApiId = (product.metadata || {}).tcg_api_id || '';
        if (!tcgApiId) {
            skippedNoTcgId.push(c);
            continue;
        }
        const parsedNumber = parseCardNumber(tcgApiId);
        if (!parsedNumber) {
            skippedParseFail.push({ ...c, tcgApiId });
            continue;
        }
        writes.push({ ...c, parsedNumber, tcgApiId });
    }

    // ─── Report ──────────────────────────────────────────────────────────
    console.log(`=== Planned writes (${writes.length}) ===`);
    for (const w of writes) {
        console.log(`  row ${w.rowNumber}: ${w.name}`);
        console.log(`    tcg_api_id: ${w.tcgApiId}  →  column H = "${w.parsedNumber}"`);
    }

    if (skippedNoProduct.length) {
        console.log(`\n=== Skipped: Stripe product not found (${skippedNoProduct.length}) ===`);
        for (const s of skippedNoProduct) {
            console.log(`  row ${s.rowNumber}: ${s.name} (${s.stripeId}) — ${s.error}`);
        }
    }
    if (skippedNoTcgId.length) {
        console.log(`\n=== Skipped: no tcg_api_id in Stripe metadata (${skippedNoTcgId.length}) ===`);
        for (const s of skippedNoTcgId) {
            console.log(`  row ${s.rowNumber}: ${s.name} (${s.stripeId})`);
        }
    }
    if (skippedParseFail.length) {
        console.log(`\n=== Skipped: tcg_api_id present but unparseable (${skippedParseFail.length}) ===`);
        for (const s of skippedParseFail) {
            console.log(`  row ${s.rowNumber}: ${s.name} — tcg_api_id="${s.tcgApiId}"`);
        }
    }

    console.log(`\n=== Summary ===`);
    console.log(`  Will write:                    ${writes.length}`);
    console.log(`  Skipped (Stripe product gone): ${skippedNoProduct.length}`);
    console.log(`  Skipped (no tcg_api_id):       ${skippedNoTcgId.length}`);
    console.log(`  Skipped (parse failure):       ${skippedParseFail.length}`);

    if (!APPLY) {
        console.log(`\n📋 DRY-RUN — pass --apply to execute these writes.\n`);
        return;
    }

    if (writes.length === 0) {
        console.log(`\nNothing to write. Exiting.\n`);
        return;
    }

    // ─── Apply ───────────────────────────────────────────────────────────
    console.log(`\nApplying ${writes.length} writes to column F (card number)...`);
    const data = writes.map((w) => ({
        range: `${SHEET_NAME}!F${w.rowNumber}`,
        values: [[w.parsedNumber]],
    }));
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: { valueInputOption: 'USER_ENTERED', data },
    });
    console.log(`✅ Done. ${writes.length} rows updated.\n`);
    console.log(`Next: run \`make sync-cards-production\` to propagate the new card numbers through to Stripe product names and WP post titles.\n`);
}

main().catch((err) => {
    console.error(`\nFATAL: ${err.message}`);
    if (err.stack) console.error(err.stack);
    process.exit(1);
});
