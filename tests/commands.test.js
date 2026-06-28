/**
 * Tests for Discord command handler guards and validation.
 *
 * These test the permission checks, input validation, and error handling
 * in the command handlers. State mutation (DB writes) is tested in the
 * dedicated database-layer tests (battle.test.js, queue.test.js, etc.).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';
import { createMockMessage } from './mocks.js';

let db, stmts;

// Channel and role IDs matching config.js
const PACK_BATTLES = '1488041101326811158';
const ROLE_AKIVILI = '1488046525065072670';
const ROLE_NANOOK = '1488046525899739148';

// Mock discord module
vi.mock('../discord.js', () => ({
    client: { channels: { cache: { get: vi.fn() } } },
    getChannel: vi.fn(),
    getGuild: vi.fn(),
    sendToChannel: vi.fn().mockResolvedValue(null),
    sendEmbed: vi.fn().mockResolvedValue(null),
    getMember: vi.fn().mockResolvedValue(null),
    hasRole: vi.fn().mockReturnValue(false),
    addRole: vi.fn().mockResolvedValue(false),
}));

// Mock db module — wire up test DB in beforeEach
vi.mock('../db.js', () => ({
    db: null,
    purchases: {},
    battles: {},
    queues: {},
    livestream: {},
    cardListings: {},
    ducks: {},
    analytics: {},
    goals: {},
    shipping: {},
    discordLinks: {},
}));

global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({}),
});

const dbModule = await import('../db.js');

beforeEach(() => {
    db = createTestDb();
    stmts = buildStmts(db);
    dbModule.db = db;
    Object.assign(dbModule.queues, stmts.queues);
    Object.assign(dbModule.battles, stmts.battles);
    Object.assign(dbModule.purchases, stmts.purchases);
    Object.assign(dbModule.livestream, stmts.livestream);
    Object.assign(dbModule.analytics, stmts.analytics);
    Object.assign(dbModule.goals, stmts.goals);
    Object.assign(dbModule.shipping, stmts.shipping);
    Object.assign(dbModule.discordLinks, stmts.discordLinks);
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
    });
});


describe('!queue permission guards', () => {
    it('shows no queue message when none exists', async () => {
        const { handleQueue } = await import('../commands/queue.js');
        const msg = createMockMessage();

        await handleQueue(msg, []);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('No open queue')
        );
    });

    it('rejects non-mod from opening', async () => {
        const { handleQueue } = await import('../commands/queue.js');
        const msg = createMockMessage({ roles: [] });

        await handleQueue(msg, ['open']);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Only moderators')
        );
    });

    it('rejects non-mod from closing', async () => {
        const { handleQueue } = await import('../commands/queue.js');
        const msg = createMockMessage({ roles: [] });

        await handleQueue(msg, ['close']);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Only moderators')
        );
    });
});

describe('!duckrace permission guards', () => {
    it('rejects non-mod from declaring winner', async () => {
        const { handleDuckRace } = await import('../commands/queue.js');
        const msg = createMockMessage({ roles: [] });

        await handleDuckRace(msg, ['winner', '@someone']);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Only moderators')
        );
    });
});


describe('!live and !offline permission guards', () => {
    it('!live rejects non-admin', async () => {
        const { handleLive } = await import('../commands/live.js');
        const msg = createMockMessage({ roles: [] });

        await handleLive(msg);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Only moderators')
        );
    });

    it('!offline rejects non-admin', async () => {
        const { handleOffline } = await import('../commands/live.js');
        const msg = createMockMessage({ roles: [] });

        await handleOffline(msg);
        expect(msg.reply).toHaveBeenCalledWith(
            expect.stringContaining('Only moderators')
        );
    });
});
