/**
 * Welcome Channel — a single persistent orientation embed.
 *
 * Auto-posted on bot startup via initWelcome(). No command needed.
 * The message is edited in place on restart — never duplicated.
 *
 * One embed now carries everything: orientation, server rules, the role
 * legend (the former #rules channel, merged 2026-06-28), and a condensed
 * "How Buying Works" guide (the former #how-it-works channel, merged
 * 2026-06-04).
 *
 * Reaction roles also live here (the former #roles + #verify channels,
 * folded in 2026-06-28 — Carl-bot used to own them). Nous posts the
 * reactions on this message and assigns roles directly:
 *   ✅ → Xipe  (verify / unlock the server — grant-only, never revoked)
 *   🟥 → Ena   (18+ / After Dark — a true toggle: react to opt in, unreact to opt out)
 * See REACTION_ROLES + handleWelcomeReaction below.
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { getChannel, getMember, addRole, removeRole } from '../discord.js';

// Reaction → role map for the welcome message. `toggle: false` means the
// role is granted on react but NOT revoked on unreact (verification is
// sticky); `toggle: true` means unreacting removes the role.
const REACTION_ROLES = {
    '✅': { role: 'XIPE', toggle: false },
    '🟥': { role: 'ENA', toggle: true },
};

function buildWelcomeEmbed() {
    return new EmbedBuilder()
        .setTitle('Welcome to itzenzoTTV')
        .setColor(0xceff00)
        .setDescription(
            'Cards. Games. Community. Welcome to the family.\n\n' +
            'Live shows run on **Whatnot** — pack openings, $1-start singles auctions, and vintage hits at ' +
            '[whatnot.com/user/itzenzottv](https://whatnot.com/user/itzenzottv). Going-live links land in <#' + config.CHANNELS.ANNOUNCEMENTS + '>. ' +
            'Between shows, browse the full singles catalog at [itzenzo.tv/cards](https://itzenzo.tv/cards) and the always-on ' +
            '[Whatnot shop](https://whatnot.com/user/itzenzottv/shop). ' +
            'Gaming is informal — we play most days, timing varies; drop into <#' + config.CHANNELS.LOOKING_FOR_GROUP + '> for whatever is running. ' +
            '**After Dark** (18+) is coming soon. Yu-Gi-Oh inventory rolls in as it lands.'
        )
        .addFields(
            {
                name: 'Get Started — react below',
                value: [
                    '✅ React ✅ to **verify** and unlock the full server — grants the **Xipe** role (cards, gaming, community).',
                    '🟥 React 🟥 to grab the **Ena** role — gates **After Dark** (18+) content (coming soon; grab it now to be ready). Unreact any time to drop it.',
                ].join('\n'),
            },
            {
                name: 'Key Channels',
                value: [
                    '<#' + config.CHANNELS.ANNOUNCEMENTS + '> — Whatnot show announcements, drops, news',
                    '<#' + config.CHANNELS.LOOKING_FOR_GROUP + '> — find a squad, see what we\'re playing',
                ].join('\n'),
            },
            {
                name: '📋 Server Rules',
                value: [
                    '1. Be respectful — this is a family. Disagree without being a jerk.',
                    '2. No spam or self-promotion without permission.',
                    '3. Keep content in the right channels.',
                    '4. After Dark channels are 18+ only — react 🟥 above for the **Ena** role.',
                    '5. Have fun. That’s the whole point.',
                ].join('\n'),
            },
            {
                name: 'Roles (Aeon-themed)',
                value: [
                    '🟡 **Akivili** — Server owner',
                    '🔴 **Nanook** — Moderators',
                    '🔵 **Long** — Loyal regulars (awarded by the team)',
                    '🩷 **Aha** — Event winners',
                    '🟢 **Xipe** — Verified community members',
                    '⚪ **Lan** — New members',
                    '🟣 **Yaoshi** — Twitch subscribers',
                    '⬛ **IX** — Archive access',
                    '🟥 **Ena** — 18+ verified (After Dark access)',
                ].join('\n'),
            },
            {
                name: '💳 How Buying Works',
                value: [
                    '**Live shows on Whatnot** — $1-start singles auctions, sealed pack openings, and vintage hits. Going-live links post in <#' + config.CHANNELS.ANNOUNCEMENTS + '> before every show; the [Whatnot shop](https://whatnot.com/user/itzenzottv/shop) stays open between streams.',
                    '',
                    '**The singles catalog** — every raw single is hand-inspected, with condition (NM, LP, MP, HP, DMG) shown on the listing at [itzenzo.tv/cards](https://itzenzo.tv/cards). Not sure about a card? Hit **Request to See** and we\'ll feature it live before you commit. No purchase required.',
                ].join('\n'),
            },
            {
                name: 'Payments, Shipping & Support',
                value: [
                    'Whatnot handles checkout, payment, shipping, and buyer protection on every order — we never see or store your payment details. Everything you win in one show ships together; tracking lands in the Whatnot app and orders go out weekly.',
                    '',
                    'Something wrong? Report through the Whatnot app and DM us — full policy at [itzenzo.tv/how-it-works/refund-policy](https://itzenzo.tv/how-it-works/refund-policy). _Questions? DM the shop owner directly — that always reaches me._',
                ].join('\n'),
            },
        )
        .setFooter({ text: 'itzenzoTTV — Cards. Games. Community.' });
}

/**
 * Ensure the welcome embed exists in #welcome on bot startup, and that the
 * ✅ (verify) and 🟥 (Ena) reactions are present. Edits the existing message
 * if found, posts fresh if missing.
 */
async function initWelcome() {
    try {
        const { welcome } = await import('../db.js');
        const channel = getChannel('WELCOME');
        if (!channel) {
            console.log('Welcome channel not found — skipping initWelcome');
            return;
        }

        const embeds = [buildWelcomeEmbed()];
        const row_config = welcome.getConfig.get();
        let msg = null;

        if (row_config?.channel_message_id) {
            try {
                msg = await channel.messages.fetch(row_config.channel_message_id);
                // components: [] clears the retired "Link Account" button from
                // any existing welcome message on restart.
                await msg.edit({ embeds, components: [] });
                console.log('Welcome embed updated');
            } catch {
                msg = null; // Message was deleted — post fresh below
            }
        }

        if (!msg) {
            msg = await channel.send({ embeds });
            welcome.setMessageId.run(msg.id);
            console.log('Welcome embed posted');
        }

        // Seed the reaction-role emojis (the former #verify + #roles channels,
        // now hosted here). Order: verify first, then Ena.
        for (const emoji of Object.keys(REACTION_ROLES)) {
            if (!msg.reactions.cache.get(emoji)) {
                try { await msg.react(emoji); } catch { /* ok */ }
            }
        }
    } catch (e) {
        console.error('Failed to initialize welcome embed:', e.message);
    }
}

/**
 * Resolve a reaction to its role mapping IFF it's a known reaction-role
 * emoji on the welcome message. Returns null otherwise.
 */
async function resolveWelcomeReaction(reaction) {
    const mapping = REACTION_ROLES[reaction.emoji.name];
    if (!mapping) return null;
    const { welcome } = await import('../db.js');
    const row = welcome.getConfig.get();
    if (!row?.channel_message_id || reaction.message.id !== row.channel_message_id) return null;
    return mapping;
}

/**
 * Grant the mapped role when a member reacts on the welcome message.
 */
async function handleWelcomeReaction(reaction, user) {
    if (user.bot) return;
    const mapping = await resolveWelcomeReaction(reaction);
    if (!mapping) return;
    const member = await getMember(user.id);
    if (member) await addRole(member, config.ROLES[mapping.role]);
}

/**
 * Revoke the mapped role when a member removes their reaction — but only for
 * toggle roles (Ena). Verification (Xipe) is grant-only and never revoked.
 */
async function handleWelcomeReactionRemove(reaction, user) {
    if (user.bot) return;
    const mapping = await resolveWelcomeReaction(reaction);
    if (!mapping || !mapping.toggle) return;
    const member = await getMember(user.id);
    if (member) await removeRole(member, config.ROLES[mapping.role]);
}

export { initWelcome, handleWelcomeReaction, handleWelcomeReactionRemove };
