/**
 * Unified refund propagator.
 *
 * Single source of truth for the side effects every refund must produce,
 * regardless of whether the refund originated from:
 *   - Stripe Dashboard / API (`charge.refunded` webhook)
 *   - Stripe dispute outcomes (`charge.dispute.created`, `charge.dispute.closed`)
 *   - Manual `!refund` Discord command
 *
 * Side effects (in order — each is idempotent on its own):
 *   1. Mark `purchases.refunded_at` + `refund_amount` + `refund_reason`
 *   2. Mark the unified queue entry status='refunded' (via WP REST)
 *   3. Cancel the ShippingEasy order when full-refund-AND-unshipped
 *   4. Post a #ops embed summarizing the refund + downstream cleanup
 *   5. DM the buyer (when Discord-linked)
 *
 * Re-running for the same session is safe: WP returns `duplicate=true` on the
 * queue mirror, the SQLite UPDATE preserves the original `refunded_at`, and
 * ShippingEasy cancel is gated on `shippingeasy_canceled_at` being null.
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { purchases } from '../db.js';
import { getMember, sendEmbed } from '../discord.js';
import * as queueSource from './queue-source.js';
import { cancelOrder as cancelShippingEasyOrder } from '../shippingeasy-api.js';

/**
 * @param {string} sessionId Stripe checkout session id (cs_…)
 * @param {object} opts
 * @param {'webhook_refund'|'webhook_dispute'|'command'} opts.source — origin of the refund
 * @param {number|null} opts.amountCents — refunded amount in cents; null means full
 * @param {string|null} opts.reason — short reason string
 * @param {string|null} opts.refundId — Stripe refund id (re_…) when known
 * @param {{ tag?: string, id?: string }|null} opts.actor — who initiated the refund (DM context)
 * @returns {Promise<{ ok: boolean, queueDuplicate: boolean, shippingCanceled: boolean }>}
 */
export async function propagateRefund(sessionId, opts = {}) {
    const {
        source = 'webhook_refund',
        amountCents = null,
        reason = null,
        refundId = null,
        actor = null,
    } = opts;

    const purchase = purchases.getBySessionId.get(sessionId) || null;
    const isPartial = !!(purchase && amountCents != null && amountCents < purchase.amount);

    // 1. Mark purchases row(s) refunded — multi-line orders share a session id
    purchases.markRefunded.run(amountCents ?? null, reason ?? null, sessionId);

    // 2. Mirror to the unified queue (WP). Idempotent on the WP side.
    let queueDuplicate = false;
    try {
        const result = await queueSource.markEntryRefundedBySession(sessionId, {
            refundAmountCents: amountCents,
            reason,
            isPartial,
        });
        queueDuplicate = !!result?.duplicate;
    } catch (e) {
        console.error(`refund-propagator queue mirror failed for ${sessionId}:`, e.message);
    }

    // 3. Cancel ShippingEasy order — only on full refund of an unshipped physical order
    const shipping = await maybeCancelShipping(purchase, isPartial);

    // 4. Post #ops embed
    await postOpsEmbed({ purchase, sessionId, source, amountCents, reason, refundId, actor, isPartial, shipping });

    // 5. DM the buyer when linked
    await dmBuyer({ purchase, sessionId, source, amountCents, reason, isPartial, shippingCanceled: shipping.canceled });

    return { ok: true, queueDuplicate, shippingCanceled: shipping.canceled };
}

/**
 * Returns `{ canceled, label }`:
 *   - canceled: bool — true only when the SE cancel call succeeded
 *   - label: string|null — short human-readable status for the #ops embed
 *     ('order canceled', 'already shipped — not canceled', 'cancel failed —
 *     needs manual cleanup', etc.). Null when nothing shipping-related happened.
 */
async function maybeCancelShipping(purchase, isPartial) {
    if (!purchase) return { canceled: false, label: null };
    if (!purchase.shippingeasy_order_id) return { canceled: false, label: null };
    if (isPartial) {
        return { canceled: false, label: 'order left in place (partial refund — buyer keeps item)' };
    }
    if (purchase.shipped_at) {
        return { canceled: false, label: `already shipped — not canceled` };
    }
    if (purchase.shippingeasy_canceled_at) {
        return { canceled: false, label: 'already canceled (no-op)' };
    }

    try {
        const ok = await cancelShippingEasyOrder({
            orderId: purchase.shippingeasy_order_id,
            sessionId: purchase.stripe_session_id,
            email: purchase.customer_email,
        });
        if (ok) {
            purchases.markShippingEasyCanceled.run(purchase.stripe_session_id);
            return { canceled: true, label: `order canceled (\`${purchase.shippingeasy_order_id}\`)` };
        }
    } catch (e) {
        console.error(`refund-propagator shipping cancel failed for ${purchase.stripe_session_id}:`, e.message);
    }
    return { canceled: false, label: `⚠️ Cancel failed (\`${purchase.shippingeasy_order_id}\`) — needs manual cleanup` };
}

async function postOpsEmbed({ purchase, sessionId, source, amountCents, reason, refundId, actor, isPartial, shipping }) {
    const refundDollars = amountCents != null ? `$${(amountCents / 100).toFixed(2)}` : 'full';
    const originalDollars = purchase?.amount != null ? `$${(purchase.amount / 100).toFixed(2)}` : 'unknown';
    const product = purchase?.product_name || 'Unknown';

    const titlePrefix = source === 'webhook_dispute' ? '⚠️ Dispute' : '💸 Refund';
    const partialTag = isPartial ? ' (Partial)' : '';
    const sourceLabel = {
        webhook_refund: 'Stripe Dashboard / API',
        webhook_dispute: 'Stripe dispute',
        command: 'manual `!refund`',
    }[source] || source;

    const lines = [
        `**Product:** ${product}`,
        `**Original:** ${originalDollars}`,
        `**Refunded:** ${refundDollars}`,
        reason ? `**Reason:** ${reason}` : null,
        `**Session:** \`${sessionId}\``,
        refundId ? `**Refund ID:** \`${refundId}\`` : null,
        `**Source:** ${sourceLabel}`,
        actor?.tag ? `**By:** ${actor.tag}` : null,
        shipping?.label ? `**ShippingEasy:** ${shipping.label}` : null,
    ].filter(Boolean).join('\n');

    try {
        await sendEmbed('OPS', {
            title: `${titlePrefix} Issued${partialTag}`,
            description: lines,
            color: source === 'webhook_dispute' ? 0xe67e22 : 0xe74c3c,
        });
    } catch (e) {
        console.error(`refund-propagator #ops embed failed for ${sessionId}:`, e.message);
    }
}

async function dmBuyer({ purchase, sessionId, source, amountCents, reason, isPartial, shippingCanceled }) {
    const discordUserId = purchase?.discord_user_id;
    if (!discordUserId) return;

    // Disputes are adversarial — don't DM the buyer with a "thanks for the refund" embed
    // when they just chargebacked us. The #ops embed is the audit trail; manual DM if needed.
    if (source === 'webhook_dispute') return;

    const refundDollars = amountCents != null ? `$${(amountCents / 100).toFixed(2)}` : 'a full refund';
    const product = purchase?.product_name || 'your order';

    let shippingLine = '';
    if (shippingCanceled) {
        shippingLine = 'Your order has been canceled and will **not** ship.\n\n';
    } else if (purchase?.shipped_at && !isPartial) {
        shippingLine = 'Your package has already shipped — please reply here if you need to coordinate a return.\n\n';
    } else if (isPartial && purchase?.shipping_address) {
        shippingLine = 'Your order is still on track to ship — this is a partial refund, not a cancellation.\n\n';
    }

    try {
        const member = await getMember(discordUserId);
        if (!member) return;
        const dm = await member.createDM();
        const dmEmbed = new EmbedBuilder()
            .setTitle(`💸 Refund Processed${isPartial ? ' (Partial)' : ''}`)
            .setDescription(
                `**${refundDollars}** has been refunded for **${product}**.\n\n` +
                shippingLine +
                'The refund should appear on your statement within 5-10 business days.' +
                (reason ? `\n\n**Reason:** ${reason}` : '') +
                `\n\nFull policy: ${config.SHOP_URL}/how-it-works/refund-policy`
            )
            .setColor(0xceff00);
        await dm.send({ embeds: [dmEmbed] });
    } catch (e) {
        console.error(`refund-propagator DM failed for ${discordUserId}:`, e.message);
    }
}
