/**
 * Tests for !sync command — output parsing, permission guards, and alert integration.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockMessage } from './mocks.js';

const ROLE_AKIVILI = '1488046525065072670';
const ROLE_NANOOK = '1488046525899739148';

// =========================================================================
// Output parsing (pure functions, no mocks needed)
// =========================================================================

// Import parsers directly — these are pure functions
const { parseSummary, parsePushNewProducts, parsePullNewProducts } = await import('../commands/sync.js');

describe('parseSummary', () => {
    it('extracts the Done line from push output', () => {
        const output = `Found 13 product(s) in Google Sheets.

  Updated: Product A [pokemon, ENG, stock:1]
  Created: Product B ($10.99) [anime, JPN, stock:2]

Done: 1 created, 12 updated, 0 skipped.`;

        expect(parseSummary(output)).toBe('1 created, 12 updated, 0 skipped.');
    });

    it('extracts the Done line from pull output', () => {
        const output = `Cleaning: deleting all existing WordPress products...
  11 product(s) permanently deleted.

Fetching products from Stripe...
  Created (published): Product A (ID 123) [pokemon, ENG, stock:1]

Done: 1 created, 0 updated, 0 skipped.`;

        expect(parseSummary(output)).toBe('1 created, 0 updated, 0 skipped.');
    });

    it('returns null when no Done line found', () => {
        expect(parseSummary('Some random output')).toBeNull();
        expect(parseSummary('')).toBeNull();
    });
});

describe('parsePushNewProducts', () => {
    it('parses created products with name, price, and category', () => {
        const output = `  Updated: Existing Product [pokemon, ENG, stock:1]
  Created: Pokemon Astral Radiance ($10.99) [pokemon, ENG, stock:12]
    Sale price created: $9.99
    Sale active: $9.99
  Created: Pokemon Lost Origin ($15.99) [pokemon, ENG, stock:7]
    Sale price created: $13.99

Done: 2 created, 1 updated, 0 skipped.`;

        const products = parsePushNewProducts(output);
        expect(products).toHaveLength(2);

        expect(products[0].name).toBe('Pokemon Astral Radiance');
        expect(products[0].price).toBe(1099);
        expect(products[0].category).toBe('pokemon');

        expect(products[1].name).toBe('Pokemon Lost Origin');
        expect(products[1].price).toBe(1599);
        expect(products[1].category).toBe('pokemon');
    });

    it('returns empty array when no products created', () => {
        const output = `  Updated: Product A [anime, JPN, stock:1]

Done: 0 created, 1 updated, 0 skipped.`;

        expect(parsePushNewProducts(output)).toHaveLength(0);
    });

    it('does not match Updated lines', () => {
        const output = `  Updated: Some Product [pokemon, ENG, stock:5]`;
        expect(parsePushNewProducts(output)).toHaveLength(0);
    });

    it('handles multiple categories', () => {
        const output = `  Created: Pokemon Card ($5.00) [pokemon, ENG, stock:1]
  Created: Anime Card ($8.00) [anime, JPN, stock:2]
  Created: Mature Card ($12.00) [mature, ENG, stock:1]`;

        const products = parsePushNewProducts(output);
        expect(products).toHaveLength(3);
        expect(products[0].category).toBe('pokemon');
        expect(products[1].category).toBe('anime');
        expect(products[2].category).toBe('mature');
    });
});

describe('parsePullNewProducts', () => {
    it('parses created (published) products with name and category', () => {
        const output = `  Created (published): Pokemon Lost Origin (ID 595) [pokemon, ENG, stock:7]
  Created (published): Weiss Schwarz JoJo (ID 619) [anime, JPN, stock:1]`;

        const products = parsePullNewProducts(output);
        expect(products).toHaveLength(2);

        expect(products[0].name).toBe('Pokemon Lost Origin');
        expect(products[0].category).toBe('pokemon');

        expect(products[1].name).toBe('Weiss Schwarz JoJo');
        expect(products[1].category).toBe('anime');
    });

    it('returns empty array when no products created', () => {
        const output = `Fetching products from Stripe...
Done: 0 created, 5 updated, 0 skipped.`;

        expect(parsePullNewProducts(output)).toHaveLength(0);
    });
});

// =========================================================================
// Command handler tests (mocked Discord + child_process)
// =========================================================================

vi.mock('../discord.js', () => ({
    client: { channels: { cache: { get: vi.fn() } } },
    getChannel: vi.fn(),
    sendToChannel: vi.fn().mockResolvedValue(null),
    sendEmbed: vi.fn().mockResolvedValue(null),
    getMember: vi.fn().mockResolvedValue(null),
}));

vi.mock('../config.js', () => ({
    default: {
        CHANNELS: {
            OPS: '1',
            POKEMON: '2',
            ANIME: '3',
            MATURE_DROPS: '4',
            DEALS: '5',
            GIVEAWAYS: '6',
        },
        ROLES: {
            AKIVILI: '1488046525065072670',
            NANOOK: '1488046525899739148',
        },
        SHOP_URL: 'https://example.com/shop',
    },
}));

vi.mock('../alerts/products.js', () => ({
    alertNewProducts: vi.fn().mockResolvedValue(undefined),
    alertNewProduct: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('node:child_process', () => ({
    execFile: vi.fn(),
}));

const { sendToChannel } = await import('../discord.js');
const { alertNewProducts: mockAlertNewProducts } = await import('../alerts/products.js');
const { execFile } = await import('node:child_process');
const { handleSync } = await import('../commands/sync.js');

// Mock execFile to return test output
function mockExec(pushOutput, pullOutput) {
    let callCount = 0;
    execFile.mockImplementation((cmd, args, opts, callback) => {
        callCount++;
        if (callCount === 1) {
            callback(null, { stdout: pushOutput || '' });
        } else {
            callback(null, { stdout: pullOutput || '' });
        }
    });
}

function mockExecSingle(output) {
    execFile.mockImplementation((cmd, args, opts, callback) => {
        callback(null, { stdout: output || '' });
    });
}

function mockExecError(errorMessage) {
    execFile.mockImplementation((cmd, args, opts, callback) => {
        callback(new Error(errorMessage));
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

describe('!sync permission guard', () => {
    it('rejects non-owner', async () => {
        const msg = createMockMessage({ roles: [ROLE_NANOOK] });
        await handleSync(msg, []);
        expect(msg.reply).toHaveBeenCalledWith(expect.stringContaining('Only the owner'));
    });

    it('allows Akivili role', async () => {
        mockExec(
            'Done: 0 created, 1 updated, 0 skipped.',
            'Done: 1 created, 0 updated, 0 skipped.'
        );
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleSync(msg, []);
        // Should not reject — check that sync started
        expect(msg.channel.send).toHaveBeenCalledWith(expect.stringContaining('Syncing products'));
    });
});

describe('!sync (full pipeline)', () => {
    it('runs both steps and posts summary to #ops', async () => {
        mockExec(
            'Done: 2 created, 11 updated, 0 skipped.',
            'Done: 13 created, 0 updated, 0 skipped.'
        );

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleSync(msg, []);

        // Status updates posted to channel
        expect(msg.channel.send).toHaveBeenCalledWith(expect.stringContaining('Sheets → Stripe → WordPress'));
        expect(msg.channel.send).toHaveBeenCalledWith(expect.stringContaining('Sheets → Stripe** complete'));
        expect(msg.channel.send).toHaveBeenCalledWith(expect.stringContaining('Stripe → WordPress** complete'));

        // Summary posted to #ops
        expect(sendToChannel).toHaveBeenCalledWith('OPS', expect.stringContaining('Product Sync Complete'));
    });

    it('triggers alerts for new products with prices', async () => {
        const pushOutput = [
            '  Updated: Old Product [anime, JPN, stock:1]',
            '  Created: New Pokemon Card ($10.99) [pokemon, ENG, stock:5]',
            '  Created: New Anime Card ($25.00) [anime, JPN, stock:2]',
            '',
            'Done: 2 created, 1 updated, 0 skipped.',
        ].join('\n');

        mockExec(pushOutput, 'Done: 3 created, 0 updated, 0 skipped.');

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleSync(msg, []);

        expect(mockAlertNewProducts).toHaveBeenCalledTimes(1);
        expect(mockAlertNewProducts).toHaveBeenCalledWith([
            { name: 'New Pokemon Card', price: 1099, category: 'pokemon', shop_url: 'https://example.com/shop' },
            { name: 'New Anime Card', price: 2500, category: 'anime', shop_url: 'https://example.com/shop' },
        ]);
    });

    it('does not trigger alerts when no new products', async () => {
        mockExec(
            'Done: 0 created, 5 updated, 0 skipped.',
            'Done: 5 created, 0 updated, 0 skipped.'
        );

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleSync(msg, []);

        expect(mockAlertNewProducts).not.toHaveBeenCalled();
    });

    it('handles errors gracefully', async () => {
        mockExecError('Connection refused');

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleSync(msg, []);

        expect(msg.channel.send).toHaveBeenCalledWith(expect.stringContaining('Sync failed'));
    });
});

describe('!sync stripe', () => {
    it('skips Sheets step and only runs Stripe → WordPress', async () => {
        mockExecSingle('Done: 13 created, 0 updated, 0 skipped.');

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleSync(msg, ['stripe']);

        // Should say Stripe → WordPress, not Sheets
        expect(msg.channel.send).toHaveBeenCalledWith(expect.stringContaining('Stripe → WordPress...'));
        expect(msg.channel.send).not.toHaveBeenCalledWith(expect.stringContaining('Sheets'));

        // Only one exec call (pull only)
        expect(execFile).toHaveBeenCalledTimes(1);
    });

    it('triggers alerts for new products from pull output', async () => {
        const pullOutput = [
            '  Created (published): New Card (ID 100) [pokemon, ENG, stock:3]',
            '',
            'Done: 1 created, 0 updated, 0 skipped.',
        ].join('\n');

        mockExecSingle(pullOutput);

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleSync(msg, ['stripe']);

        expect(mockAlertNewProducts).toHaveBeenCalledTimes(1);
        expect(mockAlertNewProducts).toHaveBeenCalledWith([
            { name: 'New Card', category: 'pokemon', shop_url: 'https://example.com/shop' },
        ]);
    });
});
