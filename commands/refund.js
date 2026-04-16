/**
 * Refund Command
 *
 * !refund @user [amount] [reason]              — refund next unrefunded purchase
 * !refund session <session_id> [amount] [reason] — refund a specific session
 *
 * Owner-only. Issues Stripe refunds (full or partial).
 * Automatically skips already-refunded purchases and moves to the next one.
 */

import Stripe from 'stripe';
import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { purchases } from '../db.js';
import { sendEmbed, getMember } from '../discord.js';

const stripe = new Stripe(config.STRIPE_SECRET_KEY);

async function handleRefund(message, args) {
    // Owner-only
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the server owner can issue refunds.');
    }

    if (args.length === 0) {
        return message.reply(
            'Usage:\n' +
            '`!refund @user [amount] [reason]` — refund next unrefunded purchase\n' +
            '`!refund session <session_id> [amount] [reason]` — refund a specific session'
        );
    }

    const isSessionMode = args[0]?.toLowerCase() === 'session';

    if (isSessionMode) {
        // !refund session <session_id> [amount] [reason]
        const sessionId = args[1];
        if (!sessionId) {
            return message.reply('Usage: `!refund session <session_id> [amount] [reason]`');
        }

        const refundArgs = args.slice(2);
        const { amountCents, reason } = parseAmountAndReason(refundArgs);
        const purchase = purchases.getBySessionId.get(sessionId);

        try {
            await attemptRefund(message, sessionId, purchase, amountCents, reason);
        } catch (e) {
            console.error('Refund error:', e.message);
            if (e.message.includes('has already been refunded')) {
                return message.reply('This payment has already been fully refunded.');
            }
            return message.reply(`Stripe refund failed: ${e.message}`);
        }
    } else {
        // !refund @user [amount] [reason]
        const mentioned = message.mentions.users.first();
        if (!mentioned) {
            return message.reply('Usage: `!refund @user [amount] [reason]`');
        }

        const recentPurchases = purchases.getRecentsByDiscordId.all(mentioned.id);
        if (!recentPurchases.length) {
            return message.reply(`No purchases found for <@${mentioned.id}>.`);
        }

        const refundArgs = args.filter((a) => !a.startsWith('<@'));
        const { amountCents, reason } = parseAmountAndReason(refundArgs);

        // Try each purchase starting from most recent, skip already-refunded
        for (const purchase of recentPurchases) {
            try {
                await attemptRefund(message, purchase.stripe_session_id, purchase, amountCents, reason);
                return;
            } catch (e) {
                if (e.message.includes('has already been refunded')) {
                    continue;
                }
                console.error('Refund error:', e.message);
                return message.reply(`Stripe refund failed: ${e.message}`);
            }
        }

        return message.reply(`All recent purchases for <@${mentioned.id}> have already been refunded.`);
    }
}

/**
 * Parse amount and reason from args.
 */
function parseAmountAndReason(refundArgs) {
    const filtered = refundArgs.filter((a) => !a.startsWith('<@'));
    const amountArg = filtered.find((a) => /^\d+(\.\d{1,2})?$/.test(a));
    const amountCents = amountArg ? Math.round(parseFloat(amountArg) * 100) : null;

    const amountIndex = amountArg ? filtered.indexOf(amountArg) : -1;
    const reason = amountIndex >= 0
        ? filtered.slice(amountIndex + 1).join(' ') || null
        : filtered.join(' ') || null;

    return { amountCents, reason };
}

/**
 * Attempt a refund for a specific session. Throws on Stripe errors
 * (including "already refunded") so callers can handle retry logic.
 */
async function attemptRefund(message, sessionId, purchase, amountCents, reason) {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['payment_intent'],
    });

    const paymentIntent = session.payment_intent;
    if (!paymentIntent || typeof paymentIntent === 'string') {
        throw new Error(`Could not retrieve payment intent for session ${sessionId}`);
    }

    const refundParams = { payment_intent: paymentIntent.id };
    if (amountCents) refundParams.amount = amountCents;
    if (reason) refundParams.metadata = { reason };

    const refund = await stripe.refunds.create(refundParams);

    const refundDollars = (refund.amount / 100).toFixed(2);
    const originalDollars = purchase ? (purchase.amount / 100).toFixed(2) : 'unknown';
    const productName = purchase?.product_name || 'Unknown';
    const isPartial = amountCents && purchase?.amount && amountCents < purchase.amount;

    await message.channel.send(
        `Refund issued — **$${refundDollars}**${isPartial ? ' (partial)' : ''} for ${productName}. Stripe refund \`${refund.id}\``
    );

    // Log to #ops
    await sendEmbed('OPS', {
        title: `💸 Refund Issued${isPartial ? ' (Partial)' : ''}`,
        description: [
            `**Product:** ${productName}`,
            `**Original:** $${originalDollars}`,
            `**Refunded:** $${refundDollars}`,
            reason ? `**Reason:** ${reason}` : null,
            `**Session:** \`${sessionId}\``,
            `**Refund ID:** \`${refund.id}\``,
            `**By:** ${message.author.tag}`,
        ].filter(Boolean).join('\n'),
        color: 0xe74c3c,
    });

    // DM the buyer
    const discordUserId = purchase?.discord_user_id || message.mentions.users.first()?.id;
    if (discordUserId) {
        try {
            const member = await getMember(discordUserId);
            if (member) {
                const dm = await member.createDM();
                const dmEmbed = new EmbedBuilder()
                    .setTitle(`💸 Refund Processed${isPartial ? ' (Partial)' : ''}`)
                    .setDescription(
                        `**$${refundDollars}** has been refunded for **${productName}**.\n\n` +
                        `The refund should appear on your statement within 5-10 business days.` +
                        (reason ? `\n\n**Reason:** ${reason}` : '')
                    )
                    .setColor(0xceff00);
                await dm.send({ embeds: [dmEmbed] });
            }
        } catch (e) {
            console.error(`Failed to DM refund notification to ${discordUserId}:`, e.message);
        }
    }
}

export { handleRefund };
