/**
 * Shipping Command — !shipping @user 10.00 [reason]
 *
 * Sends a Stripe checkout link to a user for a specific shipping amount.
 * Useful for one-off shipping charges outside the livestream flow.
 *
 * Usage:
 *   !shipping @user 10.00
 *   !shipping @user 5.00 Custom order shipping
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { getMember } from '../discord.js';

async function handleShipping(message, args) {
    // Only owner can send shipping requests
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the server owner can send shipping requests.');
    }

    const mentioned = message.mentions.users.first();
    if (!mentioned) {
        return message.reply('Usage: `!shipping @user 10.00 [reason]`');
    }

    // Parse amount — find the first number in args after the mention
    const amountArg = args.find((a) => /^\d+(\.\d{1,2})?$/.test(a));
    if (!amountArg) {
        return message.reply('Include an amount: `!shipping @user 10.00 [reason]`');
    }

    const amountDollars = parseFloat(amountArg);
    if (amountDollars <= 0) {
        return message.reply('Amount must be greater than zero.');
    }
    const amountCents = Math.round(amountDollars * 100);

    // Parse optional reason — everything after the amount
    const amountIndex = args.indexOf(amountArg);
    const reason = args.slice(amountIndex + 1).join(' ') || 'Shipping';

    // Build the checkout URL
    const shippingUrl = `${config.SHOP_URL.replace(/\/shop$/, '')}/bot/shipping/checkout`
        + `?amount=${amountCents}`
        + `&user=${mentioned.id}`
        + `&reason=${encodeURIComponent(reason)}`;

    // DM the user
    const embed = new EmbedBuilder()
        .setTitle(`📦 ${reason}`)
        .setDescription(
            `You owe **$${amountDollars.toFixed(2)}** for shipping.\n\n` +
            `📦 **[Pay Shipping & Enter Address](${shippingUrl})**`
        )
        .setColor(0xceff00)
        .setFooter({ text: `$${amountDollars.toFixed(2)} — sent by ${message.author.tag}` });

    try {
        const member = await getMember(mentioned.id);
        if (member) {
            const dm = await member.createDM();
            await dm.send({ embeds: [embed] });
            await message.channel.send(`📦 Shipping request sent to <@${mentioned.id}> — **$${amountDollars.toFixed(2)}** (${reason})`);
        } else {
            await message.reply(`Could not find member <@${mentioned.id}>.`);
        }
    } catch {
        // DMs disabled — post fallback in channel
        await message.channel.send({
            content: `<@${mentioned.id}> Please pay your shipping:`,
            embeds: [embed],
        });
    }
}

export { handleShipping };
