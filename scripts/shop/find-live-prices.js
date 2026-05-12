/**
 * Find live-mode Stripe prices for the pull-box / bundle / pack-battle
 * configuration fields.
 *
 * Symptom this resolves:
 *   The May 2026 live-mode Stripe cutover left the pull-box (and
 *   potentially bundle + pack-battle) configured with TEST-mode price
 *   IDs in WP options + Nous SQLite. The live-mode key on prod rejects
 *   them with `resource_missing - No such price ... a similar object
 *   exists in test mode`. Customer-facing checkouts fail.
 *
 * What this script does:
 *   1. Connects to Stripe with the live STRIPE_SECRET_KEY from config.
 *   2. Lists all active live-mode products + prices (paginated).
 *   3. Filters by name keyword (default: "pull|bundle|battle"); pass
 *      --search "..." for a custom regex.
 *   4. Prints a table of product name, price ID, unit amount.
 *
 * Use the output to:
 *   - Update `pb_price_id` ACF option in WP admin (Itzenzo Settings).
 *   - Update `bundle_stripe_price_id` ACF option in WP admin.
 *   - Update battles.stripe_price_id in Nous SQLite via /battle command.
 *
 * Run on the server (where the live key lives):
 *   ssh root@174.138.70.29 'cd /opt/nous-bot && node scripts/shop/find-live-prices.js'
 *
 * Optional flag:
 *   --search "regex"   custom name filter (case-insensitive)
 *   --all              ignore the filter, dump every active price
 */

import Stripe from 'stripe';
import config from '../../config.js';

const args = process.argv.slice(2);
const searchIdx = args.indexOf('--search');
const customSearch = searchIdx >= 0 ? args[searchIdx + 1] : null;
const dumpAll = args.includes('--all');

const filter = dumpAll
    ? null
    : new RegExp(customSearch || 'pull|bundle|battle', 'i');

if (!config.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY missing from environment.');
    process.exit(1);
}

const mode = config.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST';
console.log(`Mode: ${mode} (${config.STRIPE_SECRET_KEY.slice(0, 12)}...)`);
if (mode === 'TEST') {
    console.warn(
        'Warning: this looks like a TEST key. Re-run on the server where the live key is set.',
    );
}
console.log('');

const stripe = new Stripe(config.STRIPE_SECRET_KEY);

const rows = [];
let cursor = null;

do {
    const page = await stripe.products.list({
        active: true,
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
    });

    for (const product of page.data) {
        if (filter && !filter.test(product.name)) continue;

        const prices = await stripe.prices.list({
            product: product.id,
            active: true,
            limit: 10,
        });
        for (const price of prices.data) {
            rows.push({
                name: product.name,
                priceId: price.id,
                amount:
                    price.unit_amount != null
                        ? `$${(price.unit_amount / 100).toFixed(2)}`
                        : '(none)',
                currency: (price.currency || '').toUpperCase(),
            });
        }
    }

    cursor = page.has_more ? page.data[page.data.length - 1].id : null;
} while (cursor);

if (rows.length === 0) {
    console.log(
        `No active products matched ${dumpAll ? '(all)' : `/${filter.source}/`}.`,
    );
    process.exit(0);
}

const colWidth = (key) => Math.max(key.length, ...rows.map((r) => String(r[key]).length));
const widths = {
    name: colWidth('name'),
    priceId: colWidth('priceId'),
    amount: colWidth('amount'),
};

const fmt = (r) =>
    `${String(r.name).padEnd(widths.name)}  ${String(r.priceId).padEnd(widths.priceId)}  ${String(r.amount).padStart(widths.amount)}  ${r.currency}`;

console.log(fmt({ name: 'Product', priceId: 'Price ID', amount: 'Amount', currency: 'Cur' }));
console.log('-'.repeat(widths.name + widths.priceId + widths.amount + 10));
for (const r of rows) console.log(fmt(r));
