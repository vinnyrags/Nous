/**
 * Handle a "Make an Offer" submission for a personal-collection card.
 *
 * WP fires this when a buyer submits the form on /collection. We:
 *
 *   1. DM the operator (config.OPERATOR_DISCORD_ID) with the offer
 *      details. Falls back to posting in #ops if the DM fails (Discord
 *      blocks DMs from server bots that the user shares no guilds
 *      with, or that have DMs disabled in privacy settings).
 *   2. Always post to #ops as a backup so there's a public audit
 *      trail even when the DM works — these are low-volume, high-touch
 *      decisions and missing one in a busy DM stream is a real risk.
 *   3. Broadcast an `activity.card_offer` envelope to SSE clients so
 *      the itzenzo.tv homepage Activity Feed surfaces the event live.
 *
 * Returns nothing — failures are logged. The WP-side endpoint already
 * returned 200 to the buyer before this code runs (fire-and-forget),
 * so we cannot influence what the buyer sees.
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { sendToChannel } from '../discord.js';
import { broadcast } from '../lib/queue-broadcaster.js';

export async function handleCardOffer({ data, client }) {
    const {
        cardTitle = 'Unknown card',
        cardPermalink = null,
        email = '',
        discordUsername = '',
        offerAmount = '',
        message = '',
    } = data || {};

    const embed = new EmbedBuilder()
        .setTitle('💰 New offer received')
        .setColor(0xfbbf24)
        .setDescription(
            cardPermalink
                ? `**[${cardTitle}](${cardPermalink})**`
                : `**${cardTitle}**`,
        )
        .addFields(
            { name: 'Offer', value: offerAmount || '—', inline: true },
            { name: 'Email', value: email || '—', inline: true },
            {
                name: 'Discord',
                value: discordUsername ? `\`${discordUsername}\`` : '—',
                inline: true,
            },
        )
        .setTimestamp();

    if (message) {
        // Discord embed field cap is 1024 chars; the WP endpoint already
        // truncates to 1000, so this trim is belt-and-braces.
        embed.addFields({
            name: 'Message',
            value: message.length > 1000 ? message.slice(0, 1000) + '…' : message,
        });
    }

    // 1. Try DM the operator first.
    const operatorId = config.OPERATOR_DISCORD_ID;
    let dmDelivered = false;
    if (operatorId && client) {
        try {
            const user = await client.users.fetch(operatorId);
            await user.send({ embeds: [embed] });
            dmDelivered = true;
        } catch (e) {
            console.warn(
                `[card-offer] operator DM failed for ${operatorId}:`,
                e.message,
            );
        }
    }

    // 2. Always post to #ops — durability + audit trail.
    try {
        await sendToChannel('OPS', {
            content: dmDelivered
                ? null
                : '⚠️ DM delivery failed — operator notification posted here only.',
            embeds: [embed],
        });
    } catch (e) {
        console.error('[card-offer] #ops post failed:', e.message);
    }

    // 3. Broadcast activity envelope so the homepage Activity Feed
    //    surfaces the offer live. The deriveActivityFromEnvelope path
    //    on the itzenzo.tv side handles arbitrary envelopes generically.
    try {
        broadcast('activity.card_offer', {
            kind: 'card_offer',
            title: 'Offer received',
            description: `${offerAmount || 'Offer'} on ${cardTitle}`,
            color: 'amber',
            icon: '💰',
            timestamp: new Date().toISOString(),
        });
    } catch (e) {
        console.warn('[card-offer] activity broadcast failed:', e.message);
    }
}
