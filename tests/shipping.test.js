/**
 * Tests for !shipping command — permission guards and input validation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockMessage, createMockMention } from './mocks.js';

const ROLE_AKIVILI = '1488046525065072670';
const ROLE_NANOOK = '1488046525899739148';

vi.mock('../discord.js', () => ({
    client: { channels: { cache: { get: vi.fn() } } },
    getMember: vi.fn().mockResolvedValue({
        createDM: vi.fn().mockResolvedValue({
            send: vi.fn().mockResolvedValue({}),
        }),
    }),
}));

vi.mock('../config.js', () => ({
    default: {
        ROLES: { AKIVILI: '1488046525065072670', NANOOK: '1488046525899739148' },
        SHOP_URL: 'https://example.com/shop',
    },
}));

const { handleShipping } = await import('../commands/shipping.js');

beforeEach(() => {
    vi.clearAllMocks();
});

describe('!shipping permission guards', () => {
    it('rejects non-owner', async () => {
        const msg = createMockMessage({ roles: [] });
        await handleShipping(msg, []);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Only the server owner')
        );
    });

    it('rejects moderators (Nanook only, not Akivili)', async () => {
        const msg = createMockMessage({ roles: [ROLE_NANOOK] });
        await handleShipping(msg, []);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Only the server owner')
        );
    });
});

describe('!shipping input validation', () => {
    it('requires a mentioned user', async () => {
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleShipping(msg, ['10.00']);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Usage:')
        );
    });

    it('requires an amount', async () => {
        const buyer = createMockMention('buyer123');
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        msg.mentions.users.first = vi.fn().mockReturnValue(buyer);

        await handleShipping(msg, ['@buyer']);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Include an amount')
        );
    });

    it('rejects zero amount', async () => {
        const buyer = createMockMention('buyer123');
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        msg.mentions.users.first = vi.fn().mockReturnValue(buyer);

        await handleShipping(msg, ['@buyer', '0']);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('greater than zero')
        );
    });
});

describe('!shipping sends DM', () => {
    it('sends a shipping DM for valid input', async () => {
        const { getMember } = await import('../discord.js');
        const mockSend = vi.fn().mockResolvedValue({});
        getMember.mockResolvedValue({
            createDM: vi.fn().mockResolvedValue({ send: mockSend }),
        });

        const buyer = createMockMention('buyer123');
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        msg.mentions.users.first = vi.fn().mockReturnValue(buyer);

        await handleShipping(msg, ['@buyer', '10.00']);

        expect(getMember).toHaveBeenCalledWith('buyer123');
        expect(mockSend).toHaveBeenCalledWith(
            expect.objectContaining({
                embeds: expect.arrayContaining([
                    expect.objectContaining({
                        data: expect.objectContaining({
                            title: '📦 Shipping',
                            description: expect.stringContaining('$10.00'),
                        }),
                    }),
                ]),
            })
        );
        expect(msg.channel.send).toHaveBeenCalledWith(
            expect.stringContaining('$10.00')
        );
    });

    it('includes custom reason in the DM', async () => {
        const { getMember } = await import('../discord.js');
        const mockSend = vi.fn().mockResolvedValue({});
        getMember.mockResolvedValue({
            createDM: vi.fn().mockResolvedValue({ send: mockSend }),
        });

        const buyer = createMockMention('buyer123');
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        msg.mentions.users.first = vi.fn().mockReturnValue(buyer);

        await handleShipping(msg, ['@buyer', '5.00', 'Custom', 'order', 'shipping']);

        expect(mockSend).toHaveBeenCalledWith(
            expect.objectContaining({
                embeds: expect.arrayContaining([
                    expect.objectContaining({
                        data: expect.objectContaining({
                            title: '📦 Custom order shipping',
                        }),
                    }),
                ]),
            })
        );
    });

    it('falls back to channel message if DMs are disabled', async () => {
        const { getMember } = await import('../discord.js');
        getMember.mockResolvedValue({
            createDM: vi.fn().mockRejectedValue(new Error('Cannot send DMs')),
        });

        const buyer = createMockMention('buyer123');
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        msg.mentions.users.first = vi.fn().mockReturnValue(buyer);

        await handleShipping(msg, ['@buyer', '10.00']);

        expect(msg.channel.send).toHaveBeenCalledWith(
            expect.objectContaining({
                content: expect.stringContaining('buyer123'),
                embeds: expect.any(Array),
            })
        );
    });
});
