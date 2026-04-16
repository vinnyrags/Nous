/**
 * Mock Discord.js objects for command testing.
 */

import { vi } from 'vitest';

/**
 * Create a mock Discord message.
 */
export function createMockMessage(options = {}) {
    const {
        content = '',
        authorId = 'user123',
        authorBot = false,
        channelId = 'channel123',
        guildId = 'guild123',
        roles = [],
    } = options;

    const sent = [];
    const replied = [];
    let deleted = false;

    const mockRolesCache = new Map();
    roles.forEach((r) => mockRolesCache.set(r, { id: r }));

    return {
        content,
        author: {
            id: authorId,
            bot: authorBot,
            tag: `user#${authorId}`,
            createDM: vi.fn().mockResolvedValue({
                send: vi.fn().mockResolvedValue({ react: vi.fn() }),
            }),
        },
        member: {
            roles: {
                cache: {
                    has: (roleId) => mockRolesCache.has(roleId),
                    get: (roleId) => mockRolesCache.get(roleId),
                },
            },
            displayName: `User ${authorId}`,
        },
        guild: { id: guildId },
        channel: {
            id: channelId,
            send: vi.fn().mockImplementation((msg) => {
                sent.push(msg);
                return Promise.resolve({
                    id: `msg_${sent.length}`,
                    react: vi.fn(),
                    edit: vi.fn(),
                });
            }),
        },
        reply: vi.fn().mockImplementation((msg) => {
            replied.push(msg);
            return Promise.resolve();
        }),
        delete: vi.fn().mockImplementation(() => {
            deleted = true;
            return Promise.resolve();
        }),
        mentions: {
            users: {
                first: vi.fn().mockReturnValue(null),
            },
        },
        // Test helpers
        _sent: sent,
        _replied: replied,
        _isDeleted: () => deleted,
    };
}

/**
 * Create a mock mentioned user.
 */
export function createMockMention(userId = 'mentioned123') {
    return {
        id: userId,
        tag: `mentioned#${userId}`,
        createDM: vi.fn().mockResolvedValue({
            send: vi.fn().mockResolvedValue({}),
        }),
    };
}
