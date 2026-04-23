/**
 * #looking-for-group Channel — persistent overview embed.
 *
 * Matches the welcome/minecraft pattern: on bot startup, initLfgChannel()
 * edits the existing embed in place if found, otherwise unpins any stale
 * bot-authored pinned messages, posts a fresh embed, pins it, and saves
 * the ID in lfg_config.
 *
 * This is a chat channel (not bot-only), so we do NOT wipe messages —
 * we just keep the overview embed pinned at the top.
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { getChannel } from '../discord.js';

function buildLfgEmbed() {
    const minecraftMention = config.CHANNELS.MINECRAFT
        ? `<#${config.CHANNELS.MINECRAFT}>`
        : '`#minecraft`';
    const announcementsMention = config.CHANNELS.ANNOUNCEMENTS
        ? `<#${config.CHANNELS.ANNOUNCEMENTS}>`
        : '`#announcements`';

    return new EmbedBuilder()
        .setTitle('🎮 Looking for Group')
        .setDescription(
            "Drop what you're playing and tag the game — someone's usually around, or willing to hop on. " +
            'No roster, no sign-ups, just make the ask.'
        )
        .setColor(0xceff00)
        .addFields(
            {
                name: 'How to use it',
                value: [
                    '• Post the game + when (e.g. *"Fortnite zero-build, in 30"*)',
                    "• Mention the platform if it matters (Java vs Bedrock, PC vs console)",
                    "• Ping a game's role if one exists — otherwise just ask",
                    "• No formal signup, no commitment — if you're down, hop in",
                ].join('\n'),
            },
            {
                name: 'Games we regularly play',
                value: [
                    '🎮 **Fortnite** — squads most nights, intergenerational lobbies (dad streams)',
                    '🦸 **Marvel Rivals** — competitive solo/duo',
                    `⛏️ **Minecraft** — three realms (Java HC, Bedrock Horror, Bedrock Creative). Invites via ${minecraftMention}`,
                    '🚀 **Gacha lineup** — Honkai: Star Rail, Zenless Zone Zero, Genshin Impact',
                    '🃏 **Karuta** — in-Discord card game, see the karuta channels',
                    '✨ **Anything else** — just ask',
                ].join('\n'),
            },
            {
                name: 'Stream schedule',
                value: [
                    '**Mon–Thu** — Card nights, 8PM EST',
                    '**Fri–Sun** — Gaming nights, 8PM EST',
                    `See ${announcementsMention} for going-live alerts.`,
                ].join('\n'),
            },
        )
        .setFooter({ text: 'itzenzo.tv — Cards. Games. Community.' });
}

/**
 * Remove any existing bot-authored pinned messages from the channel, so
 * after a fresh post the new embed is the only pinned entry.
 */
async function clearBotPins(channel, botUserId) {
    try {
        const pins = await channel.messages.fetchPinned();
        for (const pin of pins.values()) {
            if (pin.author.id !== botUserId) continue;
            try { await pin.unpin(); } catch { /* ok */ }
            try { await pin.delete(); } catch { /* ok */ }
        }
    } catch (e) {
        console.warn('Failed to clear bot pins in LFG channel:', e.message);
    }
}

/**
 * Ensure the persistent overview embed exists in #looking-for-group
 * on bot startup. Idempotent — safe to call on every restart.
 */
async function initLfgChannel() {
    try {
        const { lfg } = await import('../db.js');
        const channel = getChannel('LOOKING_FOR_GROUP');
        if (!channel) {
            console.log('LFG channel not configured — skipping initLfgChannel');
            return;
        }

        const embed = buildLfgEmbed();
        const row = lfg.getConfig.get();

        if (row?.channel_message_id) {
            try {
                const msg = await channel.messages.fetch(row.channel_message_id);
                // edit-in-place; wipe any old text content so it's pure embed
                await msg.edit({ content: '', embeds: [embed] });
                if (!msg.pinned) {
                    try { await msg.pin(); } catch { /* ok */ }
                }
                console.log('LFG embed updated');
                return;
            } catch {
                // Message was deleted — fall through to fresh post
            }
        }

        // Fresh post: clear any stale bot pins, post embed, pin, save ID
        await clearBotPins(channel, channel.client.user.id);

        const msg = await channel.send({ embeds: [embed] });
        try { await msg.pin(); } catch { /* ok */ }
        lfg.setMessageId.run(msg.id);
        console.log('LFG embed posted');
    } catch (e) {
        console.error('Failed to initialize LFG embed:', e.message);
    }
}

export { initLfgChannel, buildLfgEmbed };
