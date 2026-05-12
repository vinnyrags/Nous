/**
 * One-off sync to repair the live-mode Stripe catalog after the May 2026
 * test→live cutover left pull-box / bundle / pack-battle plumbing
 * pointing at test-mode-only resources.
 *
 * Steps (all gated behind --apply; default is dry-run):
 *   1. Create $5 price on existing "Pull Box Entry" product in live mode.
 *   2. Archive the existing $1 and $2 prices on "Pull Box Entry" — they
 *      were leftover from a multi-tier model the shop has since
 *      collapsed to single $5 tier.
 *   3. Create new "English Bundle" product + $5.99 price in live mode.
 *   4. List all live-mode active sealed products (anything not named like
 *      a card listing) so the operator can see what /battle start has to
 *      pick from.
 *
 * After --apply, the operator must:
 *   - Update WP option pb_price_id to the new $5 price ID.
 *   - Update WP option bundle_stripe_price_id to the new bundle price ID.
 *
 * Usage:
 *   node scripts/shop/post-cutover-stripe-sync.js            # dry-run
 *   node scripts/shop/post-cutover-stripe-sync.js --apply    # mutate
 */

import Stripe from 'stripe';
import config from '../../config.js';

const APPLY = process.argv.includes('--apply');

if (!config.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY missing from environment.');
    process.exit(1);
}

const mode = config.STRIPE_SECRET_KEY.startsWith('sk_live_') ? 'LIVE' : 'TEST';
console.log(`Mode: ${mode} (${config.STRIPE_SECRET_KEY.slice(0, 12)}...)`);
console.log(APPLY ? 'Apply mode: WILL mutate Stripe.' : 'Dry-run: no Stripe writes.');
console.log('');

const stripe = new Stripe(config.STRIPE_SECRET_KEY);

// -----------------------------------------------------------------------
// 1 + 2: Pull Box Entry — add $5 price, archive $1/$2 prices
// -----------------------------------------------------------------------

console.log('=== Pull Box Entry ===');
const pullBoxProducts = await stripe.products.search({
    query: 'active:"true" AND name:"Pull Box Entry"',
    limit: 5,
});

if (pullBoxProducts.data.length === 0) {
    console.log('No active "Pull Box Entry" product found in live mode. Skipping.');
} else if (pullBoxProducts.data.length > 1) {
    console.log(
        `Found ${pullBoxProducts.data.length} "Pull Box Entry" products — ambiguous. Skipping; clean up dupes first.`,
    );
    pullBoxProducts.data.forEach((p) => console.log(`  - ${p.id}: ${p.name}`));
} else {
    const pullBoxProduct = pullBoxProducts.data[0];
    console.log(`Product: ${pullBoxProduct.name} (${pullBoxProduct.id})`);

    const existingPrices = await stripe.prices.list({
        product: pullBoxProduct.id,
        active: true,
        limit: 10,
    });

    console.log('Existing active prices:');
    for (const p of existingPrices.data) {
        const amt = p.unit_amount != null ? `$${(p.unit_amount / 100).toFixed(2)}` : '(none)';
        console.log(`  - ${p.id}: ${amt}`);
    }

    const has5 = existingPrices.data.some((p) => p.unit_amount === 500);
    if (has5) {
        console.log('A $5 price already exists. Skipping create.');
    } else if (APPLY) {
        const created = await stripe.prices.create({
            product: pullBoxProduct.id,
            unit_amount: 500,
            currency: 'usd',
        });
        console.log(`CREATED $5 price: ${created.id}`);
    } else {
        console.log('[DRY-RUN] Would create $5 price on Pull Box Entry.');
    }

    const toArchive = existingPrices.data.filter((p) => p.unit_amount !== 500);
    for (const p of toArchive) {
        const amt = p.unit_amount != null ? `$${(p.unit_amount / 100).toFixed(2)}` : '(none)';
        if (APPLY) {
            await stripe.prices.update(p.id, { active: false });
            console.log(`ARCHIVED ${amt} price: ${p.id}`);
        } else {
            console.log(`[DRY-RUN] Would archive ${amt} price ${p.id}.`);
        }
    }
}

console.log('');

// -----------------------------------------------------------------------
// 3: English Bundle — create product + $5.99 price
// -----------------------------------------------------------------------

console.log('=== English Bundle ===');
const bundleProducts = await stripe.products.search({
    query: 'active:"true" AND name:"English Bundle"',
    limit: 5,
});

if (bundleProducts.data.length > 0) {
    console.log(
        `Already exists in live mode (${bundleProducts.data.length} match${bundleProducts.data.length > 1 ? 'es' : ''}). Skipping create.`,
    );
    for (const p of bundleProducts.data) {
        const prices = await stripe.prices.list({ product: p.id, active: true, limit: 5 });
        console.log(`  Product ${p.id}:`);
        for (const price of prices.data) {
            const amt = price.unit_amount != null ? `$${(price.unit_amount / 100).toFixed(2)}` : '(none)';
            console.log(`    - ${price.id}: ${amt}`);
        }
    }
} else if (APPLY) {
    const product = await stripe.products.create({ name: 'English Bundle' });
    const price = await stripe.prices.create({
        product: product.id,
        unit_amount: 599,
        currency: 'usd',
    });
    console.log(`CREATED product: ${product.id}`);
    console.log(`CREATED $5.99 price: ${price.id}`);
} else {
    console.log('[DRY-RUN] Would create "English Bundle" product + $5.99 price.');
}

console.log('');

// -----------------------------------------------------------------------
// 4: List live sealed products (audit for /battle start coverage)
// -----------------------------------------------------------------------

console.log('=== Sealed products available for /battle start ===');
const allProducts = [];
let cursor = null;
do {
    const page = await stripe.products.list({
        active: true,
        limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
    });
    allProducts.push(...page.data);
    cursor = page.has_more ? page.data[page.data.length - 1].id : null;
} while (cursor);

// Heuristic: card listings have set names like "SWSH05: Battle Styles" in
// the product name. Sealed products are short names (booster box, ETB,
// pack, etc.) without the " — SET NAME" pattern. We exclude any product
// whose name contains an em-dash, which all card listings use.
const sealed = allProducts.filter(
    (p) =>
        !p.name.includes('—') &&
        p.name !== 'Pull Box Entry' &&
        p.name !== 'English Bundle',
);

if (sealed.length === 0) {
    console.log('No sealed products in live mode. /battle start will fail for any input.');
} else {
    console.log(`${sealed.length} sealed product${sealed.length > 1 ? 's' : ''}:`);
    for (const p of sealed) {
        console.log(`  - ${p.id}: ${p.name}`);
    }
}

console.log('');
console.log(
    APPLY
        ? 'Done. Update WP options pb_price_id and bundle_stripe_price_id with the printed IDs.'
        : 'Dry-run done. Re-run with --apply to mutate Stripe.',
);
