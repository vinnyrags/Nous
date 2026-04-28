/**
 * Discord Button & Modal Interaction Handlers
 *
 * Routes button clicks and modal submissions from Discord components
 * to the appropriate checkout flow. Each handler:
 *   1. Identifies the buyer (Discord ID → email lookup)
 *   2. Checks their shipping status
 *   3. Creates a personalized Stripe checkout session
 *   4. Replies with an ephemeral checkout URL
 *
 * Button customId prefixes:
 *   card-buy-{listingId}  — card shop purchase
 *   hype-buy-{priceId}    — hype product purchase
 *   battle-buy-{battleId} — battle buy-in
 *
 * Modal customId:
 *   email-link-{context}  — email entry for unlinked buyers
 */

import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import Stripe from 'stripe';
import config from '../config.js';
import { purchases, cardListings, listSessions, battles, giveaways } from '../db.js';
import { startExpiryTimer, clearListingTtl, updateListingEmbed, updateListSessionEmbed } from './card-shop.js';
import { handleGiveawayEntry } from './giveaway.js';
import * as wpPullBox from '../lib/wp-pull-box.js';
import {
    handleJavaWhitelistButton,
    handleJavaWhitelistSubmit,
    JAVA_WHITELIST_BUTTON_ID,
    JAVA_WHITELIST_MODAL_ID,
} from './minecraft.js';
import {
    hasShippingCoveredByDiscordId,
    hasShippingCovered,
    getShippingLabel,
    isInternational,
    formatShippingRate,
} from '../shipping.js';

const baseUrl = config.SHOP_URL.replace(/\/shop$/, '');

/**
 * Route button interactions by customId prefix.
 */
async function handleButtonInteraction(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith('card-buy-')) {
        const listingId = customId.replace('card-buy-', '');
        return handleCardBuy(interaction, Number(listingId));
    }

    if (customId.startsWith('hype-buy-')) {
        const priceId = customId.replace('hype-buy-', '');
        return handleHypeBuy(interaction, priceId);
    }

    if (customId.startsWith('pull-buy-')) {
        const tierOrLegacyId = customId.replace('pull-buy-', '');
        return handlePullBuy(interaction, tierOrLegacyId);
    }

    if (customId.startsWith('battle-buy-')) {
        const battleId = customId.replace('battle-buy-', '');
        return handleBattleBuy(interaction, Number(battleId));
    }

    if (customId.startsWith('sell-buy-')) {
        const listingId = customId.replace('sell-buy-', '');
        return handleSellBuy(interaction, Number(listingId));
    }

    if (customId === 'welcome-link') {
        return handleWelcomeLink(interaction);
    }

    if (customId === JAVA_WHITELIST_BUTTON_ID) {
        return handleJavaWhitelistButton(interaction);
    }

    if (customId.startsWith('giveaway-enter-')) {
        const giveawayId = Number(customId.replace('giveaway-enter-', ''));
        return handleGiveawayButton(interaction, giveawayId);
    }
}

/**
 * Handle modal submissions — email linking and giveaway TikTok entry.
 */
async function handleModalSubmit(interaction) {
    // Giveaway TikTok username modal
    if (interaction.customId.startsWith('giveaway-tiktok-')) {
        const giveawayId = Number(interaction.customId.replace('giveaway-tiktok-', ''));
        const tiktokUsername = interaction.fields.getTextInputValue('tiktok_input')?.trim().replace(/^@/, '');

        if (!tiktokUsername) {
            return interaction.reply({ content: 'Please enter your TikTok username.', ephemeral: true });
        }

        return handleGiveawayEntry(interaction, giveawayId, tiktokUsername);
    }

    // Minecraft Java whitelist modal
    if (interaction.customId === JAVA_WHITELIST_MODAL_ID) {
        return handleJavaWhitelistSubmit(interaction);
    }

    // Pull-box buy modal (slot picker for Discord buyers)
    if (interaction.customId.startsWith('pull-buy-modal-')) {
        const tier = interaction.customId.replace('pull-buy-modal-', '');
        return handlePullBuyModalSubmit(interaction, tier);
    }

    // Email linking modal (welcome channel)
    if (!interaction.customId.startsWith('email-link-')) return;

    return handleEmailLinkSubmit(interaction);
}

/**
 * Handle email modal submission for account linking.
 */
async function handleEmailLinkSubmit(interaction) {
    if (!interaction.customId.startsWith('email-link-')) return;

    const email = interaction.fields.getTextInputValue('email_input')?.trim();
    if (!email || !email.includes('@')) {
        return interaction.reply({ content: 'Please enter a valid email address.', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    // Welcome channel Link Account — validate email in Stripe before linking
    try {
        const stripe = new Stripe(config.STRIPE_SECRET_KEY);
        const customers = await stripe.customers.list({ email, limit: 1 });
        if (!customers.data.length) {
            return interaction.editReply({ content: 'No purchases found for that email. Make sure you are using the same email you used at checkout.' });
        }
    } catch (e) {
        console.error('Stripe customer lookup error:', e.message);
        return interaction.editReply({ content: 'Could not verify email right now. Try again later.' });
    }

    purchases.linkDiscord.run(interaction.user.id, email);
    return interaction.editReply({ content: 'Your account has been linked! Your name will now appear in the queue, order feed, and duck race roster.' });
}

/**
 * Show email prompt modal for unlinked buyers.
 */
function showEmailModal(interaction, contextPrefix) {
    const modal = new ModalBuilder()
        .setCustomId(`email-link-${contextPrefix}`)
        .setTitle('Enter Your Email');

    const emailInput = new TextInputBuilder()
        .setCustomId('email_input')
        .setLabel('Email address (used for shipping status)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setPlaceholder('you@example.com');

    const row = new ActionRowBuilder().addComponents(emailInput);
    modal.addComponents(row);

    return interaction.showModal(modal);
}

/**
 * Build a personalized checkout URL with optional ?user= param.
 */
function buildCheckoutUrl(path, discordUserId) {
    const url = `${baseUrl}/bot/${path}`;
    return discordUserId ? `${url}?user=${discordUserId}` : url;
}

/**
 * Card shop button handler.
 */
async function handleCardBuy(interaction, listingId) {
    const discordUserId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    const listing = cardListings.getById.get(listingId);
    if (!listing || listing.status === 'sold' || listing.status === 'expired') {
        return interaction.editReply({ content: 'This card is no longer available.' });
    }

    // If already reserved by someone else, block
    if (listing.status === 'reserved' && listing.buyer_discord_id !== discordUserId) {
        return interaction.editReply({ content: 'This card is already being purchased by someone else.' });
    }

    // First click on an active listing — reserve it for this buyer
    if (listing.status === 'active') {
        const result = cardListings.reserveForBuyer.run(discordUserId, listingId);
        if (result.changes === 0) {
            // Race condition — someone else reserved it between our check and update
            return interaction.editReply({ content: 'This card is already being purchased by someone else.' });
        }
        const reserved = cardListings.getById.get(listingId);
        await updateListingEmbed(reserved);
        clearListingTtl(listingId); // Pause TTL — reservation expiry takes over
        startExpiryTimer(listingId);
    }

    const covered = hasShippingCoveredByDiscordId(discordUserId);
    const checkoutUrl = buildCheckoutUrl(`card-shop/checkout/${listingId}`, discordUserId);

    const shippingNote = covered
        ? '✅ Shipping already covered this period!'
        : `📦 Includes ${formatShippingRate(getShippingLabel(discordUserId).rate)} shipping`;

    await interaction.editReply({
        content: `🃏 **${listing.card_name}** — $${(listing.price / 100).toFixed(2)}\n${shippingNote}\n\n🛒 **[Complete Purchase](${checkoutUrl})**\n\n⏰ Reserved for you — 30 minutes to complete.`,
    });
}

/**
 * Reserved card (sell) button handler — same flow as card-buy.
 */
async function handleSellBuy(interaction, listingId) {
    const discordUserId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    const listing = cardListings.getById.get(listingId);
    if (!listing || listing.status !== 'reserved') {
        return interaction.editReply({ content: 'This reservation is no longer available.' });
    }

    const covered = hasShippingCoveredByDiscordId(discordUserId);
    const checkoutUrl = buildCheckoutUrl(`card-shop/checkout/${listingId}`, discordUserId);

    const shippingNote = covered
        ? '✅ Shipping already covered this period!'
        : `📦 Includes ${formatShippingRate(getShippingLabel(discordUserId).rate)} shipping`;

    await interaction.editReply({
        content: `🃏 **${listing.card_name}** — $${(listing.price / 100).toFixed(2)}\n${shippingNote}\n\n🛒 **[Complete Purchase](${checkoutUrl})**`,
    });
}

/**
 * Hype product button handler.
 */
async function handleHypeBuy(interaction, priceId) {
    const discordUserId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    const covered = hasShippingCoveredByDiscordId(discordUserId);
    const checkoutUrl = buildCheckoutUrl(`product/checkout/${priceId}`, discordUserId);

    const shippingNote = covered
        ? '✅ Shipping already covered this period!'
        : `📦 Includes ${formatShippingRate(getShippingLabel(discordUserId).rate)} shipping`;

    await interaction.editReply({
        content: `🔥 Ready to check out!\n${shippingNote}\n\n🛒 **[Complete Purchase](${checkoutUrl})**`,
    });
}

/**
 * Battle buy-in button handler.
 */
async function handleBattleBuy(interaction, battleId) {
    const discordUserId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    const battle = battles.getBattleById.get(battleId);
    if (!battle || battle.status !== 'open') {
        return interaction.editReply({ content: 'This battle is no longer open.' });
    }

    // Check if user already entered this battle
    const entries = battles.getEntries.all(battle.id);
    if (entries.some((e) => e.discord_user_id === discordUserId)) {
        return interaction.editReply({ content: `You're already in this battle! One entry per person. Good luck! 🍀` });
    }

    const checkoutUrl = buildCheckoutUrl(`battle/checkout/${battleId}`, discordUserId);

    await interaction.editReply({
        content: `⚔️ **${battle.product_name}** Pack Battle\n📦 Shipping is only charged if you win\n\n🛒 **[Buy Your Pack](${checkoutUrl})**`,
    });
}

/**
 * Welcome channel Link Account button handler.
 */
async function handleWelcomeLink(interaction) {
    const discordUserId = interaction.user.id;

    // Check if already linked
    const link = purchases.getEmailByDiscordId.get(discordUserId);
    if (link) {
        return interaction.reply({
            content: `Your account is already linked to **${link.customer_email}**.`,
            ephemeral: true,
        });
    }

    return showEmailModal(interaction, 'welcome');
}

/**
 * Giveaway entry button handler.
 * Standard giveaways: enter immediately.
 * Social giveaways: show TikTok username modal first.
 */
async function handleGiveawayButton(interaction, giveawayId) {
    const giveaway = giveaways.getById.get(giveawayId);
    if (!giveaway || giveaway.status !== 'open') {
        return interaction.reply({ content: 'This giveaway is no longer open.', ephemeral: true });
    }

    // Social giveaway — show TikTok username modal
    if (giveaway.is_social) {
        const modal = new ModalBuilder()
            .setCustomId(`giveaway-tiktok-${giveawayId}`)
            .setTitle('Enter Giveaway');

        const tiktokInput = new TextInputBuilder()
            .setCustomId('tiktok_input')
            .setLabel('Your TikTok username')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('itzenzottv');

        const row = new ActionRowBuilder().addComponents(tiktokInput);
        modal.addComponents(row);

        return interaction.showModal(modal);
    }

    // Standard giveaway — enter directly
    return handleGiveawayEntry(interaction, giveawayId);
}

/**
 * Pull box button handler — same as card buy but allows 'pull' status.
 */
async function handlePullBuy(interaction, tier) {
    // Tier-based: resolve the active pull box for the requested tier
    // via WP. The legacy `pull-buy-<listingId>` customId path is gone —
    // any old embeds still showing that button will hit the not-found
    // branch below since `1234` is not a valid tier.
    if (tier !== 'v' && tier !== 'vmax') {
        return interaction.reply({
            content: 'This pull-box embed is from a previous run and no longer routes anywhere. Run `!pull v|vmax "Name" <slots>` to open a new box.',
            ephemeral: true,
        });
    }

    let box;
    try {
        box = await wpPullBox.getActiveBox(tier);
    } catch (e) {
        return interaction.reply({ content: `Pull-box service unreachable: ${e.message}`, ephemeral: true });
    }

    if (!box) {
        return interaction.reply({ content: `No ${tier}-tier pull box is open right now.`, ephemeral: true });
    }

    const claimed = (box.claimedSlots || []).length;
    const remaining = box.totalSlots - claimed;
    if (remaining <= 0) {
        return interaction.reply({ content: '🚫 This pull box is sold out!', ephemeral: true });
    }

    // Show a modal so the buyer can pick a quantity and (optionally) the
    // specific slot numbers they want. Leaving the slots field blank
    // falls through to the existing auto-assign-lowest-open-slots flow
    // that the Stripe webhook handles after payment.
    const modal = new ModalBuilder()
        .setCustomId(`pull-buy-modal-${tier}`)
        .setTitle(`Buy from ${box.name}`.slice(0, 45));

    const qtyInput = new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel(`How many pulls? (1-${Math.min(20, remaining)})`)
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue('1')
        .setMaxLength(2);

    const slotsInput = new TextInputBuilder()
        .setCustomId('slots')
        .setLabel('Specific slots? (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setPlaceholder('e.g. 17, 23, 41 — leave blank for auto')
        .setMaxLength(200);

    modal.addComponents(
        new ActionRowBuilder().addComponents(qtyInput),
        new ActionRowBuilder().addComponents(slotsInput),
    );

    await interaction.showModal(modal);
}

/**
 * Handles the modal submission from handlePullBuy. Validates the quantity
 * and (optional) slot numbers, then proxies to /shop/v1/pull-box-checkout
 * which atomically pre-claims the slots and creates the Stripe session.
 * Replies with the checkout URL.
 */
async function handlePullBuyModalSubmit(interaction, tier) {
    const discordUserId = interaction.user.id;
    await interaction.deferReply({ ephemeral: true });

    if (tier !== 'v' && tier !== 'vmax') {
        return interaction.editReply({ content: 'Invalid tier.' });
    }

    const qtyRaw = interaction.fields.getTextInputValue('quantity').trim();
    const slotsRaw = interaction.fields.getTextInputValue('slots').trim();

    const quantity = parseInt(qtyRaw, 10);
    if (!Number.isFinite(quantity) || quantity < 1 || quantity > 20) {
        return interaction.editReply({ content: 'Quantity must be a whole number between 1 and 20.' });
    }

    let box;
    try {
        box = await wpPullBox.getActiveBox(tier);
    } catch (e) {
        return interaction.editReply({ content: `Pull-box service unreachable: ${e.message}` });
    }
    if (!box) {
        return interaction.editReply({ content: `${tier}-tier box closed since you opened the modal.` });
    }
    if (!box.stripePriceId) {
        return interaction.editReply({ content: 'Box not fully configured (no Stripe price). Contact a mod.' });
    }

    let explicitSlots = null;
    if (slotsRaw) {
        explicitSlots = slotsRaw
            .split(',')
            .map((s) => parseInt(s.trim(), 10))
            .filter((n) => Number.isFinite(n) && n > 0);
        if (explicitSlots.length === 0) {
            return interaction.editReply({ content: 'Could not parse slot numbers. Use comma-separated like `17, 23`.' });
        }
        if (explicitSlots.length !== quantity) {
            return interaction.editReply({
                content: `You picked ${explicitSlots.length} slot${explicitSlots.length === 1 ? '' : 's'} but said quantity ${quantity}. Make them match (or leave the slots field blank to auto-assign).`,
            });
        }
        const dedup = [...new Set(explicitSlots)];
        if (dedup.length !== explicitSlots.length) {
            return interaction.editReply({ content: 'Duplicate slot numbers in your list — each slot can only be picked once.' });
        }
        for (const n of explicitSlots) {
            if (n < 1 || n > box.totalSlots) {
                return interaction.editReply({ content: `Slot ${n} is out of range (this box has slots 1-${box.totalSlots}).` });
            }
        }
        const claimed = new Set((box.claimedSlots || []).map((c) => c.slotNumber));
        const conflicts = explicitSlots.filter((n) => claimed.has(n));
        if (conflicts.length > 0) {
            return interaction.editReply({
                content: `Slot${conflicts.length === 1 ? '' : 's'} ${conflicts.join(', ')} already claimed. Click Buy again to see the updated grid and pick others.`,
            });
        }
    }

    // Resolve buyer's email + Discord handle so the slot rows render
    // with the friendly label without waiting for the post-payment webhook.
    const link = purchases.getEmailByDiscordId.get(discordUserId);
    const customerEmail = link?.customer_email || null;
    let discordHandle = null;
    try {
        const member = await getMember(discordUserId);
        discordHandle = member?.user?.username || member?.user?.tag || null;
    } catch {
        // member fetch failed; leave null. WP serializer falls back to email.
    }

    if (explicitSlots) {
        // Slot-bound flow — call the public WP checkout endpoint which
        // does the atomic pre-claim + Stripe session in one shot. This
        // is the same flow the homepage modal uses, just hit from Discord.
        try {
            const res = await fetch(`${config.SITE_URL}/wp-json/shop/v1/pull-box-checkout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    priceId: box.stripePriceId,
                    slots: explicitSlots,
                    customer_email: customerEmail,
                    discord_user_id: discordUserId,
                    discord_handle: discordHandle,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                if (res.status === 409) {
                    return interaction.editReply({
                        content: '⚠️ One or more of those slots were just claimed by someone else. Click Buy again to see the updated grid.',
                    });
                }
                return interaction.editReply({ content: `Checkout failed: ${data.message || res.statusText}` });
            }
            return interaction.editReply({
                content: `🎰 **${box.name}** — claiming slots ${explicitSlots.join(', ')}\n\n🛒 **[Complete checkout →](${data.url})**`,
            });
        } catch (e) {
            return interaction.editReply({ content: `Network error reaching checkout: ${e.message}` });
        }
    }

    // No slots specified — fall through to the existing auto-assign
    // flow via the bot's /pull-box/checkout/:tier route. The Stripe
    // webhook picks the lowest open slots after payment lands.
    const checkoutUrl = buildCheckoutUrl(`pull-box/checkout/${tier}`, discordUserId);
    return interaction.editReply({
        content: `🎰 **${box.name}** — auto-assigning ${quantity} slot${quantity === 1 ? '' : 's'}\n\n🛒 **[Complete checkout →](${checkoutUrl})**`,
    });
}

/**
 * Route select menu interactions by customId prefix.
 */
async function handleSelectMenuInteraction(interaction) {
    const customId = interaction.customId;

    if (customId.startsWith('list-buy-')) {
        const sessionId = Number(customId.replace('list-buy-', ''));
        const listingId = Number(interaction.values[0]);
        return handleListBuy(interaction, sessionId, listingId);
    }
}

/**
 * List session select menu handler — reserve a card and provide checkout.
 */
async function handleListBuy(interaction, sessionId, listingId) {
    const discordUserId = interaction.user.id;

    await interaction.deferReply({ ephemeral: true });

    const listing = cardListings.getById.get(listingId);
    if (!listing || listing.status !== 'active' || listing.list_session_id !== sessionId) {
        return interaction.editReply({ content: 'This card is no longer available.' });
    }

    // Reserve for buyer (atomic — only one user can win the race)
    const result = cardListings.reserveForBuyer.run(discordUserId, listingId);
    if (result.changes === 0) {
        return interaction.editReply({ content: 'This card is already being purchased by someone else.' });
    }

    // Update the summary embed (removes this item from select menu, shows reserved)
    const session = listSessions.getById.get(sessionId);
    if (session) {
        await updateListSessionEmbed(session);
    }

    // Start 30-min expiry timer
    startExpiryTimer(listingId);

    // Send checkout link
    const covered = hasShippingCoveredByDiscordId(discordUserId);
    const checkoutUrl = buildCheckoutUrl(`card-shop/checkout/${listingId}`, discordUserId);

    const shippingNote = covered
        ? '✅ Shipping already covered this period!'
        : `📦 Includes ${formatShippingRate(getShippingLabel(discordUserId).rate)} shipping`;

    await interaction.editReply({
        content: `🃏 **${listing.card_name}** — $${(listing.price / 100).toFixed(2)}\n${shippingNote}\n\n🛒 **[Complete Purchase](${checkoutUrl})**\n\n⏰ Reserved for you — 30 minutes to complete.`,
    });
}

export { handleButtonInteraction, handleModalSubmit, handleSelectMenuInteraction };
