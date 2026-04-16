/**
 * Waive Command — !waive @user
 *
 * Owner-only. Waives shipping for a buyer for the current period.
 * Two paths:
 *   A) Already paid → refund via Stripe + remove shipping record
 *   B) Hasn't paid → insert a $0 waiver record so future checkouts skip shipping
 */

import Stripe from 'stripe';
import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { purchases, shipping } from '../db.js';
import { sendEmbed } from '../discord.js';
import { getShippingRecord, recordShipping, isInternationalByEmail } from '../shipping.js';

const stripe = new Stripe(config.STRIPE_SECRET_KEY);

async function handleWaive(message, args) {
    // Owner-only
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the server owner can waive shipping.');
    }

    const mentioned = message.mentions.users.first();
    if (!mentioned) {
        return message.reply('Usage: `!waive @user`');
    }

    // Look up linked email
    const link = purchases.getEmailByDiscordId.get(mentioned.id);
    if (!link) {
        return message.reply(`<@${mentioned.id}> doesn't have a linked email. They need to \`!link\` first.`);
    }

    const email = link.customer_email;
    const record = getShippingRecord(email);

    if (record) {
        // Path A — Already paid shipping this period → refund
        if (record.stripe_session_id) {
            try {
                // Retrieve the checkout session to get the PaymentIntent
                const session = await stripe.checkout.sessions.retrieve(record.stripe_session_id, {
                    expand: ['payment_intent'],
                });

                const paymentIntent = session.payment_intent;
                if (!paymentIntent || typeof paymentIntent === 'string') {
                    return message.reply(`Could not retrieve payment details for session \`${record.stripe_session_id}\`. Try \`!refund session ${record.stripe_session_id}\` manually.`);
                }

                // Issue refund for the shipping amount
                const refund = await stripe.refunds.create({
                    payment_intent: paymentIntent.id,
                    amount: record.amount,
                });

                // Remove the shipping record
                shipping.deleteById.run(record.id);

                const dollars = (record.amount / 100).toFixed(2);

                await message.channel.send(`Shipping waived for <@${mentioned.id}> — **$${dollars}** refunded (Stripe refund \`${refund.id}\`). Shipping record removed.`);

                // Log to #ops
                await sendEmbed('OPS', {
                    title: '📦 Shipping Waived (Refund)',
                    description: [
                        `**User:** <@${mentioned.id}>`,
                        `**Email:** ${email}`,
                        `**Refunded:** $${dollars}`,
                        `**Refund ID:** \`${refund.id}\``,
                        `**By:** ${message.author.tag}`,
                    ].join('\n'),
                    color: 0xe67e22,
                });
            } catch (e) {
                console.error('Waive refund error:', e.message);
                return message.reply(`Stripe refund failed: ${e.message}`);
            }
        } else {
            // Legacy record without stripe_session_id — can't auto-refund
            const dollars = (record.amount / 100).toFixed(2);
            return message.reply(
                `<@${mentioned.id}> paid **$${dollars}** for shipping but the record has no Stripe session ID (pre-migration). ` +
                `Find the session in Stripe Dashboard and use \`!refund session <session_id> ${dollars}\` to refund manually.`
            );
        }
    } else {
        // Path B — Hasn't paid yet → pre-waiver
        recordShipping(email, mentioned.id, 0, 'waiver');

        const intl = isInternationalByEmail(email);
        const period = intl ? 'this month' : 'this week';

        await message.channel.send(`Shipping waived for <@${mentioned.id}> — all checkouts ${period} will skip shipping.`);

        // Log to #ops
        await sendEmbed('OPS', {
            title: '📦 Shipping Waived (Pre-waiver)',
            description: [
                `**User:** <@${mentioned.id}>`,
                `**Email:** ${email}`,
                `**Period:** ${period}`,
                `**By:** ${message.author.tag}`,
            ].join('\n'),
            color: 0xe67e22,
        });
    }
}

export { handleWaive };
