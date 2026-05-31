import { describe, it, expect, vi } from 'vitest';
import { listActiveProducts } from './products.js';

function stripeWithPages(pages) {
    let call = 0;
    return {
        products: {
            list: vi.fn().mockImplementation(() => Promise.resolve(pages[call++])),
        },
    };
}

describe('listActiveProducts', () => {
    it('maps a single page to { id, name, defaultPriceId }', async () => {
        const stripe = stripeWithPages([
            { has_more: false, data: [
                { id: 'prod_1', name: 'Booster Pack', default_price: 'price_1' },
                { id: 'prod_2', name: 'Sleeves', default_price: null },
            ] },
        ]);
        const out = await listActiveProducts(stripe);
        expect(stripe.products.list).toHaveBeenCalledWith({ active: true, limit: 100 });
        expect(out).toEqual([
            { id: 'prod_1', name: 'Booster Pack', defaultPriceId: 'price_1' },
            { id: 'prod_2', name: 'Sleeves', defaultPriceId: null },
        ]);
    });

    it('coerces a missing default_price to null', async () => {
        const stripe = stripeWithPages([
            { has_more: false, data: [{ id: 'prod_1', name: 'X' }] },
        ]);
        const out = await listActiveProducts(stripe);
        expect(out[0].defaultPriceId).toBeNull();
    });

    it('paginates with starting_after until has_more is false', async () => {
        const stripe = stripeWithPages([
            { has_more: true, data: [{ id: 'prod_a', name: 'A', default_price: 'p_a' }] },
            { has_more: false, data: [{ id: 'prod_b', name: 'B', default_price: 'p_b' }] },
        ]);
        const out = await listActiveProducts(stripe);
        expect(stripe.products.list).toHaveBeenCalledTimes(2);
        expect(stripe.products.list).toHaveBeenNthCalledWith(1, { active: true, limit: 100 });
        expect(stripe.products.list).toHaveBeenNthCalledWith(2, { active: true, limit: 100, starting_after: 'prod_a' });
        expect(out.map((p) => p.id)).toEqual(['prod_a', 'prod_b']);
    });

    it('stops at the maxPages bound even if has_more stays true', async () => {
        const stripe = {
            products: {
                list: vi.fn().mockResolvedValue({ has_more: true, data: [{ id: 'prod_x', name: 'X', default_price: null }] }),
            },
        };
        await listActiveProducts(stripe, { maxPages: 3 });
        expect(stripe.products.list).toHaveBeenCalledTimes(3);
    });

    it('returns an empty list when the catalog is empty', async () => {
        const stripe = stripeWithPages([{ has_more: false, data: [] }]);
        expect(await listActiveProducts(stripe)).toEqual([]);
    });
});
