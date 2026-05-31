/**
 * Product listing.
 *
 * Dependency-injected Stripe I/O: takes a configured `stripe` client as its
 * first argument. The package owns only the Stripe fetch + pagination; the
 * consumer (Nous `lib/product-cache.js`) owns the in-memory cache shape and
 * the Discord autocomplete `suggest()` matching.
 */

/**
 * Page through every active Stripe product and return a flat list of
 * `{ id, name, defaultPriceId }`. Bounded to `maxPages` pages of `pageSize`
 * (default 20 × 100 = 2000 products) — the catalog is normally <500, the
 * bound is a runaway guard. Stops early on `has_more === false`.
 *
 * @param {import('stripe').Stripe} stripe
 * @param {{ maxPages?: number, pageSize?: number }} [opts]
 * @returns {Promise<Array<{ id: string, name: string, defaultPriceId: string|null }>>}
 */
export async function listActiveProducts(stripe, { maxPages = 20, pageSize = 100 } = {}) {
    const all = [];
    let starting_after;
    for (let i = 0; i < maxPages; i++) {
        const page = await stripe.products.list({
            active: true,
            limit: pageSize,
            ...(starting_after ? { starting_after } : {}),
        });
        for (const p of page.data) {
            all.push({
                id: p.id,
                name: p.name,
                defaultPriceId: p.default_price || null,
            });
        }
        if (!page.has_more) break;
        starting_after = page.data[page.data.length - 1]?.id;
    }
    return all;
}
