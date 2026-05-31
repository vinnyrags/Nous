/**
 * Checkout Session creation.
 *
 * Dependency-injected Stripe I/O: takes a configured `stripe` client as its
 * first argument and the fully-built params object as its second. Params are
 * assembled by `buildCheckoutSessionParams` (plus any caller-side ToS
 * metadata mirroring) — this is the thin `.create()` call behind the package
 * boundary so no checkout route touches the Stripe SDK directly.
 *
 * @param {import('stripe').Stripe} stripe
 * @param {object} params — ready for stripe.checkout.sessions.create()
 * @returns {Promise<object>} the created Checkout Session
 */
export async function createCheckoutSession(stripe, params) {
    return stripe.checkout.sessions.create(params);
}
