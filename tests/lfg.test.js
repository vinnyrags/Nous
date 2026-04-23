/**
 * Tests for the #looking-for-group persistent embed module.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../config.js', () => ({
    default: {
        CHANNELS: {
            LOOKING_FOR_GROUP: 'lfg_channel_id',
            MINECRAFT: 'mc_channel_id',
            ANNOUNCEMENTS: 'announcements_channel_id',
        },
    },
}));

const channelSend = vi.fn();
const channelPin = vi.fn().mockResolvedValue(null);
const channelEdit = vi.fn().mockResolvedValue(null);
const channelUnpin = vi.fn().mockResolvedValue(null);
const channelDelete = vi.fn().mockResolvedValue(null);
const channelFetchPinned = vi.fn().mockResolvedValue(new Map());
const messageFetch = vi.fn();

const mockChannel = {
    client: { user: { id: 'bot_user_id' } },
    send: (...args) => {
        channelSend(...args);
        return Promise.resolve({
            id: 'new_msg_id',
            pin: channelPin,
        });
    },
    messages: {
        fetch: (...args) => messageFetch(...args),
        fetchPinned: (...args) => channelFetchPinned(...args),
    },
};

const getChannel = vi.fn((key) => key === 'LOOKING_FOR_GROUP' ? mockChannel : null);

vi.mock('../discord.js', () => ({
    getChannel: (...args) => getChannel(...args),
}));

const lfgDb = {
    getConfig: { get: vi.fn() },
    setMessageId: { run: vi.fn() },
};

vi.mock('../db.js', () => ({
    lfg: lfgDb,
}));

const { buildLfgEmbed, initLfgChannel } = await import('../commands/lfg.js');

beforeEach(() => {
    vi.clearAllMocks();
    lfgDb.getConfig.get.mockReturnValue({ id: 1, channel_message_id: null });
    channelFetchPinned.mockResolvedValue(new Map());
});

// =========================================================================
// Embed shape
// =========================================================================

describe('buildLfgEmbed', () => {
    it('renders the LFG title and description', () => {
        const json = buildLfgEmbed().toJSON();
        expect(json.title).toMatch(/looking for group/i);
        expect(json.description).toMatch(/drop what you're playing/i);
    });

    it('includes the three structural fields', () => {
        const fields = buildLfgEmbed().toJSON().fields;
        const names = fields.map((f) => f.name.toLowerCase());
        expect(names).toContain('how to use it');
        expect(names).toContain('games we regularly play');
        expect(names).toContain('stream schedule');
    });

    it('links to the #minecraft channel for realm invites', () => {
        const fields = buildLfgEmbed().toJSON().fields;
        const games = fields.find((f) => f.name === 'Games we regularly play').value;
        expect(games).toContain('<#mc_channel_id>');
    });

    it('links to the #announcements channel for going-live alerts', () => {
        const fields = buildLfgEmbed().toJSON().fields;
        const schedule = fields.find((f) => f.name === 'Stream schedule').value;
        expect(schedule).toContain('<#announcements_channel_id>');
    });

    it('lists the three Minecraft realms', () => {
        const games = buildLfgEmbed().toJSON().fields.find((f) => f.name === 'Games we regularly play').value;
        expect(games).toMatch(/java hc/i);
        expect(games).toMatch(/bedrock horror/i);
        expect(games).toMatch(/bedrock creative/i);
    });

    it('mentions the gacha lineup', () => {
        const games = buildLfgEmbed().toJSON().fields.find((f) => f.name === 'Games we regularly play').value;
        expect(games).toMatch(/star rail|zenless|genshin/i);
    });
});

// =========================================================================
// initLfgChannel — edit-in-place + fresh-post flows
// =========================================================================

describe('initLfgChannel', () => {
    it('skips when the channel is not configured', async () => {
        getChannel.mockReturnValueOnce(null);
        await initLfgChannel();
        expect(channelSend).not.toHaveBeenCalled();
        expect(channelEdit).not.toHaveBeenCalled();
    });

    it('edits the stored message in place when ID is saved and fetch succeeds', async () => {
        lfgDb.getConfig.get.mockReturnValue({ id: 1, channel_message_id: 'stored_msg_id' });
        const existingMsg = {
            id: 'stored_msg_id',
            pinned: true,
            edit: channelEdit,
            pin: channelPin,
        };
        messageFetch.mockResolvedValueOnce(existingMsg);

        await initLfgChannel();

        expect(channelEdit).toHaveBeenCalledTimes(1);
        const editArgs = channelEdit.mock.calls[0][0];
        expect(editArgs.content).toBe('');
        expect(editArgs.embeds).toHaveLength(1);
        // already pinned — don't re-pin
        expect(channelPin).not.toHaveBeenCalled();
        // no fresh post
        expect(channelSend).not.toHaveBeenCalled();
        // ID stays the same
        expect(lfgDb.setMessageId.run).not.toHaveBeenCalled();
    });

    it('re-pins if the stored message was somehow unpinned', async () => {
        lfgDb.getConfig.get.mockReturnValue({ id: 1, channel_message_id: 'stored_msg_id' });
        const existingMsg = {
            id: 'stored_msg_id',
            pinned: false,
            edit: channelEdit,
            pin: channelPin,
        };
        messageFetch.mockResolvedValueOnce(existingMsg);

        await initLfgChannel();

        expect(channelEdit).toHaveBeenCalledTimes(1);
        expect(channelPin).toHaveBeenCalledTimes(1);
    });

    it('falls back to fresh post when the stored message was deleted', async () => {
        lfgDb.getConfig.get.mockReturnValue({ id: 1, channel_message_id: 'stored_msg_id' });
        messageFetch.mockRejectedValueOnce(new Error('Unknown Message'));

        await initLfgChannel();

        expect(channelSend).toHaveBeenCalledTimes(1);
        expect(channelPin).toHaveBeenCalledTimes(1);
        expect(lfgDb.setMessageId.run).toHaveBeenCalledWith('new_msg_id');
    });

    it('posts fresh + pins + saves ID when no message ID is stored', async () => {
        await initLfgChannel();

        expect(channelSend).toHaveBeenCalledTimes(1);
        const sendArgs = channelSend.mock.calls[0][0];
        expect(sendArgs.embeds).toHaveLength(1);
        expect(sendArgs.embeds[0].toJSON().title).toMatch(/looking for group/i);

        expect(channelPin).toHaveBeenCalledTimes(1);
        expect(lfgDb.setMessageId.run).toHaveBeenCalledWith('new_msg_id');
    });

    it('unpins + deletes stale bot-authored pinned messages before fresh post', async () => {
        const stalePin = {
            author: { id: 'bot_user_id' },
            unpin: channelUnpin,
            delete: channelDelete,
        };
        const foreignPin = {
            author: { id: 'not_the_bot' },
            unpin: channelUnpin,
            delete: channelDelete,
        };
        const pinMap = new Map([['1', stalePin], ['2', foreignPin]]);
        channelFetchPinned.mockResolvedValueOnce(pinMap);

        await initLfgChannel();

        // only the bot's pin gets unpinned+deleted; the foreign one is preserved
        expect(channelUnpin).toHaveBeenCalledTimes(1);
        expect(channelDelete).toHaveBeenCalledTimes(1);
    });
});
