/**
 * In-memory cache of active Stripe products — powers Discord autocomplete
 * for /battle product: and /hype products: typed-as-you-go suggestions.
 *
 * Discord requires autocomplete responses within 3 seconds, so a live
 * stripe.products.search() per keystroke would be too slow. The cache
 * fetches the full active product list at startup and refreshes after
 * /sync (which is the only routine source of product mutations).
 *
 * Cache is keyed by lowercase name for fast prefix matching. Names
 * preserve original casing for display.
 */

import Stripe from 'stripe';
import config from '../config.js';

let cache = []; // [{ id, name, lowerName, defaultPriceId }]
let lastRefreshed = 0;
let refreshInFlight = null;

/**
 * Refresh the product cache from Stripe. Idempotent — concurrent calls
 * coalesce into the same in-flight fetch.
 */
export async function refresh() {
    if (refreshInFlight) return refreshInFlight;

    refreshInFlight = (async () => {
        try {
            const stripe = new Stripe(config.STRIPE_SECRET_KEY);
            const all = [];
            let starting_after;
            // Page through all active products; usually <500 for this catalog
            for (let i = 0; i < 20; i++) {
                const page = await stripe.products.list({
                    active: true,
                    limit: 100,
                    ...(starting_after ? { starting_after } : {}),
                });
                for (const p of page.data) {
                    all.push({
                        id: p.id,
                        name: p.name,
                        lowerName: p.name.toLowerCase(),
                        defaultPriceId: p.default_price || null,
                    });
                }
                if (!page.has_more) break;
                starting_after = page.data[page.data.length - 1]?.id;
            }
            cache = all;
            lastRefreshed = Date.now();
            console.log(`[product-cache] refreshed: ${cache.length} active products`);
        } catch (e) {
            console.error('[product-cache] refresh failed:', e.message);
        } finally {
            refreshInFlight = null;
        }
    })();

    return refreshInFlight;
}

/**
 * Match products by lowercase prefix. Returns up to `limit` matches
 * suitable for Discord autocomplete (each {name, value}). The `query`
 * may be empty (returns first N).
 *
 * Discord caps at 25 choices per autocomplete response.
 */
export function suggest(query, limit = 25) {
    const q = (query || '').toLowerCase().trim();
    const matches = [];
    for (const p of cache) {
        if (!q || p.lowerName.startsWith(q) || p.lowerName.includes(q)) {
            matches.push({ name: p.name.slice(0, 100), value: p.name.slice(0, 100) });
            if (matches.length >= limit) break;
        }
    }
    return matches;
}

/**
 * Read-only accessors for tests / debugging.
 */
export function size() { return cache.length; }
export function lastRefreshedAt() { return lastRefreshed; }
