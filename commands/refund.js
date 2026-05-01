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
import config from '../config.js';
import { purchases } from '../db.js';
import { propagateRefund } from '../lib/refund-propagator.js';

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
 * Attempt a refund for a specific session. Issues the Stripe refund, then
 * delegates every downstream side effect (purchases row, queue mirror,
 * ShippingEasy cancel, #ops embed, buyer DM) to the unified propagator —
 * the same helper Stripe webhook handlers use, so dashboard refunds and
 * `!refund` produce identical outcomes.
 *
 * Throws on Stripe errors (including "already refunded") so callers can
 * skip-and-continue against multiple recent purchases.
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
    const isPartial = !!(amountCents && purchase?.amount && amountCents < purchase.amount);

    // The Stripe `charge.refunded` webhook will fire for this same refund and
    // re-trigger the propagator, but it's idempotent — the second pass returns
    // duplicate=true on the queue mirror and short-circuits ShippingEasy cancel
    // because we already set shippingeasy_canceled_at here.
    const result = await propagateRefund(sessionId, {
        source: 'command',
        amountCents: refund.amount,
        reason,
        refundId: refund.id,
        actor: { id: message.author.id, tag: message.author.tag },
    });

    await message.channel.send(
        `Refund issued — **$${refundDollars}**${isPartial ? ' (partial)' : ''} for ${purchase?.product_name || 'Unknown'}. Stripe refund \`${refund.id}\`${result.shippingCanceled ? ' — ShippingEasy order canceled' : ''}`
    );
}

export { handleRefund };
