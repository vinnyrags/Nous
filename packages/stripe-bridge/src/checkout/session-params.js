/**
 * Unified Stripe Checkout Session param builder.
 *
 * The Nous bot had eight near-identical `checkout.sessions.create(params)`
 * call sites (pack-battle discord/web, card-shop, pull-box, direct product,
 * ad-hoc shipping, web shipping, speculative settlement). They shared a
 * skeleton but differed in real, easy-to-break ways:
 *
 *   - line item style: `price` (stored Stripe price) vs `price_data` (ad-hoc)
 *   - `adjustable_quantity` only on pull / pull-box
 *   - `allow_promotion_codes` only on product sales, never on shipping
 *   - shipping: rate OPTIONS + address collection (card/pull/product) vs
 *     address collection ALONE (ad-hoc / web shipping) vs none (battle / spec)
 *   - `expires_at` only on speculative settlement (7-day window)
 *   - `customer_email` / `receipt_email` set independently — speculative sets
 *     customer_email but deliberately NO receipt_email
 *   - `custom_fields` omitted entirely on the web-shipping and speculative flows
 *
 * This is a PURE assembler: it does no Stripe I/O, no DB lookups, and no
 * magic defaulting. Every flow-specific value (resolved email, shipping
 * options, metadata, custom fields, TOS audit) is computed by the caller in
 * Nous and passed in explicitly, so behavior is identical to the inline
 * params objects it replaces. A field is included only when its input is
 * provided — mirroring exactly which keys each original call site set.
 *
 * TOS-acceptance metadata mirroring (copying metadata onto
 * payment_intent_data) stays in Nous (applyTosMetadata / the per-flow inline
 * mirrors) because the audit values come from the Nous TOS-acceptance DB.
 * Callers apply it after this builder, exactly as before.
 */

/**
 * @typedef {Object} CheckoutSessionParamsInput
 * @property {Array<object>} lineItems              Stripe line_items array (price or price_data).
 * @property {string} successUrl
 * @property {string} cancelUrl
 * @property {Object<string,string>} [metadata]     Session metadata (copied, not mutated).
 * @property {boolean} [allowPromotionCodes]        Sets allow_promotion_codes:true when truthy.
 * @property {Array<object>} [customFields]          Sets custom_fields when provided (even when []).
 * @property {string|null} [customerEmail]          Sets customer_email when truthy.
 * @property {string|null} [receiptEmail]           Sets receipt_email when truthy (independent of customerEmail).
 * @property {Array<object>|null} [shippingOptions] Sets shipping_options when provided.
 * @property {object|null} [shippingAddressCollection] Sets shipping_address_collection when provided.
 * @property {number|null} [expiresAt]              Sets expires_at (unix seconds) when provided.
 */

/**
 * Assemble a Stripe Checkout Session params object.
 *
 * @param {CheckoutSessionParamsInput} input
 * @returns {object} params ready for stripe.checkout.sessions.create()
 */
export function buildCheckoutSessionParams({
    lineItems,
    successUrl,
    cancelUrl,
    metadata = {},
    allowPromotionCodes = false,
    customFields,
    customerEmail = null,
    receiptEmail = null,
    shippingOptions = null,
    shippingAddressCollection = null,
    expiresAt = null,
} = {}) {
    if (!Array.isArray(lineItems) || lineItems.length === 0) {
        throw new TypeError('buildCheckoutSessionParams: lineItems must be a non-empty array');
    }
    if (!successUrl || !cancelUrl) {
        throw new TypeError('buildCheckoutSessionParams: successUrl and cancelUrl are required');
    }

    const params = {
        mode: 'payment',
        line_items: lineItems,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: { ...metadata },
    };

    if (allowPromotionCodes) params.allow_promotion_codes = true;
    if (expiresAt != null) params.expires_at = expiresAt;
    if (customFields !== undefined) params.custom_fields = customFields;
    if (customerEmail) params.customer_email = customerEmail;
    if (receiptEmail) params.receipt_email = receiptEmail;
    if (shippingOptions) params.shipping_options = shippingOptions;
    if (shippingAddressCollection) params.shipping_address_collection = shippingAddressCollection;

    return params;
}
