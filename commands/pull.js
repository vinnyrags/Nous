/**
 * Pull Box Command — !pull / /pull
 *
 * Owner-only. Opens, closes, and reports on pull boxes — finite-slot
 * livestream entry pools backed by the WordPress source-of-truth
 * tables (`wp_pull_boxes` + `wp_pull_box_slots`). The Discord embed and
 * the itzenzo.tv homepage modal both project from the same data.
 *
 * Single-box model — only one pull box is open at a time. Price comes
 * from the WP `pb_price_id` setting (a Stripe price ID lookup); Nous
 * doesn't need to know the dollar amount up front.
 *
 * Syntax:
 *   /pull "Box Name" 50          — open a 50-slot box at the configured price
 *   /pull close                  — close the active box
 *   /pull replenish 25           — add 25 slots to the active box
 *   /pull status                 — show the active box state
 */

import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import config from '../config.js';
import * as queueSource from '../lib/queue-source.js';
import * as wpPullBox from '../lib/wp-pull-box.js';
import { getChannel, sendEmbed } from '../discord.js';
import {
    broadcastPullBoxOpened,
    broadcastPullBoxReplenished,
    broadcastPullBoxClosed,
} from '../lib/activity-broadcaster.js';
import { formatShippingRate } from '../shipping.js';

// ===========================================================================
// Top-level dispatch
// ===========================================================================

async function handlePull(message, args) {
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the server owner can manage pull boxes.');
    }

    const sub = (args[0] || '').toLowerCase();

    if (sub === 'close') return handlePullClose(message);
    if (sub === 'replenish') return handlePullReplenish(message, args.slice(1));
    if (sub === 'status') return handlePullStatus(message);

    return handlePullOpen(message, args);
}

// ===========================================================================
// /pull open
// ===========================================================================

async function handlePullOpen(message, args) {
    const parsed = parseOpenArgs(message.content);
    if (parsed.error) return message.reply(parsed.error);

    const { name, totalSlots, priceCents } = parsed;

    // Refuse if a box is already open — single-box model.
    let existing = null;
    try {
        existing = await wpPullBox.getActiveBox();
    } catch (e) {
        return message.reply(`Could not reach the pull-box service: ${e.message}`);
    }
    if (existing) {
        return message.reply(`A pull box is already active: **${existing.name}** (#${existing.id}). Close it first with \`/pull close\`.`);
    }

    let box;
    try {
        box = await wpPullBox.createBox({ name, priceCents, totalSlots });
    } catch (e) {
        return message.reply(`Failed to open box: ${e.message}`);
    }

    const channel = getChannel('CARD_SHOP');
    if (!channel) {
        return message.reply('Card-shop channel not found. Box was created in WP but no embed posted.');
    }

    const embed = buildPullBoxEmbed(box, []);
    const buyButton = new ButtonBuilder()
        .setCustomId('pull-buy')
        .setLabel('Buy Pull(s)')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🎰');
    const row = new ActionRowBuilder().addComponents(buyButton);

    const msg = await channel.send({ embeds: [embed], components: [row] });

    try {
        await wpPullBox.updateBox(box.id, { discordMessageId: msg.id });
    } catch (e) {
        console.error('Failed to attach discord_message_id to pull box:', e.message);
    }

    if (message.channel.id !== channel.id) {
        await message.channel.send(`🎰 Pull box **${name}** ($${(priceCents / 100).toFixed(2)} × ${totalSlots} slots) is live in <#${config.CHANNELS.CARD_SHOP}>!`);
    }

    broadcastPullBoxOpened(box);
}

/**
 * Parse `/pull "Box Name" <total_slots>` or the legacy
 * `!pull "Box Name" <price> <total_slots>` form. Returns either
 * { name, totalSlots, priceCents } or { error: string }.
 *
 * Price is normally not specified — falls back to the box's own
 * Stripe price metadata which WP applies from `pb_price_id`. We default
 * to 500 cents ($5) when price is omitted so the embed shows something
 * sensible up front; WP overrides at the source of truth.
 */
function parseOpenArgs(rawContent) {
    const content = rawContent.replace(/^!pull\s+/i, '').replace(/^\/pull\s+/i, '').trim();

    const nameMatch = content.match(/"([^"]+)"/);
    if (!nameMatch) {
        return { error: 'Usage: `/pull "Box Name" <total_slots>` (e.g. `/pull "Vintage Box" 50`)' };
    }
    const name = nameMatch[1];
    const afterQuote = content.slice(content.lastIndexOf('"') + 1).trim();
    const numbers = afterQuote.match(/[\d]+(?:\.[\d]{1,2})?/g) || [];

    let priceCents = 500; // default $5
    let totalSlots;

    if (numbers.length === 1) {
        // /pull "Name" <slots>
        totalSlots = parseInt(numbers[0], 10);
    } else if (numbers.length >= 2) {
        // Legacy: /pull "Name" <price> <slots>
        priceCents = Math.round(parseFloat(numbers[0]) * 100);
        totalSlots = parseInt(numbers[1], 10);
    } else {
        return { error: 'Usage: `/pull "Box Name" <total_slots>` — total slots required.' };
    }

    if (!Number.isFinite(totalSlots) || totalSlots < 1) {
        return { error: 'Total slots must be a positive integer.' };
    }
    if (!Number.isFinite(priceCents) || priceCents < 1) {
        return { error: 'Price must be a positive number.' };
    }
    return { name, totalSlots, priceCents };
}

// ===========================================================================
// /pull close
// ===========================================================================

async function handlePullClose(message) {
    let target;
    try {
        target = await wpPullBox.getActiveBox();
    } catch (e) {
        return message.reply(`Could not reach the pull-box service: ${e.message}`);
    }

    if (!target) {
        return message.reply('No active pull box to close.');
    }

    try {
        await wpPullBox.closeBox(target.id);
    } catch (e) {
        return message.reply(`Failed to close box: ${e.message}`);
    }

    await refreshBoxEmbed(target.id, { closed: true }).catch(() => {});

    await message.channel.send(`🎰 Pull box **${target.name}** closed.`);

    broadcastPullBoxClosed(target);
}

// ===========================================================================
// /pull replenish N
// ===========================================================================

async function handlePullReplenish(message, args) {
    const amount = parseInt(args[0], 10);
    if (!Number.isFinite(amount) || amount < 1) {
        return message.reply('Usage: `/pull replenish <slots-to-add>` — e.g. `/pull replenish 25`');
    }

    let target;
    try {
        target = await wpPullBox.getActiveBox();
    } catch (e) {
        return message.reply(`Could not reach the pull-box service: ${e.message}`);
    }

    if (!target) {
        return message.reply('No active pull box to replenish.');
    }

    const newTotal = target.totalSlots + amount;
    try {
        await wpPullBox.replenishBox(target.id, newTotal);
    } catch (e) {
        return message.reply(`Failed to replenish: ${e.message}`);
    }

    await refreshBoxEmbed(target.id).catch(() => {});

    await message.channel.send(`📈 Added ${amount} slots to **${target.name}** (${target.totalSlots} → ${newTotal}).`);

    broadcastPullBoxReplenished(target, amount, newTotal);
}

// ===========================================================================
// /pull status
// ===========================================================================

async function handlePullStatus(message) {
    let target;
    try {
        target = await wpPullBox.getActiveBox();
    } catch (e) {
        return message.reply(`Could not reach the pull-box service: ${e.message}`);
    }

    if (!target) {
        return message.reply('No active pull box.');
    }

    const claimed = (target.claimedSlots || []).length;
    await message.reply(`🎰 **${target.name}** ($${(target.priceCents / 100).toFixed(2)}) — ${claimed}/${target.totalSlots} slots claimed`);
}

// ===========================================================================
// Embed
// ===========================================================================

function buildPullBoxEmbed(box, claimedSlots) {
    const claimedNumbers = new Set(claimedSlots.map((c) => c.slotNumber));
    const remaining = box.totalSlots - claimedNumbers.size;
    const isFull = remaining <= 0;
    const isClosed = box.status === 'closed';

    const priceLabel = `$${(box.priceCents / 100).toFixed(2)}`;
    const lines = [];

    if (isClosed) {
        lines.push(`~~${priceLabel}~~ — **CLOSED**`);
    } else if (isFull) {
        lines.push(`~~${priceLabel}~~ — **SOLD OUT**`);
    } else {
        lines.push(`**${priceLabel}** per pull — click Buy Pull(s) to check out`);
    }

    lines.push(`📦 **${claimedNumbers.size}/${box.totalSlots}** slots claimed${remaining > 0 && !isClosed ? ` — ${remaining} remaining` : ''}`);

    if (box.totalSlots <= 200) {
        const rows = [];
        for (let i = 1; i <= box.totalSlots; i += 10) {
            const cells = [];
            for (let j = 0; j < 10 && (i + j) <= box.totalSlots; j++) {
                cells.push(claimedNumbers.has(i + j) ? '🟪' : '⬜');
            }
            rows.push(cells.join(''));
        }
        lines.push('', rows.join('\n'));
    }

    if (claimedSlots.length > 0) {
        const buyerLines = claimedSlots
            .slice()
            .sort((a, b) => a.slotNumber - b.slotNumber)
            .map((c) => `#${c.slotNumber} — ${c.displayLabel}`);
        lines.push('', buyerLines.join('\n'));
    }

    lines.push('', `*Shipping: ${formatShippingRate(config.SHIPPING.DOMESTIC)} US / ${formatShippingRate(config.SHIPPING.INTERNATIONAL)} International (waived if already covered this week/month)*`);

    return new EmbedBuilder()
        .setTitle(`🎰 ${box.name}`)
        .setDescription(lines.join('\n'))
        .setColor(isClosed ? 0x95a5a6 : isFull ? 0xe74c3c : 0x9b59b6)
        .setFooter({ text: `Pull box • ${box.totalSlots} slots` });
}

/**
 * Re-fetch the active box from WP and edit its #card-shop embed in
 * place. Called after slot claims, replenish, and close events so the
 * embed stays current without depending on Nous's local state.
 */
async function refreshBoxEmbed(boxId, { closed = false } = {}) {
    try {
        const channel = getChannel('CARD_SHOP');
        if (!channel) return;

        const boxRow = await wpPullBox.getActiveBox();
        if (!boxRow || boxRow.id !== boxId) {
            // Either the box was closed or another box took its place.
            // The closed-state embed update only matters when we still
            // have a row to render — skip if not.
            return;
        }

        if (!boxRow.discordMessageId) return;

        const msg = await channel.messages.fetch(boxRow.discordMessageId);
        const embed = buildPullBoxEmbed(boxRow, boxRow.claimedSlots || []);

        const components = boxRow.status === 'open' && (boxRow.claimedSlots || []).length < boxRow.totalSlots
            ? [
                new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('pull-buy')
                        .setLabel('Buy Pull(s)')
                        .setStyle(ButtonStyle.Primary)
                        .setEmoji('🎰'),
                ),
            ]
            : [];

        await msg.edit({ embeds: [embed], components });
    } catch (e) {
        console.error('Failed to refresh pull box embed:', e.message);
    }
}

// ===========================================================================
// Stripe webhook entry point — claim slots after payment success
// ===========================================================================

/**
 * Called by the Stripe webhook handler when a `pull_box`-sourced
 * checkout completes. Two flows merge here:
 *
 *   1. Homepage flow: WP already pre-claimed slots at checkout-create
 *      time (rows in pending status). We confirm those rows by
 *      stripe_session_id.
 *   2. Discord flow: no pre-claim. We auto-pick the lowest-numbered
 *      open slots, claim atomically, then immediately confirm.
 *
 * Either way, the result is N confirmed slot rows in WP and a queue
 * entry mirroring the buy.
 */
async function recordPullBoxPurchase({
    stripeSessionId,
    pullBoxId,
    explicitSlots = null,
    quantity = 1,
    discordUserId = null,
    discordHandle = null,
    customerEmail = null,
}) {
    let claimedSlotNumbers = [];

    if (Array.isArray(explicitSlots) && explicitSlots.length > 0) {
        // Homepage path — pre-claim already happened. Just confirm.
        await fetch(`${config.SITE_URL}/wp-json/shop/v1/pull-boxes/${pullBoxId}/confirm-by-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': config.LIVESTREAM_SECRET },
            body: JSON.stringify({ stripe_session_id: stripeSessionId }),
        }).catch((e) => console.error('confirm-by-session failed:', e.message));
        claimedSlotNumbers = explicitSlots.slice();
    } else {
        // Discord path — auto-pick lowest open slots and claim them.
        try {
            const target = await wpPullBox.getActiveBox();
            if (!target || target.id !== pullBoxId) {
                console.error(`Pull box #${pullBoxId} no longer active — Discord buyer ${discordUserId || customerEmail} payment landed but no claim made`);
                await sendEmbed('OPS', {
                    title: '⚠️ Pull Box Closed Mid-Payment',
                    description: `Box #${pullBoxId} closed before this Discord buyer's webhook landed. Payment went through; manual claim or refund needed.`,
                    color: 0xff0000,
                });
                return;
            }

            const claimed = new Set((target.claimedSlots || []).map((c) => c.slotNumber));
            const open = [];
            for (let n = 1; n <= target.totalSlots && open.length < quantity; n++) {
                if (!claimed.has(n)) open.push(n);
            }

            if (open.length < quantity) {
                console.error(`Pull box #${pullBoxId} only had ${open.length} open slots but Discord buyer requested ${quantity}`);
                await sendEmbed('OPS', {
                    title: '⚠️ Pull Box Oversold',
                    description: `Box #${pullBoxId} oversold — only ${open.length} open slots but a Discord buyer paid for ${quantity}. Manual refund/claim needed.`,
                    color: 0xff0000,
                });
                quantity = open.length;
            }

            const claimResp = await wpPullBox.claimSlots(target.id, open.slice(0, quantity), {
                discordUserId,
                discordHandle,
                customerEmail,
                stripeSessionId,
            });
            claimedSlotNumbers = claimResp?.claimed || open.slice(0, quantity);

            await fetch(`${config.SITE_URL}/wp-json/shop/v1/pull-boxes/${target.id}/confirm-by-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Bot-Secret': config.LIVESTREAM_SECRET },
                body: JSON.stringify({ stripe_session_id: stripeSessionId }),
            }).catch((e) => console.error('confirm-by-session failed:', e.message));
        } catch (e) {
            console.error('Discord auto-claim failed:', e.message);
            return;
        }
    }

    try {
        const activeQueue = await queueSource.getActiveQueue();
        if (activeQueue) {
            const result = await queueSource.addEntry({
                queueId: activeQueue.id,
                discordUserId,
                discordHandle,
                customerEmail,
                productName: `Pull Box (${claimedSlotNumbers.length} slot${claimedSlotNumbers.length === 1 ? '' : 's'})`,
                quantity: claimedSlotNumbers.length,
                stripeSessionId,
                type: 'pull_box',
                source: discordUserId ? 'discord' : 'shop',
                externalRef: `stripe:${stripeSessionId}:pull`,
                detailLabel: `Pull Box • slots ${claimedSlotNumbers.join(', ')}`,
                detailData: {
                    pullBoxId,
                    slots: claimedSlotNumbers,
                },
            });
            if (result?.closedSession) {
                await sendEmbed('OPS', {
                    title: '⚠️ Closed-Session Race — Pull Box',
                    description: [
                        `**Buyer:** ${discordUserId ? `<@${discordUserId}>` : (customerEmail || 'unknown')}`,
                        `**Pull box:** ${pullBoxId} (slots ${claimedSlotNumbers.join(', ')})`,
                        `**Stripe session:** \`${stripeSessionId}\``,
                        '',
                        'Pull-box buy was paid but the queue session was closed before the queue mirror could land. Slot rows are confirmed; manual queue insert if needed.',
                    ].join('\n'),
                    color: 0xe67e22,
                });
            }
        }
    } catch (e) {
        console.error('Failed to mirror pull-box buy to queue:', e.message);
    }

    await refreshBoxEmbed(pullBoxId).catch(() => {});
}

// ===========================================================================
// Legacy export — kept so existing callers don't break during cutover
// ===========================================================================

/**
 * @deprecated Use recordPullBoxPurchase instead.
 */
async function recordPullPurchase(_listingId, _discordUserId = null, _customerEmail = null, _quantity = 1, _stripeSessionId = null) {
    console.warn('recordPullPurchase (legacy) called — listing-based pull boxes are deprecated. Migrate caller to recordPullBoxPurchase.');
}

export { handlePull, recordPullPurchase, recordPullBoxPurchase, refreshBoxEmbed };
