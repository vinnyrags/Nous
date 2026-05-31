/**
 * Webhook signature verification + line-item retrieval.
 *
 * Dependency-injected Stripe I/O: takes a configured `stripe` client as its
 * first argument. This is the I/O HALF of the webhook only — the domain
 * dispatch (handleCheckoutCritical / notifications / catalog drift / refund
 * routing) stays in the Nous bot. Detangling the domain handlers into a
 * callback bag is Phase 2 (deferred).
 */

/**
 * Verify a raw Stripe webhook payload against its signature and return the
 * parsed event. Throws (StripeSignatureVerificationError) on a bad signature —
 * the caller decides the HTTP response. Thin wrapper over the SDK so the
 * `new Stripe(...)` + verification call lives behind the package boundary.
 *
 * @param {import('stripe').Stripe} stripe
 * @param {{ payload: string|Buffer, signature: string, secret: string }} args
 * @returns {object} the verified Stripe event
 */
export function constructWebhookEvent(stripe, { payload, signature, secret } = {}) {
    return stripe.webhooks.constructEvent(payload, signature, secret);
}

/**
 * Fetch a checkout session's line items and normalize them to the bot's
 * `{ name, quantity }` shape. Used as the fallback when a session has no
 * `metadata.line_items` (WordPress / external checkouts). `description`
 * falls back to 'Unknown Product', quantity to 1 — mirroring the inline
 * mapping that lived in webhooks/stripe.js. Errors propagate; the caller
 * keeps its own try/catch + empty-list fallback policy.
 *
 * @param {import('stripe').Stripe} stripe
 * @param {string} sessionId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<Array<{ name: string, quantity: number }>>}
 */
export async function listSessionLineItems(stripe, sessionId, { limit = 100 } = {}) {
    const fetched = await stripe.checkout.sessions.listLineItems(sessionId, { limit });
    return fetched.data.map((item) => ({
        name: item.description || 'Unknown Product',
        quantity: item.quantity || 1,
    }));
}
