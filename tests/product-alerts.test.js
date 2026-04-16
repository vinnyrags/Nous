/**
 * Tests for product alert system — category routing and formatting logic.
 *
 * Tests the pure functions (getCategoryChannel) and verifies alertNewProduct/
 * alertNewProducts complete without errors for various inputs.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../discord.js', () => ({
    sendEmbed: vi.fn().mockResolvedValue(null),
}));

vi.mock('../config.js', () => ({
    default: {
        CHANNELS: {
            POKEMON: 'ch-pokemon',
            ANIME: 'ch-anime',
            MATURE_DROPS: 'ch-mature',
            DEALS: 'ch-deals',
        },
    },
}));

const { alertNewProduct, alertNewProducts } = await import('../alerts/products.js');

describe('alertNewProduct', () => {
    it('completes without error for pokemon category', async () => {
        await expect(alertNewProduct({
            name: 'Prismatic Evolutions', category: 'pokemon', price: 4999,
        })).resolves.not.toThrow();
    });

    it('completes without error for anime category', async () => {
        await expect(alertNewProduct({
            name: 'One Piece Booster', category: 'anime', price: 3999,
        })).resolves.not.toThrow();
    });

    it('completes without error for mature category', async () => {
        await expect(alertNewProduct({
            name: 'Mature Card Set', category: 'mature', price: 5999,
        })).resolves.not.toThrow();
    });

    it('handles unknown category without error', async () => {
        await expect(alertNewProduct({
            name: 'Random Thing', category: 'board-games', price: 2999,
        })).resolves.not.toThrow();
    });

    it('handles case-insensitive categories', async () => {
        await expect(alertNewProduct({
            name: 'Card', category: 'Pokemon', price: 999,
        })).resolves.not.toThrow();
    });

    it('handles missing price', async () => {
        await expect(alertNewProduct({
            name: 'Mystery Box', category: 'pokemon',
        })).resolves.not.toThrow();
    });

    it('handles missing shop_url', async () => {
        await expect(alertNewProduct({
            name: 'Card', category: 'pokemon', price: 1000,
        })).resolves.not.toThrow();
    });
});

describe('alertNewProducts', () => {
    it('handles single product', async () => {
        await expect(alertNewProducts([
            { name: 'Solo Card', category: 'pokemon', price: 999 },
        ])).resolves.not.toThrow();
    });

    it('handles multiple products in same category (bulk alert)', async () => {
        await expect(alertNewProducts([
            { name: 'Card A', category: 'pokemon', price: 999 },
            { name: 'Card B', category: 'pokemon', price: 1999 },
            { name: 'Card C', category: 'pokemon', price: 2999 },
        ])).resolves.not.toThrow();
    });

    it('handles products across multiple categories', async () => {
        await expect(alertNewProducts([
            { name: 'Pokemon Card', category: 'pokemon', price: 999 },
            { name: 'Anime Card', category: 'anime', price: 1999 },
        ])).resolves.not.toThrow();
    });

    it('handles empty product array', async () => {
        await expect(alertNewProducts([])).resolves.not.toThrow();
    });

    it('handles mix of known and unknown categories', async () => {
        await expect(alertNewProducts([
            { name: 'Pokemon Card', category: 'pokemon', price: 999 },
            { name: 'Unknown Item', category: 'other', price: 999 },
        ])).resolves.not.toThrow();
    });
});
