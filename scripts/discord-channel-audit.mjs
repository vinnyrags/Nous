#!/usr/bin/env node
/**
 * Read-only Discord channel + message audit.
 *
 * Logs in as the bot, walks every text channel in the configured guild, and
 * reconciles what Nous has actually posted against config.CHANNELS and the
 * embeds the bot is supposed to manage. Built for the post-Stripe-excision
 * pass: confirms the retired surfaces (the #restock-tracker community-goals
 * embed, the welcome "Link Account" button, any commerce buy-buttons) are
 * gone, and that the channel IDs in config still resolve.
 *
 * STRICTLY READ-ONLY — it never sends, edits, deletes, or reacts. Safe to run
 * against the production guild with the production bot token.
 *
 * Usage:
 *   # put DISCORD_BOT_TOKEN=... in .env (production bot → production guild)
 *   node scripts/discord-channel-audit.mjs [--messages=N]
 *   # optional: AUDIT_GUILD_ID=<id> to target a different guild (e.g. test)
 */

import 'dotenv/config';
import { Client, GatewayIntentBits } from 'discord.js';
import config from '../config.js';

const arg = process.argv.find((a) => a.startsWith('--messages='));
const MSG_LIMIT = Math.min(Number(arg?.split('=')[1]) || 30, 100);
const GUILD_ID = process.env.AUDIT_GUILD_ID || config.GUILD_ID;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ],
});

client.once('ready', async () => {
    let exitCode = 0;
    try {
        console.log(`Logged in as ${client.user.tag}`);
        const guild = await client.guilds.fetch(GUILD_ID);
        console.log(`Guild: ${guild.name} (${guild.id})\n`);

        const channels = await guild.channels.fetch();
        const textChannels = [...channels.values()].filter((c) => c?.isTextBased?.());

        // --- Walk each text channel, summarize Nous's footprint ---
        const rows = [];
        for (const ch of textChannels) {
            let msgs;
            try {
                msgs = await ch.messages.fetch({ limit: MSG_LIMIT });
            } catch {
                rows.push({ name: ch.name, id: ch.id, note: 'no read access' });
                continue;
            }
            const botMsgs = [...msgs.values()].filter((m) => m.author?.id === client.user.id);
            const withButtons = botMsgs.filter((m) => (m.components || []).length > 0);
            const pinned = await ch.messages.fetchPinned().catch(() => new Map());
            rows.push({
                name: ch.name,
                id: ch.id,
                botMessages: botMsgs.length,
                botWithButtons: withButtons.length,
                pinned: pinned.size,
                lastBot: botMsgs[0]?.createdAt?.toISOString() ?? null,
            });
        }

        // --- Reconcile config.CHANNELS against the live guild ---
        console.log('=== config.CHANNELS reconciliation ===');
        for (const [key, id] of Object.entries(config.CHANNELS)) {
            if (!id) { console.log(`  (unset)   ${key}`); continue; }
            const found = channels.get(id);
            console.log(`  ${found ? 'OK     ' : 'MISSING'} ${key} → ${id}${found ? ` (#${found.name})` : ''}`);
        }

        // --- Channels that exist but aren't referenced in config ---
        const configuredIds = new Set(Object.values(config.CHANNELS).filter(Boolean));
        const unreferenced = textChannels.filter((c) => !configuredIds.has(c.id));
        if (unreferenced.length) {
            console.log('\n=== text channels not in config.CHANNELS ===');
            for (const c of unreferenced) console.log(`  #${c.name} (${c.id})`);
        }

        // --- Per-channel Nous activity (busiest first) ---
        console.log('\n=== per-channel Nous activity ===');
        for (const r of rows.sort((a, b) => (b.botMessages || 0) - (a.botMessages || 0))) {
            if (r.note) { console.log(`  #${r.name} — ${r.note}`); continue; }
            const btn = r.botWithButtons ? ` ⚠️ ${r.botWithButtons} w/ buttons` : '';
            console.log(`  #${r.name} — ${r.botMessages} bot msg(s), ${r.pinned} pinned${btn}`);
        }

        // --- Post-excision flags ---
        console.log('\n=== flags ===');
        const restock = rows.find((r) => /restock|goal/i.test(r.name));
        if (restock?.botMessages > 0) {
            console.log(`  ⚠️ #${restock.name} still has ${restock.botMessages} bot message(s) — community-goals was retired; the pinned tracker may need manual deletion.`);
        }
        const buttoned = rows.filter((r) => r.botWithButtons > 0);
        if (buttoned.length) {
            console.log(`  ⚠️ bot messages with buttons remain (verify none are retired buy/link buttons): ${buttoned.map((r) => `#${r.name}`).join(', ')}`);
        } else {
            console.log('  ✅ no bot messages carry buttons');
        }
        console.log('\nDone (read-only — nothing was modified).');
    } catch (e) {
        console.error('Audit failed:', e.message);
        exitCode = 1;
    } finally {
        await client.destroy();
        process.exit(exitCode);
    }
});

client.login(config.DISCORD_BOT_TOKEN);
