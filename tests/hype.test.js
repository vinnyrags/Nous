/**
 * Tests for !hype command — permission guards, input validation, and Stripe lookup.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockMessage } from './mocks.js';

const ROLE_AKIVILI = '1488046525065072670';
const ROLE_NANOOK = '1488046525899739148';

vi.mock('../discord.js', () => ({
    client: { channels: { cache: { get: vi.fn() } } },
    sendToChannel: vi.fn().mockResolvedValue(null),
    sendEmbed: vi.fn().mockResolvedValue(null),
}));

vi.mock('../config.js', () => ({
    default: {
        ROLES: { AKIVILI: '1488046525065072670', NANOOK: '1488046525899739148' },
        SHOP_URL: 'https://example.com/shop',
        STRIPE_SECRET_KEY: 'sk_test_123',
    },
}));

// Mock Stripe — prevent real API calls
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        products: {
            search: vi.fn().mockResolvedValue({ data: [] }),
        },
        prices: {
            list: vi.fn().mockResolvedValue({ data: [] }),
            retrieve: vi.fn().mockResolvedValue({ unit_amount: 1000 }),
        },
    })),
}));

const { handleHype } = await import('../commands/hype.js');

beforeEach(() => {
    vi.clearAllMocks();
});

describe('!hype permission guards', () => {
    it('rejects non-admin', async () => {
        const msg = createMockMessage({ roles: [] });
        await handleHype(msg, []);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Only moderators')
        );
    });

    it('allows Akivili', async () => {
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleHype(msg, []);
        // Should get usage message, not permission denial
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Usage:')
        );
    });

    it('allows Nanook', async () => {
        const msg = createMockMessage({ roles: [ROLE_NANOOK] });
        await handleHype(msg, []);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Usage:')
        );
    });
});

describe('!hype input validation', () => {
    it('requires product names', async () => {
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleHype(msg, []);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Usage:')
        );
    });

    it('reports products not found in Stripe', async () => {
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleHype(msg, ['Nonexistent', 'Product']);
        // Should report not found and say nothing to post
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('No products found')
        );
    });
});

describe('!hype Stripe lookup', () => {
    it('searches Stripe for each comma-separated product', async () => {
        const Stripe = (await import('stripe')).default;
        const mockSearch = vi.fn().mockResolvedValue({ data: [] });
        Stripe.mockImplementation(() => ({
            products: { search: mockSearch },
            prices: {
                list: vi.fn().mockResolvedValue({ data: [] }),
                retrieve: vi.fn().mockResolvedValue({ unit_amount: 1000 }),
            },
        }));

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleHype(msg, ['Product', 'A,', 'Product', 'B']);

        // Should have searched for both products
        expect(mockSearch).toHaveBeenCalledTimes(2);
    });
});
