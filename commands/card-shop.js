/**
 * Card Shop System — Individual card sales via Discord.
 *
 * Commands:
 *   !sell "Card Name" 25.00          — Open listing (anyone can buy via button)
 *   !sell @buyer "Card Name" 25.00   — Reserve a card for a specific buyer (stream sales)
 *   !list open                       — Open a new batch card list session
 *   !list add "Card Name" 25.00      — Add a card to the active list session
 *   !list close                      — Close the list, expire unsold items
 *   !sold <message_id>               — Manually mark a listing as sold (or reply to listing)
 */

import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, StringSelectMenuBuilder } from 'discord.js';
import config from '../config.js';
import { cardListings, listSessions } from '../db.js';
import { client, getMember } from '../discord.js';
import { formatShippingRate, getShippingLabel, hasShippingCoveredByDiscordId } from '../shipping.js';

// In-memory expiry timers: listingId → timeoutId
const expiryTimers = new Map();

/**
 * Format cents as dollars.
 */
function formatPrice(cents) {
    return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Build the checkout URL for a listing.
 */
function checkoutUrl(listingId) {
    return `${config.SHOP_URL.replace(/\/shop$/, '')}/bot/card-shop/checkout/${listingId}`;
}

/**
 * Build an embed for a card listing based on its status.
 */
function buildListingEmbed(listing) {
    const priceLabel = formatPrice(listing.price);
    const shippingNote = `*Shipping: ${formatShippingRate(config.SHIPPING.DOMESTIC)} US / ${formatShippingRate(config.SHIPPING.INTERNATIONAL)} International (waived if already covered this week/month)*`;

    if (listing.status === 'sold') {
        return new EmbedBuilder()
            .setTitle(`🃏 ${listing.card_name}`)
            .setDescription(`~~${priceLabel}~~\n\n**SOLD**`)
            .setColor(0xe74c3c)
            .setFooter({ text: `Listing #${listing.id}` });
    }

    if (listing.status === 'reserved') {
        return new EmbedBuilder()
            .setTitle(`🃏 ${listing.card_name}`)
            .setDescription(
                `**${priceLabel}**\n\n` +
                `🔒 Reserved for <@${listing.buyer_discord_id}> — 30 minutes to checkout\n\n` +
                shippingNote
            )
            .setColor(0xf1c40f)
            .setFooter({ text: `Listing #${listing.id}` });
    }

    if (listing.status === 'expired') {
        return new EmbedBuilder()
            .setTitle(`🃏 ${listing.card_name}`)
            .setDescription(`~~${priceLabel}~~\n\n**EXPIRED** — reservation lapsed`)
            .setColor(0x95a5a6)
            .setFooter({ text: `Listing #${listing.id}` });
    }

    // active / available — uses Discord button instead of raw link
    return new EmbedBuilder()
        .setTitle(`🃏 ${listing.card_name}`)
        .setDescription(
            `**${priceLabel}** — click Buy Now to check out\n\n` +
            shippingNote
        )
        .setColor(0xceff00)
        .setFooter({ text: `Listing #${listing.id}` });
}

/**
 * Fetch and update the listing embed in #card-shop.
 */
async function updateListingEmbed(listing) {
    try {
        const channel = client.channels.cache.get(config.CHANNELS.CARD_SHOP);
        if (!channel || !listing.message_id) return;
        const msg = await channel.messages.fetch(listing.message_id);

        const editPayload = { embeds: [buildListingEmbed(listing)] };

        // Remove button when sold/expired, keep for active/reserved
        if (listing.status === 'sold' || listing.status === 'expired') {
            editPayload.components = [];
        }

        await msg.edit(editPayload);
    } catch (e) {
        console.error('Failed to update card listing embed:', e.message);
    }
}

/**
 * Start a 30-minute expiry timer for a reserved listing.
 * On expiry, relists the card as active and updates the embed.
 */
function startExpiryTimer(listingId) {
    clearExpiryTimer(listingId);

    const timer = setTimeout(async () => {
        expiryTimers.delete(listingId);

        const listing = cardListings.getById.get(listingId);
        if (!listing || listing.status !== 'reserved') return;

        // List session items get relisted (back in the dropdown) instead of expired
        if (listing.list_session_id) {
            const session = listSessions.getById.get(listing.list_session_id);
            if (session && session.status === 'open') {
                cardListings.relistAsActive.run(listingId);
                await updateListSessionEmbed(session);
                console.log(`Card listing #${listingId} reservation lapsed — relisted in List #${session.id}`);

                // Update the buyer's DM if present
                if (listing.buyer_discord_id && listing.buyer_dm_message_id) {
                    try {
                        const member = await getMember(listing.buyer_discord_id);
                        if (member) {
                            const dm = await member.createDM();
                            const dmMsg = await dm.messages.fetch(listing.buyer_dm_message_id);
                            const embed = new EmbedBuilder()
                                .setTitle('⏰ Reservation Expired')
                                .setDescription(`Your reservation for **${listing.card_name}** has expired.`)
                                .setColor(0x95a5a6);
                            await dmMsg.edit({ embeds: [embed], components: [] });
                        }
                    } catch (e) {
                        console.error(`Failed to update expired DM for listing #${listingId}:`, e.message);
                    }
                }
                return;
            }
        }

        // Standalone listing — mark expired as before
        cardListings.markExpired.run(listingId);

        const expired = cardListings.getById.get(listingId);
        await updateListingEmbed(expired);

        // Update the buyer's DM to show expiry
        if (expired.buyer_discord_id && expired.buyer_dm_message_id) {
            try {
                const member = await getMember(expired.buyer_discord_id);
                if (member) {
                    const dm = await member.createDM();
                    const dmMsg = await dm.messages.fetch(expired.buyer_dm_message_id);
                    const embed = new EmbedBuilder()
                        .setTitle('⏰ Reservation Expired')
                        .setDescription(`Your reservation for **${expired.card_name}** has expired.`)
                        .setColor(0x95a5a6);
                    await dmMsg.edit({ embeds: [embed], components: [] });
                }
            } catch (e) {
                console.error(`Failed to update expired DM for listing #${listingId}:`, e.message);
            }
        }

        console.log(`Card listing #${listingId} expired — reservation lapsed`);
    }, config.CARD_RESERVATION_MS);

    expiryTimers.set(listingId, timer);
}

/**
 * Clear an active expiry timer.
 */
function clearExpiryTimer(listingId) {
    const timer = expiryTimers.get(listingId);
    if (timer) {
        clearTimeout(timer);
        expiryTimers.delete(listingId);
    }
}

/**
 * Post a standalone active listing with a Buy Now button in #card-shop.
 * Shared by !sell (no buyer) path.
 */
async function postActiveListing(message, cardName, priceCents) {
    const result = cardListings.create.run(cardName, priceCents, null, 'active');
    const listingId = Number(result.lastInsertRowid);

    const channel = client.channels.cache.get(config.CHANNELS.CARD_SHOP);
    if (!channel) {
        return message.reply('Card shop channel not found. Check config.');
    }

    const listing = cardListings.getById.get(listingId);
    const embed = buildListingEmbed(listing);

    const buyButton = new ButtonBuilder()
        .setCustomId(`card-buy-${listingId}`)
        .setLabel('Buy Now')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🛒');

    const row = new ActionRowBuilder().addComponents(buyButton);
    const msg = await channel.send({ embeds: [embed], components: [row] });
    cardListings.setMessageId.run(msg.id, listingId);

    if (message.channel.id !== channel.id) {
        await message.channel.send(`✅ Listed **${cardName}** for ${formatPrice(priceCents)} in <#${config.CHANNELS.CARD_SHOP}>.`);
    }
}

/**
 * !sell "Card Name" 25.00          — open listing (anyone can buy)
 * !sell @buyer "Card Name" 25.00   — reserved listing for a specific buyer
 */
async function handleSell(message, args) {
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the server owner can list cards for sale.');
    }

    const buyer = message.mentions.users.first();

    // Parse quoted card name
    const fullText = message.content;
    const nameMatch = fullText.match(/"([^"]+)"/);
    if (!nameMatch) {
        return message.reply('Card name must be in quotes: `!sell "Card Name" 25.00` or `!sell @buyer "Card Name" 25.00`');
    }
    const cardName = nameMatch[1];

    // Parse price — last number in the message after the closing quote
    const afterQuote = fullText.slice(fullText.lastIndexOf('"') + 1).trim();
    const priceMatch = afterQuote.match(/([\d]+(?:\.[\d]{1,2})?)/);
    if (!priceMatch) {
        return message.reply('Include a price: `!sell "Card Name" 25.00`');
    }
    const priceCents = Math.round(parseFloat(priceMatch[1]) * 100);

    if (priceCents <= 0) {
        return message.reply('Price must be greater than zero.');
    }

    // No buyer mentioned — post an open listing
    if (!buyer) {
        return postActiveListing(message, cardName, priceCents);
    }

    // Buyer mentioned — reserved listing flow
    const result = cardListings.create.run(cardName, priceCents, buyer.id, 'reserved');
    const listingId = Number(result.lastInsertRowid);

    // Post embed in #card-shop
    const channel = client.channels.cache.get(config.CHANNELS.CARD_SHOP);
    if (!channel) {
        return message.reply('Card shop channel not found. Check config.');
    }

    const listing = cardListings.getById.get(listingId);
    const embed = buildListingEmbed(listing);
    const msg = await channel.send({ embeds: [embed] });
    cardListings.setMessageId.run(msg.id, listingId);

    // DM the buyer with a Buy Now button (identity captured via interaction handler)
    const buyButton = new ButtonBuilder()
        .setCustomId(`sell-buy-${listingId}`)
        .setLabel('Complete Purchase')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🛒');
    const buyRow = new ActionRowBuilder().addComponents(buyButton);

    const covered = hasShippingCoveredByDiscordId(buyer.id);
    const shippingNote = covered
        ? '✅ Shipping already covered this period'
        : (() => {
            const { rate, label } = getShippingLabel(buyer.id);
            return `📦 ${label}: ${formatShippingRate(rate)}`;
        })();
    try {
        const member = await getMember(buyer.id);
        if (member) {
            const dm = await member.createDM();
            const dmEmbed = new EmbedBuilder()
                .setTitle(`🃏 Card Reserved for You!`)
                .setDescription(
                    `**${cardName}** — ${formatPrice(priceCents)}\n` +
                    `${shippingNote}\n\n` +
                    `⏰ This reservation expires in 30 minutes.`
                )
                .setColor(0xf1c40f);
            const dmMsg = await dm.send({ embeds: [dmEmbed], components: [buyRow] });
            cardListings.setBuyerDmMessageId.run(dmMsg.id, listingId);
        }
    } catch {
        // DMs disabled — post fallback in channel with button
        await channel.send({ content: `<@${buyer.id}> Your card is reserved!`, components: [buyRow] });
    }

    // Start 30-minute expiry
    startExpiryTimer(listingId);

    if (message.channel.id !== channel.id) {
        await message.channel.send(`✅ Reserved **${cardName}** for <@${buyer.id}> in <#${config.CHANNELS.CARD_SHOP}>.`);
    }
}

// =========================================================================
// List Session — batch listing system
// =========================================================================

/**
 * Build the summary embed for a list session.
 */
function buildListSessionEmbed(session, items) {
    const isOpen = session.status === 'open';
    const shippingNote = `*Shipping: ${formatShippingRate(config.SHIPPING.DOMESTIC)} US / ${formatShippingRate(config.SHIPPING.INTERNATIONAL)} International (waived if already covered this week/month)*`;

    const lines = items.map((item, i) => {
        const num = i + 1;
        const price = formatPrice(item.price);
        if (item.status === 'sold') {
            return `${num}. ~~${item.card_name}~~ — ~~${price}~~ SOLD`;
        }
        if (item.status === 'reserved') {
            return `${num}. ${item.card_name} — ${price} 🔒`;
        }
        if (item.status === 'expired') {
            return `${num}. ~~${item.card_name}~~ — ~~${price}~~ EXPIRED`;
        }
        return `${num}. ${item.card_name} — ${price}`;
    });

    const soldCount = items.filter(i => i.status === 'sold').length;
    const statusLabel = isOpen ? 'OPEN' : 'CLOSED';
    const color = isOpen ? 0xceff00 : 0x95a5a6;

    const description = (lines.length ? lines.join('\n') : '*No items yet*') +
        `\n\n*${items.length} item${items.length !== 1 ? 's' : ''} listed${soldCount ? ` • ${soldCount} sold` : ''}*` +
        (isOpen && items.length ? `\n\n${shippingNote}` : '');

    return new EmbedBuilder()
        .setTitle(`🗂️ Card List #${session.id} — ${statusLabel}`)
        .setDescription(description)
        .setColor(color);
}

/**
 * Build the select menu for purchasing items from a list session.
 * Returns null if no active items remain.
 */
function buildListSessionSelectMenu(session, items) {
    const available = items.filter(i => i.status === 'active');
    if (!available.length) return null;

    const menu = new StringSelectMenuBuilder()
        .setCustomId(`list-buy-${session.id}`)
        .setPlaceholder('Select a card to buy')
        .addOptions(
            available.map(item => ({
                label: `${item.card_name} — ${formatPrice(item.price)}`,
                value: String(item.id),
            }))
        );

    return new ActionRowBuilder().addComponents(menu);
}

/**
 * Fetch items, rebuild embed + select menu, and edit the session message in #card-shop.
 */
async function updateListSessionEmbed(session) {
    try {
        const channel = client.channels.cache.get(config.CHANNELS.CARD_SHOP);
        if (!channel || !session.message_id) return;

        const items = cardListings.getBySessionId.all(session.id);
        const embed = buildListSessionEmbed(session, items);
        const menuRow = session.status === 'open' ? buildListSessionSelectMenu(session, items) : null;

        const msg = await channel.messages.fetch(session.message_id);
        await msg.edit({
            embeds: [embed],
            components: menuRow ? [menuRow] : [],
        });
    } catch (e) {
        console.error('Failed to update list session embed:', e.message);
    }
}

/**
 * !list open — create a new list session
 */
async function handleListOpen(message) {
    const existing = listSessions.getActive.get();
    if (existing) {
        return message.reply(`A list is already open (List #${existing.id}). Close it first with \`!list close\`.`);
    }

    const result = listSessions.create.run();
    const sessionId = Number(result.lastInsertRowid);
    const session = listSessions.getById.get(sessionId);

    const channel = client.channels.cache.get(config.CHANNELS.CARD_SHOP);
    if (!channel) {
        return message.reply('Card shop channel not found. Check config.');
    }

    const embed = buildListSessionEmbed(session, []);
    const msg = await channel.send({ embeds: [embed] });
    listSessions.setMessageId.run(msg.id, sessionId);

    if (message.channel.id !== channel.id) {
        await message.channel.send(`✅ Opened **Card List #${sessionId}** in <#${config.CHANNELS.CARD_SHOP}>.`);
    }
}

/**
 * !list add "Card Name" 25.00 — add an item to the active list session
 */
async function handleListAdd(message) {
    const session = listSessions.getActive.get();
    if (!session) {
        return message.reply('No list is open. Start one with `!list open`.');
    }

    // Parse quoted card name
    const fullText = message.content;
    const nameMatch = fullText.match(/"([^"]+)"/);
    if (!nameMatch) {
        return message.reply('Usage: `!list add "Card Name" 25.00`');
    }
    const cardName = nameMatch[1];

    // Parse price
    const afterQuote = fullText.slice(fullText.lastIndexOf('"') + 1).trim();
    const priceMatch = afterQuote.match(/([\d]+(?:\.[\d]{1,2})?)/);
    if (!priceMatch) {
        return message.reply('Include a price: `!list add "Card Name" 25.00`');
    }
    const priceCents = Math.round(parseFloat(priceMatch[1]) * 100);

    if (priceCents <= 0) {
        return message.reply('Price must be greater than zero.');
    }

    // Create listing linked to session
    cardListings.createWithSession.run(cardName, priceCents, null, 'active', session.id);

    // Update the summary embed
    await updateListSessionEmbed(session);

    await message.channel.send(`✅ Added **${cardName}** (${formatPrice(priceCents)}) to List #${session.id}.`);
}

/**
 * !list close — close the active list session, expire unsold items
 */
async function handleListClose(message) {
    const session = listSessions.getActive.get();
    if (!session) {
        return message.reply('No list is open.');
    }

    // Clear expiry timers for any reserved items in this session
    const items = cardListings.getBySessionId.all(session.id);
    for (const item of items) {
        if (item.status === 'reserved') {
            clearExpiryTimer(item.id);
        }
    }

    // Expire all unsold items and close the session
    cardListings.expireBySessionId.run(session.id);
    listSessions.close.run(session.id);

    // Update the embed to closed state
    const closed = listSessions.getById.get(session.id);
    await updateListSessionEmbed(closed);

    const soldCount = items.filter(i => i.status === 'sold').length;
    await message.channel.send(`✅ Closed **Card List #${session.id}** — ${soldCount} sold, ${items.length - soldCount} expired.`);
}

/**
 * !list open | !list add "Card" 25.00 | !list close
 */
async function handleList(message, args) {
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the server owner can manage card lists.');
    }

    const sub = args[0]?.toLowerCase();
    switch (sub) {
        case 'open':  return handleListOpen(message);
        case 'add':   return handleListAdd(message);
        case 'close': return handleListClose(message);
        default:
            return message.reply('Usage: `!list open`, `!list add "Card Name" 25.00`, `!list close`');
    }
}

/**
 * !sold <message_id> or reply to a listing message
 */
async function handleSold(message, args) {
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the server owner can mark cards as sold.');
    }

    // Determine message ID from args or reply reference
    let targetMessageId = args[0];
    if (!targetMessageId && message.reference?.messageId) {
        targetMessageId = message.reference.messageId;
    }

    if (!targetMessageId) {
        return message.reply('Usage: `!sold <message_id>` or reply to the listing message.');
    }

    const listing = cardListings.getByMessageId.get(targetMessageId);
    if (!listing) {
        return message.reply('No card listing found for that message.');
    }

    if (listing.status === 'sold') {
        return message.reply('That listing is already marked as sold.');
    }

    // Mark sold and update
    cardListings.markSold.run(listing.id);
    clearExpiryTimer(listing.id);

    const updated = cardListings.getById.get(listing.id);

    // Update the appropriate embed — list session or standalone
    if (updated.list_session_id) {
        const session = listSessions.getById.get(updated.list_session_id);
        if (session) await updateListSessionEmbed(session);
    } else {
        await updateListingEmbed(updated);
    }

    await message.channel.send(`✅ **${listing.card_name}** marked as sold.`);
}

export {
    handleSell,
    handleList,
    handleSold,
    startExpiryTimer,
    clearExpiryTimer,
    updateListingEmbed,
    updateListSessionEmbed,
    expiryTimers as _expiryTimers,
};
