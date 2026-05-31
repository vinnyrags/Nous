/**
 * Price pre-flight.
 *
 * Dependency-injected Stripe I/O: takes a configured `stripe` client as its
 * first argument. Mirrors the WP-side StripeService::findFirstInactivePriceId
 * defense — probe that a stored price ID is retrievable AND active before a
 * checkout session is created, so an archived / wrong-mode price surfaces a
 * clean operator-facing error instead of a buried throw inside
 * stripe.checkout.sessions.create.
 */

/**
 * Probe a stored Stripe price ID. Returns null when the price (and its
 * product) is active and retrievable, or `{ code, message, detail? }` when
 * blocked. The caller supplies the user-facing copy so domain wording stays
 * out of the package; defaults are generic.
 *
 * Network / auth / rate-limit errors deliberately return null (not a block)
 * so the main createCheckoutSession call surfaces the real error through its
 * own catch — only a definitively inactive / missing price blocks here.
 *
 * @param {import('stripe').Stripe} stripe
 * @param {string} priceId
 * @param {{ inactiveMessage?: string, notFoundMessage?: string }} [messages]
 * @returns {Promise<null | { code: string, message: string, detail?: string }>}
 */
export async function preflightPriceActive(stripe, priceId, {
    inactiveMessage = 'This product is archived in Stripe.',
    notFoundMessage = 'This product is not available in this Stripe mode.',
} = {}) {
    try {
        const price = await stripe.prices.retrieve(priceId, { expand: ['product'] });
        if (!price.active) {
            return { code: 'price_inactive', message: inactiveMessage };
        }
        if (price.product && typeof price.product !== 'string' && !price.product.active) {
            return { code: 'product_inactive', message: inactiveMessage };
        }
        return null;
    } catch (e) {
        if (
            e?.type === 'StripeInvalidRequestError' &&
            /No such price/i.test(e?.message || '')
        ) {
            return {
                code: 'price_not_found',
                message: notFoundMessage,
                detail: e.message,
            };
        }
        return null;
    }
}
