/**
 * One-shot migration: lowercase every customer_email value in Nous's
 * SQLite database.
 *
 * Background: SQLite TEXT comparison is case-sensitive by default. Before
 * PR 2 of the fix-it patch series we wrote whatever case the buyer typed
 * (or whatever Stripe gave us) into:
 *   - purchases.customer_email
 *   - discord_links.customer_email
 *   - shipping_payments.customer_email
 *   - tracking.customer_email
 *   - livestream_buyers.customer_email
 *   - card_listings (no email column today, but defensive in case future
 *     migrations add one)
 *
 * Result: a buyer who shopped as `user@gmail.com` then later typed
 * `User@Gmail.com` was treated as a brand-new identity. Returning-buyer
 * lookups (Discord auto-link, shipping coverage, role threshold) silently
 * fragmented across the two casings.
 *
 * After PR 2 every write goes through `normalizeEmail()` so new rows are
 * always lowercase. This script lowercases the *existing* rows once.
 *
 * SAFETY: idempotent. Re-running yields no changes.
 *
 * Usage:
 *   node scripts/migrations/lowercase-emails.js          # dry run
 *   node scripts/migrations/lowercase-emails.js --apply  # commit
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = path.resolve(__dirname, '../../data.db');

const apply = process.argv.includes('--apply');
const db = new Database(dbPath);

const TABLES_WITH_EMAIL = [
    'purchases',
    'discord_links',
    'shipping_payments',
    'tracking',
    'livestream_buyers',
];

function countMixedCase(table) {
    return db.prepare(
        `SELECT COUNT(*) as count FROM ${table} WHERE customer_email IS NOT NULL AND customer_email != LOWER(customer_email)`
    ).get().count;
}

console.log(`\nEmail-lowercase migration — ${apply ? 'APPLY' : 'DRY RUN'}\n`);

let totalRowsAffected = 0;
for (const table of TABLES_WITH_EMAIL) {
    let mixedCase;
    try {
        mixedCase = countMixedCase(table);
    } catch (e) {
        console.log(`  ${table.padEnd(22)} — table does not exist, skipping`);
        continue;
    }

    if (mixedCase === 0) {
        console.log(`  ${table.padEnd(22)} — already all lowercase (0 rows)`);
        continue;
    }

    console.log(`  ${table.padEnd(22)} — ${mixedCase} row(s) need updating`);
    totalRowsAffected += mixedCase;

    if (apply) {
        const result = db.prepare(
            `UPDATE ${table} SET customer_email = LOWER(customer_email) WHERE customer_email IS NOT NULL AND customer_email != LOWER(customer_email)`
        ).run();
        console.log(`    → updated ${result.changes} row(s)`);
    }
}

console.log(`\nTotal: ${totalRowsAffected} row(s) ${apply ? 'updated' : 'would be updated'}.`);
if (!apply && totalRowsAffected > 0) {
    console.log('Re-run with --apply to commit.\n');
}
