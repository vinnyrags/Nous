/**
 * Customers.
 *
 * Dependency-injected Stripe I/O: takes a configured `stripe` client as its
 * first argument. Used by the Nous !link command to verify a buyer's email
 * exists in Stripe before linking their Discord account.
 */

/**
 * List Stripe customers matching an email, returning the bare data array
 * (empty when none). The command only needs existence + count, so the
 * envelope is unwrapped here.
 *
 * @param {import('stripe').Stripe} stripe
 * @param {string} email
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function listCustomersByEmail(stripe, email, { limit = 1 } = {}) {
    const list = await stripe.customers.list({ email, limit });
    return list.data || [];
}
