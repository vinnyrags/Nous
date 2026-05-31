import { describe, it, expect, vi } from 'vitest';
import { preflightPriceActive } from './prices.js';

function stripeWithPrice(priceOrError) {
    return {
        prices: {
            retrieve: vi.fn().mockImplementation(() =>
                priceOrError instanceof Error
                    ? Promise.reject(priceOrError)
                    : Promise.resolve(priceOrError)
            ),
        },
    };
}

describe('preflightPriceActive', () => {
    it('returns null for an active price with an active product', async () => {
        const stripe = stripeWithPrice({ active: true, product: { active: true } });
        const out = await preflightPriceActive(stripe, 'price_1');
        expect(stripe.prices.retrieve).toHaveBeenCalledWith('price_1', { expand: ['product'] });
        expect(out).toBeNull();
    });

    it('returns null when product is just a string id (not expanded inactive check)', async () => {
        const stripe = stripeWithPrice({ active: true, product: 'prod_1' });
        expect(await preflightPriceActive(stripe, 'price_1')).toBeNull();
    });

    it('blocks price_inactive with the supplied message', async () => {
        const stripe = stripeWithPrice({ active: false, product: { active: true } });
        const out = await preflightPriceActive(stripe, 'price_1', { inactiveMessage: 'archived!' });
        expect(out).toEqual({ code: 'price_inactive', message: 'archived!' });
    });

    it('blocks product_inactive when the expanded product is archived', async () => {
        const stripe = stripeWithPrice({ active: true, product: { active: false } });
        const out = await preflightPriceActive(stripe, 'price_1', { inactiveMessage: 'archived!' });
        expect(out).toEqual({ code: 'product_inactive', message: 'archived!' });
    });

    it('blocks price_not_found on a "No such price" StripeInvalidRequestError', async () => {
        const err = Object.assign(new Error('No such price: price_x'), { type: 'StripeInvalidRequestError' });
        const stripe = stripeWithPrice(err);
        const out = await preflightPriceActive(stripe, 'price_x', { notFoundMessage: 'wrong mode' });
        expect(out).toEqual({ code: 'price_not_found', message: 'wrong mode', detail: 'No such price: price_x' });
    });

    it('returns null (not a block) on network/auth errors so the real error surfaces later', async () => {
        const err = Object.assign(new Error('rate limited'), { type: 'StripeRateLimitError' });
        const stripe = stripeWithPrice(err);
        expect(await preflightPriceActive(stripe, 'price_1')).toBeNull();
    });

    it('uses generic default messages when none are supplied', async () => {
        const stripe = stripeWithPrice({ active: false, product: { active: true } });
        const out = await preflightPriceActive(stripe, 'price_1');
        expect(out.message).toBe('This product is archived in Stripe.');
    });
});
