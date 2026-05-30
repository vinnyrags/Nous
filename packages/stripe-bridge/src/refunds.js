/**
 * Refund / charge / session retrieval primitives.
 *
 * Dependency-injected Stripe I/O: every function takes a configured `stripe`
 * client as its first argument — the package NEVER imports the Nous config or
 * constructs its own client. Callers (the refund webhook bridge, the !refund
 * and !waive commands) own client construction and pass it in.
 *
 * These are deliberately thin wrappers over the Stripe SDK that preserve the
 * exact param shapes the Nous bot built inline before extraction:
 *   - session lookup by payment_intent (charge.refunded / dispute → session id)
 *   - charge retrieve (dispute payloads carry only a charge id)
 *   - session retrieve with payment_intent expanded (refund / waive)
 *   - refund create (optional partial amount + reason metadata)
 */

/**
 * Resolve a Stripe charge → its originating checkout session id by querying
 * the sessions list with `payment_intent`. Returns null when no matching
 * session exists (the charge could be from a non-checkout flow — payment
 * links, invoices — which the refund propagator does not handle).
 *
 * Swallows Stripe API errors and returns null (never throws) so the webhook
 * bridge can treat "couldn't resolve" the same as "no session".
 *
 * @param {import('stripe').Stripe} stripe
 * @param {object} charge
 * @returns {Promise<string|null>}
 */
export async function resolveSessionIdFromCharge(stripe, charge) {
    const paymentIntentId = typeof charge.payment_intent === 'string'
        ? charge.payment_intent
        : charge.payment_intent?.id;
    if (!paymentIntentId) return null;
    try {
        const list = await stripe.checkout.sessions.list({ payment_intent: paymentIntentId, limit: 1 });
        return list.data?.[0]?.id || null;
    } catch (e) {
        console.error(`Could not resolve session for payment_intent ${paymentIntentId}:`, e.message);
        return null;
    }
}

/**
 * Retrieve a full Charge object by id. Used by the dispute flow, whose event
 * payload carries only the charge id. Errors propagate to the caller.
 *
 * @param {import('stripe').Stripe} stripe
 * @param {string} chargeId
 * @returns {Promise<object>}
 */
export async function retrieveCharge(stripe, chargeId) {
    return stripe.charges.retrieve(chargeId);
}

/**
 * Retrieve a Checkout Session with its PaymentIntent expanded, so the caller
 * can read `session.payment_intent.id` to issue a refund. Errors propagate.
 *
 * @param {import('stripe').Stripe} stripe
 * @param {string} sessionId
 * @returns {Promise<object>}
 */
export async function retrieveSessionWithPaymentIntent(stripe, sessionId) {
    return stripe.checkout.sessions.retrieve(sessionId, { expand: ['payment_intent'] });
}

/**
 * Create a refund against a PaymentIntent. Mirrors the param construction the
 * bot did inline:
 *   - `amount` is added only when a truthy `amountCents` is given (omitting it
 *     refunds the full PaymentIntent; a 0/null/undefined amount means "full").
 *   - `metadata.reason` is added only when a `reason` is given.
 *
 * @param {import('stripe').Stripe} stripe
 * @param {{ paymentIntentId: string, amountCents?: number|null, reason?: string|null }} opts
 * @returns {Promise<object>}
 */
export async function createRefund(stripe, { paymentIntentId, amountCents, reason } = {}) {
    const params = { payment_intent: paymentIntentId };
    if (amountCents) params.amount = amountCents;
    if (reason) params.metadata = { reason };
    return stripe.refunds.create(params);
}
