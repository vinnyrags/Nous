/**
 * Nous — Discord bot for itzenzo.tv.
 *
 * Features:
 *  - Order notifications (Stripe → #order-feed)
 *  - Low-stock alerts (Stripe → #deals)
 *  - Going-live / stream-ended (Twitch → #announcements)
 *  - Livestream mode (/live, /offline — master switches for stream sessions)
 *  - Pack battle system (/battle commands + Stripe payment verification)
 *  - Queue system (/queue open|close + auto-entries from Stripe purchases)
 *  - Duck race (/duckrace — one entry per unique buyer in queue)
 *  - Account linking (auto via Stripe metadata, /link as user-facing fallback)
 *  - Role promotion (Xipe at 1+ purchases, Long at 5+)
 *  - New product alerts (POST /alerts/products → #deals)
 *  - Real-time queue embed updated in #queue
 *  - Shipping notifications (/dropped-off → DMs buyers, posts to #order-feed + #ops)
 *  - Analytics (/snapshot → on-demand snapshots, auto stream recaps on /offline)
 *  - Giveaway system (/giveaway — reaction-based entries, /spin for animated draw)
 *  - Product sync (/sync — Sheets → Stripe → WordPress pipeline)
 *  - Coupons (/coupon create|off|status — Stripe promo codes)
 *
 * All ops commands are Discord slash commands (Akivili-only). The
 * legacy `!command` text dispatcher was removed 2026-05-03 in commit
 * 5b27918. /link is the only user-facing slash command.
 *
 * Usage:
 *   node index.js
 *   npm start
 */

import config from './config.js';
import { client } from './discord.js';
import { startServer } from './server.js';
import { initGiveaways } from './commands/giveaway.js';
import { syncBotCommands } from './sync-bot-commands.js';
import * as productCache from './lib/product-cache.js';
import { initCommunityGoals } from './community-goals.js';
import { initWelcome } from './commands/welcome.js';
import { initMinecraftChannel, handleMinecraftReaction } from './commands/minecraft.js';
import { initLfgChannel } from './commands/lfg.js';
import { broadcastDiscordJoin } from './lib/activity-broadcaster.js';
// =========================================================================
// Legacy !command text dispatcher removed 2026-05-03 — all ops commands
// run as Discord slash commands now (see SLASH_HANDLERS below). Clean
// state: never went live with the legacy path post-cutover.
// =========================================================================

// =========================================================================
// Slash command dispatcher
// =========================================================================

import { handleOp, ROUTE_NAMES } from './commands/slash/op.js';
import { handleQueueSlash } from './commands/slash/queue.js';
import { handleResetSlash } from './commands/slash/reset.js';
import { handleLiveSlash, handleOfflineSlash } from './commands/slash/live.js';
import { handleSyncSlash } from './commands/slash/sync.js';
import { handleHypeSlash } from './commands/slash/hype.js';
import { handleBattleSlash } from './commands/slash/battle.js';
import { handleDuckRaceSlash } from './commands/slash/duckrace.js';
import { handleSpinSlash } from './commands/slash/spin.js';
import {
    handleLinkSlash,
    handlePullSlash,
    handleGiveawaySlash,
    handleCouponSlash,
    handleTrackingSlash,
    handleShipmentsSlash,
    handleRefundSlash,
    handleWaiveSlash,
    handleSnapshotSlash,
    handleCaptureSlash,
    handleNousSlash,
    handleShippingAdminSlash,
    handleShippingAuditSlash,
    handleIntlSlash,
    handleIntlShipSlash,
    handleDroppedOffSlash,
    handleRequestsSlash,
    handleRequestSlash,
    handleSellSlash,
    handleListSlash,
    handleSoldSlash,
} from './commands/slash/phase-c.js';
import { withAudit } from './lib/op-audit.js';

const SLASH_HANDLERS = {
    // Phase A
    op: withAudit('op', handleOp),
    queue: withAudit('queue', handleQueueSlash),
    reset: withAudit('reset', handleResetSlash),
    // Phase B (high-frequency native)
    live: withAudit('live', handleLiveSlash),
    offline: withAudit('offline', handleOfflineSlash),
    sync: withAudit('sync', handleSyncSlash),
    hype: withAudit('hype', handleHypeSlash),
    battle: withAudit('battle', handleBattleSlash),
    duckrace: withAudit('duckrace', handleDuckRaceSlash),
    spin: withAudit('spin', handleSpinSlash),
    // Phase C (mid/low-frequency native)
    link: withAudit('link', handleLinkSlash),
    pull: withAudit('pull', handlePullSlash),
    giveaway: withAudit('giveaway', handleGiveawaySlash),
    coupon: withAudit('coupon', handleCouponSlash),
    tracking: withAudit('tracking', handleTrackingSlash),
    shipments: withAudit('shipments', handleShipmentsSlash),
    refund: withAudit('refund', handleRefundSlash),
    waive: withAudit('waive', handleWaiveSlash),
    snapshot: withAudit('snapshot', handleSnapshotSlash),
    capture: withAudit('capture', handleCaptureSlash),
    nous: withAudit('nous', handleNousSlash),
    shipping: withAudit('shipping', handleShippingAdminSlash),
    'shipping-audit': withAudit('shipping-audit', handleShippingAuditSlash),
    intl: withAudit('intl', handleIntlSlash),
    'intl-ship': withAudit('intl-ship', handleIntlShipSlash),
    'dropped-off': withAudit('dropped-off', handleDroppedOffSlash),
    requests: withAudit('requests', handleRequestsSlash),
    request: withAudit('request', handleRequestSlash),
    sell: withAudit('sell', handleSellSlash),
    list: withAudit('list', handleListSlash),
    sold: withAudit('sold', handleSoldSlash),
};

// =========================================================================
// Autocomplete router — slash command typed-as-you-go suggestions
// =========================================================================

async function routeAutocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const value = (focused?.value || '').toString();
    const lower = value.toLowerCase().trim();

    if (interaction.commandName === 'op' && focused.name === 'command') {
        // /op <command> — match against the legacy command names
        const matches = ROUTE_NAMES
            .filter((name) => !lower || name.toLowerCase().startsWith(lower))
            .slice(0, 25)
            .map((name) => ({ name, value: name }));
        return interaction.respond(matches);
    }

    if (interaction.commandName === 'battle' && focused.name === 'product') {
        // /battle start product:<name> — single product, classic autocomplete
        return interaction.respond(productCache.suggest(value, 25));
    }

    if (interaction.commandName === 'hype' && focused.name === 'products') {
        // /hype products:"Crown Zenith ETB, Prismatic Evolutions" — multi-
        // product comma list. Autocomplete only the LAST term after the
        // last comma; preserve everything before it. The picked suggestion
        // replaces the last term inline.
        const lastComma = value.lastIndexOf(',');
        const prefix = lastComma >= 0 ? value.slice(0, lastComma + 1).trimEnd() + ' ' : '';
        const tail = lastComma >= 0 ? value.slice(lastComma + 1).trimStart() : value.trim();
        const tailMatches = productCache.suggest(tail, 25);
        const choices = tailMatches.map(({ name }) => {
            const composed = `${prefix}${name}`;
            // Discord caps choice value at 100 chars; truncate if the
            // composed string overflows
            return {
                name: composed.length <= 100 ? composed : `…${name}`.slice(0, 100),
                value: composed.slice(0, 100),
            };
        });
        return interaction.respond(choices);
    }

    // No autocomplete handler registered for this option — return empty so
    // Discord shows "no results" rather than spinning until timeout.
    return interaction.respond([]);
}

// =========================================================================
// Interaction handler — slash commands, buttons, modals, selects
// =========================================================================

client.on('interactionCreate', async (interaction) => {
    // Autocomplete suggestions (typed-as-you-go) — must respond within 3s
    if (interaction.isAutocomplete()) {
        try {
            await routeAutocomplete(interaction);
        } catch (e) {
            console.error('Autocomplete error:', e.message);
            try { await interaction.respond([]); } catch { /* timed out */ }
        }
        return;
    }

    // Slash commands (chat input)
    if (interaction.isChatInputCommand()) {
        const handler = SLASH_HANDLERS[interaction.commandName];
        if (!handler) {
            return interaction.reply({ content: `No handler for /${interaction.commandName}`, ephemeral: true });
        }
        try {
            await handler(interaction);
        } catch (e) {
            console.error(`Error handling /${interaction.commandName}:`, e.message);
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ content: `Failed: ${e.message}`, ephemeral: true });
                } else {
                    await interaction.reply({ content: `Failed: ${e.message}`, ephemeral: true });
                }
            } catch { /* can't reply */ }
        }
        return;
    }

    if (!interaction.isButton() && !interaction.isModalSubmit() && !interaction.isStringSelectMenu()) return;

    try {
        const { handleButtonInteraction, handleModalSubmit, handleSelectMenuInteraction } = await import('./commands/interactions.js');

        if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
        } else if (interaction.isStringSelectMenu()) {
            await handleSelectMenuInteraction(interaction);
        } else if (interaction.isModalSubmit()) {
            await handleModalSubmit(interaction);
        }
    } catch (e) {
        console.error('Error handling interaction:', e.message);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ content: 'Something went wrong. Try again or ping a mod.', ephemeral: true });
            }
        } catch { /* can't reply */ }
    }
});

// =========================================================================
// New Discord member → Activity Feed signal
// =========================================================================
//
// Fires once per join. Skips bot joins (we never want bot-add events
// surfacing on the storefront feed). The broadcast itself is generic —
// no username — so an adversarial join-then-rename can't inject text
// into the public Activity Feed. See lib/activity-broadcaster.js for
// the rationale.
client.on('guildMemberAdd', (member) => {
    if (member.user?.bot) return;
    // Only broadcast joins to the production guild (or whichever guild
    // config.GUILD_ID resolves to in test mode). Avoids cross-guild noise
    // if the bot is ever in multiple servers.
    if (member.guild.id !== config.GUILD_ID) return;
    try {
        broadcastDiscordJoin();
    } catch (e) {
        console.error('Error broadcasting discord join:', e.message);
    }
});

// =========================================================================
// Reaction handler — Minecraft react-for-DM invites
// =========================================================================

client.on('messageReactionAdd', async (reaction, user) => {
    if (user.bot) return;
    if (reaction.partial) {
        try { await reaction.fetch(); } catch { return; }
    }
    if (user.partial) {
        try { await user.fetch(); } catch { return; }
    }

    try {
        await handleMinecraftReaction(reaction, user);
    } catch (e) {
        console.error('Error handling messageReactionAdd:', e.message);
    }
});

// =========================================================================
// Ready
// =========================================================================

client.once('ready', async () => {
    console.log(`Nous online as ${client.user.tag}`);
    console.log(`Guilds: ${client.guilds.cache.map((g) => g.name).join(', ')}`);

    // Start webhook server
    startServer();

    // Sync #bot-commands reference
    await syncBotCommands();

    // Warm the Stripe product cache for autocomplete (non-blocking — if
    // Stripe is unreachable we fall back to empty suggestions, no crash)
    productCache.refresh().catch(() => {});

    // Initialize community goals pinned message
    await initCommunityGoals();

    // Initialize welcome embed in #welcome
    await initWelcome();

    // Initialize the persistent #minecraft react-for-DM embed
    await initMinecraftChannel();

    // Initialize the persistent #looking-for-group overview embed
    await initLfgChannel();

    // Initialize giveaways (close expired, schedule active timers)
    initGiveaways();
});

// =========================================================================
// Error handling
// =========================================================================

client.on('error', (e) => console.error('Discord client error:', e.message));
process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));

// =========================================================================
// Login
// =========================================================================

client.login(config.DISCORD_BOT_TOKEN);
