/**
 * Shipments Command — !shipments, !ship-status
 *
 * Visibility into the ShippingEasy order pipeline.
 *
 * Usage:
 *   !shipments        — List pending orders (label not yet purchased)
 *   !shipments ready  — List orders with tracking (label purchased, ready for drop-off)
 *   !ship-status @user — Check a specific buyer's shipping status
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { purchases } from '../db.js';

async function handleShipments(message, args = []) {
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the server owner can run this command.');
    }

    const sub = args[0]?.toLowerCase();

    // !ship-status @user
    if (sub === 'status') {
        const mentioned = message.mentions?.users?.first();
        if (!mentioned) {
            return message.reply('Usage: `!ship-status @user`');
        }

        const shipments = purchases.getShipmentsByDiscordId.all(mentioned.id);
        if (shipments.length === 0) {
            return message.reply(`No shipments found for <@${mentioned.id}>.`);
        }

        const lines = shipments.map(s => {
            const status = s.shipped_at
                ? '✅ Shipped'
                : s.tracking_number
                    ? '📬 Label purchased'
                    : s.shippingeasy_order_id
                        ? '⏳ Awaiting label'
                        : '📝 Order recorded';
            const tracking = s.tracking_number ? ` — ${s.tracking_number}` : '';
            return `${status} | ${s.product_name || 'Unknown'}${tracking}`;
        });

        const embed = new EmbedBuilder()
            .setTitle(`📦 Shipping Status — ${mentioned.username}`)
            .setDescription(lines.join('\n'))
            .setColor(0x3498db);

        return message.channel.send({ embeds: [embed] });
    }

    // !shipments ready
    if (sub === 'ready') {
        const ready = purchases.getReadyShipments.all();
        if (ready.length === 0) {
            return message.reply('No orders with tracking ready for drop-off.');
        }

        const lines = ready.map(r => {
            const buyer = r.discord_user_id ? `<@${r.discord_user_id}>` : (r.customer_email || 'Unknown');
            return `• ${r.product_name || 'Order'} → ${buyer} — ${r.tracking_number} (${r.carrier || '?'})`;
        });

        const embed = new EmbedBuilder()
            .setTitle('📬 Ready for Drop-Off')
            .setDescription(lines.join('\n'))
            .setColor(0x00cc00)
            .setFooter({ text: `${ready.length} order${ready.length !== 1 ? 's' : ''} with labels` });

        return message.channel.send({ embeds: [embed] });
    }

    // !shipments (default — pending)
    const pending = purchases.getPendingShipments.all();
    if (pending.length === 0) {
        return message.reply('No pending orders awaiting labels.');
    }

    const lines = pending.map(p => {
        const buyer = p.discord_user_id ? `<@${p.discord_user_id}>` : (p.customer_email || 'Unknown');
        const dest = p.shipping_city ? `${p.shipping_city}, ${p.shipping_state}` : '';
        return `• ${p.product_name || 'Order'} → ${buyer}${dest ? ` (${dest})` : ''}`;
    });

    const embed = new EmbedBuilder()
        .setTitle('⏳ Awaiting Labels')
        .setDescription(lines.join('\n'))
        .setColor(0xffaa00)
        .setFooter({ text: `${pending.length} order${pending.length !== 1 ? 's' : ''} pending` });

    return message.channel.send({ embeds: [embed] });
}

export { handleShipments };
