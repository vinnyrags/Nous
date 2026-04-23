/**
 * Card view request webhook handlers.
 *
 * Two-phase pattern modelled on webhooks/stripe.js:
 *  - critical: synchronous work that must finish before we respond
 *              to WordPress (currently a no-op — no local mirror yet)
 *  - notifications: fire-and-forget — post the request to #ops so a
 *                   human/mod can triage it live.
 */

import config from '../config.js';
import { sendToChannel } from '../discord.js';
import { EmbedBuilder } from 'discord.js';

/**
 * Critical-path handler. Must finish before we ACK the WP webhook.
 * Returns a `context` object forwarded to the notifications phase.
 */
export async function handleCardRequestCritical(payload) {
    // Currently no local mirror — keep the hook here so future work
    // (e.g. persisting to SQLite for bot-side dashboards) slots in
    // without touching server.js.
    return {
        receivedAt: Date.now(),
    };
}

/**
 * Fire-and-forget handler. Posts the embed to #ops.
 */
export async function handleCardRequestNotifications(payload, context) {
    const {
        request_id: requestId,
        card_title: cardTitle,
        email,
        discord_username: discordUsername,
        duplicate,
    } = payload || {};

    if (!requestId || !cardTitle) {
        console.error('Card request notification missing fields:', payload);
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle(duplicate ? 'Duplicate card request' : 'New card request')
        .setURL(`${config.SHOP_URL}/cards`)
        .setDescription(`**${cardTitle}**`)
        .setColor(duplicate ? 0x9ca3af : 0xf59e0b)
        .addFields(
            { name: 'Email', value: email || '—', inline: true },
            { name: 'Discord', value: discordUsername || '—', inline: true },
            { name: 'Request ID', value: String(requestId), inline: true },
        )
        .setTimestamp();

    try {
        await sendToChannel('OPS', { embeds: [embed] });
    } catch (e) {
        console.error('Card request #ops post failed:', e.message);
    }
}
