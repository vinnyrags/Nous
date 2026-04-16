/**
 * Tests for channel sync — verifies edit/post/delete logic for embed-based messages.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const BOT_USER_ID = 'bot123';

// Mock channel with configurable existing messages (embed-based)
function createMockChannel(existingEmbeds = []) {
    const messages = existingEmbeds.map((embed, i) => ({
        id: `msg_${i}`,
        content: '',
        embeds: embed ? [embed] : [],
        author: { id: BOT_USER_ID },
        createdTimestamp: i,
        edit: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
    }));

    return {
        messages: {
            fetch: vi.fn().mockResolvedValue(new Map(messages.map((m) => [m.id, m]))),
        },
        send: vi.fn().mockResolvedValue({ id: 'new_msg' }),
        _messages: messages,
    };
}

let mockBotCommandsChannel;
let mockFlowChannel;

vi.mock('../discord.js', () => ({
    client: {
        user: { id: BOT_USER_ID },
        channels: {
            cache: {
                get: vi.fn(),
            },
        },
    },
}));

vi.mock('../config.js', () => ({
    default: {
        CHANNELS: {
            BOT_COMMANDS: 'bot-commands-id',
            LIVESTREAM_FLOW: 'livestream-flow-id',
        },
    },
}));

vi.mock('../bot-commands.js', () => ({
    default: [
        { title: 'Title 1', description: 'Desc 1', color: 0xceff00 },
        { title: 'Title 2', description: 'Desc 2', color: 0xceff00 },
    ],
}));

vi.mock('../livestream-flow.js', () => ({
    default: [
        { title: 'Flow 1', description: 'Flow Desc 1', color: 0xceff00 },
    ],
}));

const { client } = await import('../discord.js');
const { syncBotCommands } = await import('../sync-bot-commands.js');

beforeEach(() => {
    vi.clearAllMocks();
    mockBotCommandsChannel = createMockChannel([]);
    mockFlowChannel = createMockChannel([]);
});

function setupChannels(botEmbeds = [], flowEmbeds = []) {
    mockBotCommandsChannel = createMockChannel(botEmbeds);
    mockFlowChannel = createMockChannel(flowEmbeds);
    client.channels.cache.get.mockImplementation((id) => {
        if (id === 'bot-commands-id') return mockBotCommandsChannel;
        if (id === 'livestream-flow-id') return mockFlowChannel;
        return undefined;
    });
}

describe('syncBotCommands', () => {
    it('does nothing when embeds match', async () => {
        setupChannels(
            [
                { title: 'Title 1', description: 'Desc 1' },
                { title: 'Title 2', description: 'Desc 2' },
            ],
            [{ title: 'Flow 1', description: 'Flow Desc 1' }]
        );

        await syncBotCommands();

        for (const msg of mockBotCommandsChannel._messages) {
            expect(msg.edit).not.toHaveBeenCalled();
            expect(msg.delete).not.toHaveBeenCalled();
        }
        expect(mockBotCommandsChannel.send).not.toHaveBeenCalled();
        expect(mockFlowChannel.send).not.toHaveBeenCalled();
    });

    it('edits embeds that have changed', async () => {
        setupChannels(
            [
                { title: 'Old Title', description: 'Desc 1' },
                { title: 'Title 2', description: 'Desc 2' },
            ],
            [{ title: 'Flow 1', description: 'Flow Desc 1' }]
        );

        await syncBotCommands();

        expect(mockBotCommandsChannel._messages[0].edit).toHaveBeenCalled();
        expect(mockBotCommandsChannel._messages[1].edit).not.toHaveBeenCalled();
    });

    it('posts missing embeds', async () => {
        setupChannels(
            [{ title: 'Title 1', description: 'Desc 1' }],
            []
        );

        await syncBotCommands();

        // Bot commands: 1 existing + 1 missing = 1 post
        expect(mockBotCommandsChannel.send).toHaveBeenCalledTimes(1);
        // Flow: 0 existing + 1 missing = 1 post
        expect(mockFlowChannel.send).toHaveBeenCalledTimes(1);
    });

    it('deletes extra messages', async () => {
        setupChannels(
            [
                { title: 'Title 1', description: 'Desc 1' },
                { title: 'Title 2', description: 'Desc 2' },
                { title: 'Extra', description: 'Should be deleted' },
            ],
            [{ title: 'Flow 1', description: 'Flow Desc 1' }]
        );

        await syncBotCommands();

        expect(mockBotCommandsChannel._messages[2].delete).toHaveBeenCalled();
    });

    it('handles empty channel (posts all messages)', async () => {
        setupChannels([], []);

        await syncBotCommands();

        expect(mockBotCommandsChannel.send).toHaveBeenCalledTimes(2);
        expect(mockFlowChannel.send).toHaveBeenCalledTimes(1);
    });

    it('skips sync when channel not found', async () => {
        client.channels.cache.get.mockReturnValue(undefined);
        await syncBotCommands();
        // Should not throw
    });

    it('handles API errors gracefully', async () => {
        setupChannels([], []);
        mockBotCommandsChannel.messages.fetch.mockRejectedValue(new Error('API error'));

        await syncBotCommands();
        // Should not throw — flow channel still syncs
        expect(mockFlowChannel.send).toHaveBeenCalledTimes(1);
    });

    it('converts plain text messages to embeds on edit', async () => {
        // Simulate old plain-text messages (no embeds)
        setupChannels(
            [null, null],  // no embeds on existing messages
            [{ title: 'Flow 1', description: 'Flow Desc 1' }]
        );

        await syncBotCommands();

        // Both should be edited since they have no matching embeds
        expect(mockBotCommandsChannel._messages[0].edit).toHaveBeenCalled();
        expect(mockBotCommandsChannel._messages[1].edit).toHaveBeenCalled();
    });
});
