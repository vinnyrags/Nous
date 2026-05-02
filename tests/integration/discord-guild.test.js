/**
 * Phase 3-full — real-Discord round-trip integration tests.
 *
 * Sends embeds to the real test guild via REST as the test bot, reads them
 * back, and asserts the structure Discord actually accepted. Catches:
 *   - Embeds rejected by Discord (malformed structure that mocked tests miss)
 *   - Bot permission gaps (sending to a channel the bot can't post to)
 *   - Field-length / character-count limits Discord enforces server-side
 *
 * Skips itself when DISCORD_TEST_BOT_TOKEN / DISCORD_TEST_GUILD_ID aren't
 * configured — local dev runs of `npm test` don't require the test guild.
 *
 * Run with the test env loaded:
 *   DISCORD_TEST_BOT_TOKEN=... DISCORD_TEST_GUILD_ID=... \
 *     npm test -- tests/integration/discord-guild.test.js
 *
 * Or via .env.test (gitignored — see .env.test.example).
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import {
    getTestConfig,
    isTestDiscordAvailable,
    sendEmbed,
    getMessages,
    bulkDeleteRecent,
} from '../lib/test-discord.js';

const SKIP_REASON = 'set DISCORD_TEST_BOT_TOKEN + DISCORD_TEST_GUILD_ID in .env.test';

describe.skipIf(!isTestDiscordAvailable())('real Discord guild — embed round-trip', () => {
    beforeAll(async () => {
        // Sanity: confirm we can reach the test guild + read its channels
        const cfg = getTestConfig();
        expect(cfg.token.length).toBeGreaterThan(0);
        expect(cfg.guildId).toMatch(/^\d+$/);
    });

    // Each spec gets a clean #ops channel — keeps assertions simple
    beforeEach(async () => {
        await bulkDeleteRecent('ops', 100).catch(() => {
            // Silent: bulk-delete fails on messages > 14 days old, that's fine
        });
    });

    it('sends an order-feed embed and reads back the same shape', async () => {
        const embed = {
            title: '🛒 New Order!',
            description: '<@1490206350943191052> just picked up:\n• **Test Item** (×2)',
            color: 0xceff00,
            footer: { text: 'Phase 3-full smoke' },
        };

        const sent = await sendEmbed('ops', embed);
        expect(sent.id).toMatch(/^\d+$/);

        const recent = await getMessages('ops', 5);
        const found = recent.find((m) => m.id === sent.id);
        expect(found).toBeTruthy();
        expect(found.embeds[0].title).toBe('🛒 New Order!');
        expect(found.embeds[0].description).toContain('Test Item');
        expect(found.embeds[0].color).toBe(0xceff00);
    });

    it('sends a refund #ops embed with the orange dispute color', async () => {
        const embed = {
            title: '⚠️ Dispute Issued',
            description: '**Product:** Test Item\n**Refunded:** $25.00\n**Source:** Stripe dispute',
            color: 0xe67e22,
        };

        const sent = await sendEmbed('ops', embed);
        const recent = await getMessages('ops', 5);
        const found = recent.find((m) => m.id === sent.id);

        expect(found.embeds[0].color).toBe(0xe67e22);
        expect(found.embeds[0].description).toContain('Stripe dispute');
    });

    it('rejects embeds with description longer than Discord allows', async () => {
        // Discord enforces a 4096-char limit on embed descriptions. Our handler
        // code never produces descriptions that long, but the API rejection
        // is what would expose the bug if it ever did.
        const embed = {
            title: 'Stress test',
            description: 'x'.repeat(5000),
        };

        await expect(sendEmbed('ops', embed)).rejects.toThrow(/400/);
    });
});

if (!isTestDiscordAvailable()) {
    describe('real Discord guild — environment not configured', () => {
        it('skips — set DISCORD_TEST_BOT_TOKEN + DISCORD_TEST_GUILD_ID in .env.test', () => {
            console.log(`Phase 3-full integration suite skipped: ${SKIP_REASON}`);
            expect(true).toBe(true);
        });
    });
}
