import { describe, it, expect } from 'vitest';
import { buildCheckoutSessionParams } from './session-params.js';

const base = {
    lineItems: [{ price: 'price_x', quantity: 1 }],
    successUrl: 'https://s/ok',
    cancelUrl: 'https://s/cancel',
};

describe('buildCheckoutSessionParams', () => {
    it('always sets mode, line_items, urls, and a copied metadata object', () => {
        const meta = { source: 'pack-battle' };
        const p = buildCheckoutSessionParams({ ...base, metadata: meta });
        expect(p.mode).toBe('payment');
        expect(p.line_items).toBe(base.lineItems);
        expect(p.success_url).toBe('https://s/ok');
        expect(p.cancel_url).toBe('https://s/cancel');
        expect(p.metadata).toEqual({ source: 'pack-battle' });
        expect(p.metadata).not.toBe(meta); // copied, not aliased
    });

    it('omits allow_promotion_codes unless requested (shipping flows)', () => {
        expect(buildCheckoutSessionParams(base)).not.toHaveProperty('allow_promotion_codes');
        expect(buildCheckoutSessionParams({ ...base, allowPromotionCodes: true })
            .allow_promotion_codes).toBe(true);
    });

    it('sets customer_email and receipt_email independently', () => {
        // speculative settlement: customer_email but deliberately NO receipt_email
        const spec = buildCheckoutSessionParams({ ...base, customerEmail: 'a@b.com' });
        expect(spec.customer_email).toBe('a@b.com');
        expect(spec).not.toHaveProperty('receipt_email');

        // linked buyer: both
        const linked = buildCheckoutSessionParams({ ...base, customerEmail: 'a@b.com', receiptEmail: 'a@b.com' });
        expect(linked.customer_email).toBe('a@b.com');
        expect(linked.receipt_email).toBe('a@b.com');
    });

    it('includes custom_fields when provided (even empty), omits when undefined', () => {
        expect(buildCheckoutSessionParams({ ...base, customFields: [] }).custom_fields).toEqual([]);
        const field = [{ key: 'discord_username' }];
        expect(buildCheckoutSessionParams({ ...base, customFields: field }).custom_fields).toBe(field);
        // web-shipping / speculative omit custom_fields entirely
        expect(buildCheckoutSessionParams(base)).not.toHaveProperty('custom_fields');
    });

    it('supports shipping options + address collection independently', () => {
        // card/pull/product: both
        const full = buildCheckoutSessionParams({
            ...base,
            shippingOptions: [{ shipping_rate_data: {} }],
            shippingAddressCollection: { allowed_countries: ['US'] },
        });
        expect(full.shipping_options).toBeDefined();
        expect(full.shipping_address_collection).toEqual({ allowed_countries: ['US'] });

        // ad-hoc / web shipping: address collection ALONE, no options
        const addrOnly = buildCheckoutSessionParams({
            ...base,
            shippingAddressCollection: { allowed_countries: ['US', 'CA'] },
        });
        expect(addrOnly).not.toHaveProperty('shipping_options');
        expect(addrOnly.shipping_address_collection).toEqual({ allowed_countries: ['US', 'CA'] });

        // battle / speculative: neither
        expect(buildCheckoutSessionParams(base)).not.toHaveProperty('shipping_options');
        expect(buildCheckoutSessionParams(base)).not.toHaveProperty('shipping_address_collection');
    });

    it('sets expires_at only when provided (speculative settlement)', () => {
        expect(buildCheckoutSessionParams(base)).not.toHaveProperty('expires_at');
        expect(buildCheckoutSessionParams({ ...base, expiresAt: 123 }).expires_at).toBe(123);
    });

    it('does NOT set payment_intent_data — TOS mirroring stays caller-side', () => {
        expect(buildCheckoutSessionParams(base)).not.toHaveProperty('payment_intent_data');
    });

    it('throws on missing required inputs', () => {
        expect(() => buildCheckoutSessionParams({ successUrl: 'x', cancelUrl: 'y' })).toThrow();
        expect(() => buildCheckoutSessionParams({ ...base, successUrl: '' })).toThrow();
    });
});
