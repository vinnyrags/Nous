/**
 * Tracking Command — !tracking
 *
 * Manually input tracking numbers for buyers. Used on drop-off day
 * after creating labels in ShippingEasy. Tracking info is included
 * in !dropped-off DMs automatically.
 *
 * Commands:
 *   !tracking @user TRACKING_NUMBER CARRIER   — Add tracking for a buyer
 *   !tracking list                            — Show all pending tracking entries
 *   !tracking clear                           — Clear all tracking data
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { tracking, purchases } from '../db.js';

/**
 * Known carrier tracking URL patterns.
 */
const CARRIER_URLS = {
    USPS: (num) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${num}`,
    UPS: (num) => `https://www.ups.com/track?tracknum=${num}`,
    FEDEX: (num) => `https://www.fedex.com/fedextrack/?trknbr=${num}`,
};

function buildTrackingUrl(trackingNumber, carrier) {
    const key = carrier?.toUpperCase();
    const builder = CARRIER_URLS[key];
    return builder ? builder(trackingNumber) : null;
}

async function handleTracking(message, args) {
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the server owner can manage tracking.');
    }

    const sub = args[0]?.toLowerCase();

    if (sub === 'list') return listTracking(message);
    if (sub === 'clear') return clearTracking(message);
    if (!sub) return message.reply('Usage: `!tracking @user TRACKING_NUMBER CARRIER`, `!tracking list`, `!tracking clear`');

    return addTracking(message, args);
}

/**
 * !tracking @user TRACKING_NUMBER CARRIER
 */
async function addTracking(message, args) {
    const mentioned = message.mentions.users.first();
    if (!mentioned) {
        return message.reply('Usage: `!tracking @user TRACKING_NUMBER CARRIER`\nExample: `!tracking @buyer 9400111899223847263910 USPS`');
    }

    // Parse tracking number and carrier from args (skip mention token)
    const nonMentionArgs = args.filter(a => !a.startsWith('<@') && !a.startsWith('@'));
    const trackingNumber = nonMentionArgs[0];
    const carrier = nonMentionArgs[1]?.toUpperCase() || 'USPS';

    if (!trackingNumber) {
        return message.reply('Include a tracking number: `!tracking @user 9400111899223847263910 USPS`');
    }

    // Look up buyer's email
    const link = purchases.getEmailByDiscordId.get(mentioned.id);
    const email = link?.customer_email || 'unknown';

    // Build tracking URL
    const trackingUrl = buildTrackingUrl(trackingNumber, carrier);

    // Store
    tracking.add.run(email, mentioned.id, trackingNumber, carrier, null, trackingUrl);

    const urlLine = trackingUrl ? `\n🔗 ${trackingUrl}` : '';
    await message.channel.send(
        `✅ Tracking added for <@${mentioned.id}>:\n` +
        `📬 **${trackingNumber}** (${carrier})${urlLine}`
    );
}

/**
 * !tracking list — show all pending tracking entries
 */
async function listTracking(message) {
    const all = tracking.getAll ? tracking.getAll.all() : [];

    if (!all.length) {
        return message.reply('No tracking entries.');
    }

    const lines = all.map((t, i) => {
        const buyer = t.discord_user_id ? `<@${t.discord_user_id}>` : t.customer_email;
        return `${i + 1}. ${buyer} — **${t.tracking_number}** (${t.carrier || 'Unknown'})`;
    });

    const embed = new EmbedBuilder()
        .setTitle('📬 Tracking Entries')
        .setDescription(lines.join('\n'))
        .setColor(0xceff00)
        .setFooter({ text: `${all.length} total` });

    await message.channel.send({ embeds: [embed] });
}

/**
 * !tracking clear — remove all tracking data
 */
async function clearTracking(message) {
    const { db } = await import('../db.js');
    const result = db.prepare('DELETE FROM tracking').run();
    await message.channel.send(`✅ Cleared **${result.changes}** tracking entries.`);
}

export { handleTracking };
