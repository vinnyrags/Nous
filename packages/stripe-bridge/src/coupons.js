/**
 * Coupons + promotion codes.
 *
 * Dependency-injected Stripe I/O: takes a configured `stripe` client as its
 * first argument. NB the Nous coupon command pins the Stripe API version to
 * `2024-12-18.acacia` (newer versions removed the `coupon` param from
 * promotionCodes.create) — that pin is a client-construction concern and
 * stays caller-side; this package only issues the calls on whatever client
 * it's handed.
 *
 * All discount math, matching, and display formatting is domain logic and
 * stays in the Nous command — these are thin Stripe wrappers only.
 */

/**
 * Find a single promotion code by its human code. Returns the first match or
 * null (Stripe's list is the only lookup — there is no get-by-code). Pass
 * `expandCoupon: true` to expand `data.coupon` (the activate flow needs the
 * coupon's discount fields).
 *
 * @param {import('stripe').Stripe} stripe
 * @param {string} code
 * @param {{ expandCoupon?: boolean }} [opts]
 * @returns {Promise<object|null>}
 */
export async function findPromotionCodeByCode(stripe, code, { expandCoupon = false } = {}) {
    const params = { code, limit: 1 };
    if (expandCoupon) params.expand = ['data.coupon'];
    const list = await stripe.promotionCodes.list(params);
    return list.data?.[0] || null;
}

/**
 * Create a Stripe coupon. `params` is passed through verbatim (the command
 * builds `{ percent_off | amount_off, currency?, duration }`).
 *
 * @param {import('stripe').Stripe} stripe
 * @param {object} params
 * @returns {Promise<object>}
 */
export async function createCoupon(stripe, params) {
    return stripe.coupons.create(params);
}

/**
 * Create a customer-facing promotion code bound to a coupon. `maxRedemptions`
 * is added only when truthy (null/undefined = unlimited).
 *
 * @param {import('stripe').Stripe} stripe
 * @param {{ couponId: string, code: string, maxRedemptions?: number|null }} opts
 * @returns {Promise<object>}
 */
export async function createPromotionCode(stripe, { couponId, code, maxRedemptions } = {}) {
    const params = { coupon: couponId, code };
    if (maxRedemptions) params.max_redemptions = maxRedemptions;
    return stripe.promotionCodes.create(params);
}
