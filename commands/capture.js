/**
 * Capture Command — !capture [optional note]
 *
 * Logs a timestamped moment to #moments for Sunday batch clipping.
 * Calculates elapsed time from !live if a stream session is active.
 * Deletes the command message to keep #ops clean.
 * Akivili only.
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { livestream } from '../db.js';
import { client } from '../discord.js';

async function handleCapture(message, args) {
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) return;

    try { await message.delete(); } catch { /* may lack perms */ }

    const note = args.length ? args.join(' ') : null;

    // Calculate elapsed time from active livestream session
    const session = livestream.getActiveSession.get();
    let elapsed = null;
    if (session) {
        const startMs = new Date(session.created_at + 'Z').getTime();
        const nowMs = Date.now();
        const diffMin = Math.floor((nowMs - startMs) / 60000);
        const hours = Math.floor(diffMin / 60);
        const mins = diffMin % 60;
        elapsed = hours > 0 ? `${hours}h ${mins}m into stream` : `${mins}m into stream`;
    }

    // Format current time in EST
    const now = new Date().toLocaleTimeString('en-US', {
        timeZone: 'America/New_York',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });

    const title = session
        ? `\uD83D\uDCCC Stream Moment \u2014 ${now} EST`
        : `\uD83D\uDCCC Moment \u2014 ${now} EST`;

    const lines = [];
    if (elapsed) {
        lines.push(`\u23F1\uFE0F ${elapsed}`);
    }
    if (note) {
        lines.push(`\uD83D\uDCAC ${note}`);
    }

    const embed = new EmbedBuilder()
        .setTitle(title)
        .setColor(0xceff00)
        .setTimestamp();

    if (lines.length) {
        embed.setDescription(lines.join('\n'));
    }

    const channel = client.channels.cache.get(config.CHANNELS.MOMENTS);
    if (channel) {
        await channel.send({ embeds: [embed] });
    }
}

export { handleCapture };
