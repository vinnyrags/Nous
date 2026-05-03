/**
 * Unit tests for the Stripe product cache used by /battle and /hype
 * autocomplete. The cache itself is lightweight — most of the value
 * is in `suggest()` matching behavior.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock Stripe at the module boundary so tests don't hit the network.
const mockProductsList = vi.fn();
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        products: { list: mockProductsList },
    })),
}));

// Stub config so the import chain succeeds
vi.mock('../config.js', () => ({
    default: { STRIPE_SECRET_KEY: 'sk_test_dummy' },
}));

let productCache;

beforeEach(async () => {
    vi.resetModules();
    mockProductsList.mockReset();
    productCache = await import('../lib/product-cache.js');
});

describe('product-cache.refresh', () => {
    it('populates cache from Stripe paginated list', async () => {
        mockProductsList.mockResolvedValueOnce({
            data: [
                { id: 'prod_1', name: 'Crown Zenith ETB', default_price: 'price_1' },
                { id: 'prod_2', name: 'Prismatic Evolutions Booster Box', default_price: 'price_2' },
            ],
            has_more: false,
        });
        await productCache.refresh();
        expect(productCache.size()).toBe(2);
    });

    it('handles pagination across multiple pages', async () => {
        mockProductsList
            .mockResolvedValueOnce({
                data: Array.from({ length: 100 }, (_, i) => ({
                    id: `prod_${i}`,
                    name: `Product ${i}`,
                    default_price: `price_${i}`,
                })),
                has_more: true,
            })
            .mockResolvedValueOnce({
                data: [{ id: 'prod_100', name: 'Product 100', default_price: 'price_100' }],
                has_more: false,
            });
        await productCache.refresh();
        expect(productCache.size()).toBe(101);
    });

    it('coalesces concurrent refresh calls into a single request', async () => {
        mockProductsList.mockResolvedValueOnce({
            data: [{ id: 'prod_1', name: 'Test Product', default_price: 'price_1' }],
            has_more: false,
        });
        const [a, b, c] = await Promise.all([
            productCache.refresh(),
            productCache.refresh(),
            productCache.refresh(),
        ]);
        // All three resolve to the same in-flight promise
        expect(a).toBe(b);
        expect(b).toBe(c);
        // Stripe was only called once
        expect(mockProductsList).toHaveBeenCalledTimes(1);
    });

    it('handles Stripe errors gracefully (cache stays usable)', async () => {
        mockProductsList.mockRejectedValueOnce(new Error('Stripe down'));
        await productCache.refresh(); // does not throw
        expect(productCache.size()).toBe(0);
    });
});

describe('product-cache.suggest', () => {
    beforeEach(async () => {
        mockProductsList.mockResolvedValueOnce({
            data: [
                { id: 'p1', name: 'Crown Zenith ETB', default_price: 'pr_1' },
                { id: 'p2', name: 'Crown Zenith Mini Tin', default_price: 'pr_2' },
                { id: 'p3', name: 'Prismatic Evolutions Booster Box', default_price: 'pr_3' },
                { id: 'p4', name: 'Charizard Holo', default_price: 'pr_4' },
            ],
            has_more: false,
        });
        await productCache.refresh();
    });

    it('matches by lowercase prefix', () => {
        const matches = productCache.suggest('crown');
        expect(matches.length).toBe(2);
        expect(matches[0].name).toContain('Crown Zenith');
    });

    it('also matches case-insensitive substring (not just prefix)', () => {
        const matches = productCache.suggest('zenith');
        expect(matches.length).toBe(2);
    });

    it('returns first N entries when query is empty', () => {
        const matches = productCache.suggest('');
        expect(matches.length).toBe(4);
    });

    it('respects the limit cap', () => {
        const matches = productCache.suggest('', 2);
        expect(matches.length).toBe(2);
    });

    it('returns Discord-shaped {name, value} pairs', () => {
        const matches = productCache.suggest('charizard');
        expect(matches[0]).toEqual({ name: 'Charizard Holo', value: 'Charizard Holo' });
    });

    it('truncates names longer than 100 chars (Discord cap)', async () => {
        vi.resetModules();
        mockProductsList.mockReset();
        mockProductsList.mockResolvedValueOnce({
            data: [
                { id: 'long', name: 'x'.repeat(150), default_price: 'pr' },
            ],
            has_more: false,
        });
        const fresh = await import('../lib/product-cache.js');
        await fresh.refresh();
        const matches = fresh.suggest('x');
        expect(matches[0].name.length).toBeLessThanOrEqual(100);
        expect(matches[0].value.length).toBeLessThanOrEqual(100);
    });
});
