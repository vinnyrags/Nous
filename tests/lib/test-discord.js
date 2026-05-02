/**
 * Phase 3-full — Discord REST helpers for the test bot in the test guild.
 *
 * These talk directly to Discord's REST API as the test bot, deliberately
 * sidestepping discord.js client startup (slow, stateful, intent setup).
 * Tests post embeds, read them back, query members, grant roles, and bulk-
 * delete the channel between specs — all via REST.
 *
 * Pre-reqs:
 *   1. .env.test exists with DISCORD_TEST_BOT_TOKEN + DISCORD_TEST_GUILD_ID
 *   2. The test bot is in the test guild with Administrator perms
 *   3. The 14 default channels (created by scripts/setup-test-guild.js)
 *
 * If any of those is missing, helpers throw with a clear message — letting
 * specs `test.skip` cleanly when running outside the configured environment.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_TEST_PATH = path.resolve(__dirname, '../../.env.test');

const API = 'https://discord.com/api/v10';

let _config = null;

/**
 * Load DISCORD_TEST_BOT_TOKEN + DISCORD_TEST_GUILD_ID from .env.test (or
 * process.env if it's already populated). Returns null when the test env
 * isn't configured — specs should skip themselves rather than crash.
 */
export function getTestConfig() {
    if (_config) return _config;

    let token = process.env.DISCORD_TEST_BOT_TOKEN;
    let guildId = process.env.DISCORD_TEST_GUILD_ID;

    if ((!token || !guildId) && fs.existsSync(ENV_TEST_PATH)) {
        const lines = fs.readFileSync(ENV_TEST_PATH, 'utf8').split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eq = trimmed.indexOf('=');
            if (eq < 0) continue;
            const key = trimmed.slice(0, eq).trim();
            const val = trimmed.slice(eq + 1).trim();
            if (!token && key === 'DISCORD_TEST_BOT_TOKEN') token = val;
            if (!guildId && key === 'DISCORD_TEST_GUILD_ID') guildId = val;
        }
    }

    if (!token || !guildId) return null;

    _config = { token, guildId };
    return _config;
}

/**
 * Test-environment availability gate. Use in beforeAll:
 *   if (!isTestDiscordAvailable()) test.skip(...);
 */
export function isTestDiscordAvailable() {
    return getTestConfig() !== null;
}

async function discordRest(method, route, body = null) {
    const cfg = getTestConfig();
    if (!cfg) {
        throw new Error(
            'Test Discord env not configured — set DISCORD_TEST_BOT_TOKEN and ' +
            'DISCORD_TEST_GUILD_ID in .env.test or in process.env',
        );
    }
    const headers = {
        Authorization: `Bot ${cfg.token}`,
        'Content-Type': 'application/json',
    };
    const res = await fetch(`${API}${route}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
        const err = new Error(`Discord ${method} ${route} → ${res.status} ${text}`);
        err.status = res.status;
        err.body = text;
        throw err;
    }
    return text ? JSON.parse(text) : null;
}

/**
 * Look up a channel id by display name (e.g. "test-suite" → "1499941235...").
 * Cached after first lookup.
 */
let _channelMap = null;
export async function getChannels() {
    if (_channelMap) return _channelMap;
    const cfg = getTestConfig();
    const channels = await discordRest('GET', `/guilds/${cfg.guildId}/channels`);
    _channelMap = Object.fromEntries(channels.map((c) => [c.name, c.id]));
    return _channelMap;
}

/**
 * Send an embed to a channel by name. Returns the message id so callers
 * can read it back (the round-trip Phase 3-full was set up for).
 */
export async function sendEmbed(channelName, embed) {
    const channels = await getChannels();
    const channelId = channels[channelName];
    if (!channelId) {
        throw new Error(`Test guild has no channel named #${channelName}`);
    }
    const msg = await discordRest('POST', `/channels/${channelId}/messages`, { embeds: [embed] });
    return msg;
}

export async function sendMessage(channelName, content) {
    const channels = await getChannels();
    const channelId = channels[channelName];
    if (!channelId) {
        throw new Error(`Test guild has no channel named #${channelName}`);
    }
    return discordRest('POST', `/channels/${channelId}/messages`, { content });
}

/**
 * Read the most recent N messages from a channel.
 */
export async function getMessages(channelName, limit = 50) {
    const channels = await getChannels();
    const channelId = channels[channelName];
    if (!channelId) {
        throw new Error(`Test guild has no channel named #${channelName}`);
    }
    return discordRest('GET', `/channels/${channelId}/messages?limit=${limit}`);
}

/**
 * Bulk-delete recent messages in a channel (Discord limits this to 100 at
 * a time, and to messages ≤ 14 days old). For test cleanup between specs.
 */
export async function bulkDeleteRecent(channelName, limit = 100) {
    const channels = await getChannels();
    const channelId = channels[channelName];
    if (!channelId) {
        throw new Error(`Test guild has no channel named #${channelName}`);
    }
    const msgs = await discordRest('GET', `/channels/${channelId}/messages?limit=${limit}`);
    if (msgs.length === 0) return { deleted: 0 };
    if (msgs.length === 1) {
        await discordRest('DELETE', `/channels/${channelId}/messages/${msgs[0].id}`);
        return { deleted: 1 };
    }
    await discordRest('POST', `/channels/${channelId}/messages/bulk-delete`, {
        messages: msgs.map((m) => m.id),
    });
    return { deleted: msgs.length };
}

/**
 * Lookup a guild member by user id. Returns null on 404.
 */
export async function getMember(userId) {
    const cfg = getTestConfig();
    try {
        return await discordRest('GET', `/guilds/${cfg.guildId}/members/${userId}`);
    } catch (e) {
        if (e.status === 404) return null;
        throw e;
    }
}

/**
 * Resolve a member by username — useful for e2e tests that work with
 * the human running them rather than a known user id.
 */
export async function getMemberByUsername(username) {
    const cfg = getTestConfig();
    const results = await discordRest(
        'GET',
        `/guilds/${cfg.guildId}/members/search?query=${encodeURIComponent(username)}&limit=5`,
    );
    return results.find((m) => m.user?.username === username) || null;
}
