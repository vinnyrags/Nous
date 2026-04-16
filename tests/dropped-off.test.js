/**
 * Tests for !dropped-off command — permission guards, DM flow, and DB updates.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockMessage } from './mocks.js';
import { createTestDb, buildStmts } from './setup.js';

const ROLE_AKIVILI = '1488046525065072670';
const ROLE_NANOOK = '1488046525899739148';

let stmts;
let mockGetMember;
let mockSendEmbed;
let mockSendToChannel;

vi.mock('../discord.js', () => ({
    client: { channels: { cache: { get: vi.fn() } } },
    getMember: vi.fn(),
    sendEmbed: vi.fn().mockResolvedValue({}),
    sendToChannel: vi.fn().mockResolvedValue({}),
}));

vi.mock('../config.js', () => ({
    default: {
        ROLES: { AKIVILI: '1488046525065072670', NANOOK: '1488046525899739148' },
        CHANNELS: { ORDER_FEED: 'order-feed', OPS: 'ops' },
        SHOP_URL: 'https://example.com/shop',
        SHIPPING: { DOMESTIC: 1000, INTERNATIONAL: 2500 },
    },
}));

vi.mock('../db.js', () => ({
    purchases: {
        getUnshipped: { all: vi.fn() },
        getUnshippedNoDiscord: { all: vi.fn() },
        markShipped: { run: vi.fn() },
    },
    discordLinks: {
        getCountry: { get: vi.fn().mockReturnValue(null) },
    },
    queues: {
        getActiveQueue: { get: vi.fn().mockReturnValue(null) },
        getEntries: { all: vi.fn().mockReturnValue([]) },
    },
    shipping: {
        getByEmailThisMonth: { get: vi.fn().mockReturnValue(null) },
    },
}));

const discordModule = await import('../discord.js');
const { purchases } = await import('../db.js');
const { handleDroppedOff } = await import('../commands/dropped-off.js');

beforeEach(() => {
    vi.clearAllMocks();
    mockGetMember = discordModule.getMember;
    mockSendEmbed = discordModule.sendEmbed;
    mockSendToChannel = discordModule.sendToChannel;

    // Default: no unshipped orders
    purchases.getUnshipped.all.mockReturnValue([]);
    purchases.getUnshippedNoDiscord.all.mockReturnValue([]);
});

describe('!dropped-off permission guards', () => {
    it('rejects non-owner', async () => {
        const msg = createMockMessage({ roles: [] });
        await handleDroppedOff(msg);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Only the server owner')
        );
    });

    it('rejects moderators (Nanook only, not Akivili)', async () => {
        const msg = createMockMessage({ roles: [ROLE_NANOOK] });
        await handleDroppedOff(msg);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Only the server owner')
        );
    });
});

describe('!dropped-off with no unshipped orders', () => {
    it('reports no orders to notify', async () => {
        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleDroppedOff(msg);
        expect(msg.reply).toHaveBeenCalledWith('No unshipped orders to notify.');
        expect(purchases.markShipped.run).not.toHaveBeenCalled();
    });
});

describe('!dropped-off DM flow', () => {
    it('DMs each unique buyer and posts to order-feed and ops', async () => {
        const mockSend = vi.fn().mockResolvedValue({});
        mockGetMember.mockResolvedValue({
            createDM: vi.fn().mockResolvedValue({ send: mockSend }),
        });

        purchases.getUnshipped.all.mockReturnValue([
            { id: 1, discord_user_id: 'user1', product_name: 'Pokemon Box', amount: 5000 },
            { id: 2, discord_user_id: 'user1', product_name: 'Booster Pack', amount: 500 },
            { id: 3, discord_user_id: 'user2', product_name: 'Anime Box', amount: 4000 },
        ]);
        purchases.getUnshippedNoDiscord.all.mockReturnValue([]);

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleDroppedOff(msg);

        // Should DM 2 unique users
        expect(mockGetMember).toHaveBeenCalledTimes(2);
        expect(mockSend).toHaveBeenCalledTimes(2);

        // First DM should list both products
        const firstDm = mockSend.mock.calls[0][0];
        expect(firstDm.embeds[0].data.description).toContain('Pokemon Box');
        expect(firstDm.embeds[0].data.description).toContain('Booster Pack');

        // Second DM should list anime box
        const secondDm = mockSend.mock.calls[1][0];
        expect(secondDm.embeds[0].data.description).toContain('Anime Box');

        // Should post public embed in #order-feed
        expect(mockSendEmbed).toHaveBeenCalledWith('ORDER_FEED', expect.objectContaining({
            title: '📬 Orders Shipped!',
            description: expect.stringContaining('3 orders shipped to 2 buyers'),
        }));

        // Should post summary embed in #ops
        expect(mockSendEmbed).toHaveBeenCalledWith('OPS', expect.objectContaining({
            title: expect.stringContaining('Dropped Off Summary'),
        }));

        // Should mark all as shipped
        expect(purchases.markShipped.run).toHaveBeenCalled();

        // Should confirm in channel with embed
        expect(msg.channel.send).toHaveBeenCalledWith(expect.objectContaining({
            embeds: expect.arrayContaining([
                expect.objectContaining({
                    data: expect.objectContaining({
                        title: expect.stringContaining('Dropped Off Complete'),
                    }),
                }),
            ]),
        }));
    });

    it('aggregates duplicate product names per user', async () => {
        const mockSend = vi.fn().mockResolvedValue({});
        mockGetMember.mockResolvedValue({
            createDM: vi.fn().mockResolvedValue({ send: mockSend }),
        });

        purchases.getUnshipped.all.mockReturnValue([
            { id: 1, discord_user_id: 'user1', product_name: 'Booster Pack', amount: 500 },
            { id: 2, discord_user_id: 'user1', product_name: 'Booster Pack', amount: 500 },
            { id: 3, discord_user_id: 'user1', product_name: 'Booster Pack', amount: 500 },
        ]);
        purchases.getUnshippedNoDiscord.all.mockReturnValue([]);

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleDroppedOff(msg);

        const dm = mockSend.mock.calls[0][0];
        expect(dm.embeds[0].data.description).toContain('Booster Pack (×3)');
    });

    it('reports skipped orders without linked Discord', async () => {
        const mockSend = vi.fn().mockResolvedValue({});
        mockGetMember.mockResolvedValue({
            createDM: vi.fn().mockResolvedValue({ send: mockSend }),
        });

        purchases.getUnshipped.all.mockReturnValue([
            { id: 1, discord_user_id: 'user1', product_name: 'Pokemon Box', amount: 5000 },
        ]);
        purchases.getUnshippedNoDiscord.all.mockReturnValue([
            { id: 2, customer_email: 'nolink@test.com', product_name: 'Anime Box', amount: 4000 },
        ]);

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleDroppedOff(msg);

        // Ops summary should mention skipped
        expect(mockSendEmbed).toHaveBeenCalledWith('OPS', expect.objectContaining({
            description: expect.stringContaining('1 orders skipped'),
        }));

        // Order feed should count total (linked + unlinked)
        expect(mockSendEmbed).toHaveBeenCalledWith('ORDER_FEED', expect.objectContaining({
            description: expect.stringContaining('2 orders shipped to 2 buyers'),
        }));
    });

    it('handles DM failures gracefully', async () => {
        mockGetMember.mockResolvedValue({
            createDM: vi.fn().mockRejectedValue(new Error('Cannot send DMs')),
        });

        purchases.getUnshipped.all.mockReturnValue([
            { id: 1, discord_user_id: 'user1', product_name: 'Pokemon Box', amount: 5000 },
        ]);
        purchases.getUnshippedNoDiscord.all.mockReturnValue([]);

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleDroppedOff(msg);

        // Should still mark as shipped
        expect(purchases.markShipped.run).toHaveBeenCalled();

        // Ops summary should report failed DMs
        expect(mockSendEmbed).toHaveBeenCalledWith('OPS', expect.objectContaining({
            description: expect.stringContaining('1 DMs failed'),
        }));
    });

    it('is safe to run multiple times (idempotent)', async () => {
        purchases.getUnshipped.all.mockReturnValue([]);
        purchases.getUnshippedNoDiscord.all.mockReturnValue([]);

        const msg = createMockMessage({ roles: [ROLE_AKIVILI] });
        await handleDroppedOff(msg);

        expect(msg.reply).toHaveBeenCalledWith('No unshipped orders to notify.');
        expect(purchases.markShipped.run).not.toHaveBeenCalled();
    });
});

describe('!dropped-off DB integration', () => {
    let testDb;
    let testStmts;

    beforeEach(() => {
        testDb = createTestDb();
        testStmts = buildStmts(testDb);
    });

    it('getUnshipped returns only unshipped orders with discord_user_id', () => {
        testStmts.purchases.insertPurchase.run('sess1', 'discord1', 'a@test.com', 'Product A', 1000);
        testStmts.purchases.insertPurchase.run('sess2', null, 'b@test.com', 'Product B', 2000);
        testStmts.purchases.insertPurchase.run('sess3', 'discord2', 'c@test.com', 'Product C', 3000);

        const unshipped = testStmts.purchases.getUnshipped.all();
        expect(unshipped).toHaveLength(2);
        expect(unshipped[0].discord_user_id).toBe('discord1');
        expect(unshipped[1].discord_user_id).toBe('discord2');
    });

    it('getUnshippedNoDiscord returns only unlinked orders', () => {
        testStmts.purchases.insertPurchase.run('sess1', 'discord1', 'a@test.com', 'Product A', 1000);
        testStmts.purchases.insertPurchase.run('sess2', null, 'b@test.com', 'Product B', 2000);

        const noDiscord = testStmts.purchases.getUnshippedNoDiscord.all();
        expect(noDiscord).toHaveLength(1);
        expect(noDiscord[0].customer_email).toBe('b@test.com');
    });

    it('markShipped stamps shipped_at on all unshipped rows', () => {
        testStmts.purchases.insertPurchase.run('sess1', 'discord1', 'a@test.com', 'Product A', 1000);
        testStmts.purchases.insertPurchase.run('sess2', 'discord2', 'b@test.com', 'Product B', 2000);

        testStmts.purchases.markShipped.run();

        const unshipped = testStmts.purchases.getUnshipped.all();
        expect(unshipped).toHaveLength(0);
    });

    it('markShipped does not re-stamp already shipped rows', () => {
        testStmts.purchases.insertPurchase.run('sess1', 'discord1', 'a@test.com', 'Product A', 1000);
        testStmts.purchases.markShipped.run();

        // Add a new purchase after first shipped batch
        testStmts.purchases.insertPurchase.run('sess2', 'discord2', 'b@test.com', 'Product B', 2000);

        const unshipped = testStmts.purchases.getUnshipped.all();
        expect(unshipped).toHaveLength(1);
        expect(unshipped[0].discord_user_id).toBe('discord2');

        // Second markShipped only affects the new one
        testStmts.purchases.markShipped.run();
        expect(testStmts.purchases.getUnshipped.all()).toHaveLength(0);
    });
});
