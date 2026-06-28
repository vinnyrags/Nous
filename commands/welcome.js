/**
 * Welcome Channel — persistent embeds with Link Account button.
 *
 * Auto-posted on bot startup via initWelcome(). No command needed.
 * The message is edited in place on restart — never duplicated.
 *
 * Carries two embeds: the welcome/orientation embed and a condensed
 * "How Buying Works" embed (the former #how-it-works channel content,
 * merged here 2026-06-04 when that channel was archived).
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { client, getChannel } from '../discord.js';

function buildWelcomeEmbed() {
    return new EmbedBuilder()
        .setTitle('Welcome to itzenzoTTV')
        .setDescription(
            'Cards. Games. Community. Welcome to the family.\n\n' +
            'Live shows run on **Whatnot** — pack openings, $1-start singles auctions, and vintage hits at ' +
            '[whatnot.com/user/itzenzottv](https://whatnot.com/user/itzenzottv). Going-live links land in the announcements channel. ' +
            'Between shows, browse the full singles catalog at [itzenzo.tv/cards](https://itzenzo.tv/cards) and the always-on ' +
            '[Whatnot shop](https://whatnot.com/user/itzenzottv/shop). ' +
            'Gaming is informal — we play most days, timing varies, drop into the looking-for-group channel for whatever is running. ' +
            '**After Dark** (18+) is coming soon. Yu-Gi-Oh inventory rolls in as it lands.'
        )
        .setColor(0xceff00)
        .addFields(
            {
                name: 'Key Channels',
                value: [
                    '<#' + config.CHANNELS.ANNOUNCEMENTS + '> — Whatnot show announcements, drops, news',
                    '<#' + config.CHANNELS.LOOKING_FOR_GROUP + '> — Find a squad, see what we\'re playing',
                ].join('\n'),
            },
            {
                name: 'Get Verified',
                value:
                    'Head to <#1488183429437853696> and react to get the **Xipe** role. ' +
                    'This unlocks full server access — cards, gaming, and community channels. ' +
                    'Once verified, check out <#1488041097153347704> to pick up additional roles. The **Ena** role gates After Dark content (coming soon — grab the role now to be ready when it launches).',
            },
            {
                name: 'Role Progression',
                value:
                    '**Xipe** — Verified member\n' +
                    '**Long** — 5+ purchases (loyalty recognized)',
            },
        )
        .setFooter({ text: 'itzenzoTTV — Cards. Games. Community.' });
}

/**
 * Condensed "How Buying Works" — the former #how-it-works channel content,
 * folded into the welcome message as a second embed.
 */
function buildHowItWorksEmbed() {
    return new EmbedBuilder()
        .setTitle('💳 How Buying Works')
        .setDescription([
            '**Live shows on Whatnot**',
            '$1-start singles auctions, sealed pack openings, and vintage hits at [whatnot.com/user/itzenzottv](https://whatnot.com/user/itzenzottv). Going-live links post in <#' + config.CHANNELS.ANNOUNCEMENTS + '> before every show — follow us on Whatnot and the app notifies you too. Between shows, the [Whatnot shop](https://whatnot.com/user/itzenzottv/shop) stays open with Buy-it-Now product.',
            '',
            '**The singles catalog**',
            'Every raw single is hand-inspected, with condition (NM, LP, MP, HP, DMG) shown right on the listing at [itzenzo.tv/cards](https://itzenzo.tv/cards). Not sure about a card? Hit **Request to See** and we\'ll feature it on the next show — edges, surface, and centering in real time before you commit. No purchase required.',
            '',
            '**Payments, shipping, and buyer protection**',
            'Whatnot handles checkout, payment, shipping, and buyer protection on every order — we never see or store your payment details. Shipping is calculated at checkout and everything you win in the same show ships together; tracking lands in the Whatnot app. Orders go out weekly.',
            '',
            '**If something\'s wrong, we\'ll make it right**',
            'Whatnot orders are covered by Whatnot buyer protection — report through the app and DM us so it gets resolved fast. Full policy: [itzenzo.tv/how-it-works/refund-policy](https://itzenzo.tv/how-it-works/refund-policy)',
            '',
            '_Questions? DM the shop owner directly — that always reaches me._',
        ].join('\n'))
        .setColor(0xceff00);
}

/**
 * Ensure the welcome embed exists in #welcome on bot startup.
 * Edits the existing message if found, posts fresh if missing.
 */
async function initWelcome() {
    try {
        const { welcome } = await import('../db.js');
        const channel = getChannel('WELCOME');
        if (!channel) {
            console.log('Welcome channel not found — skipping initWelcome');
            return;
        }

        const embeds = [buildWelcomeEmbed(), buildHowItWorksEmbed()];
        const row_config = welcome.getConfig.get();

        if (row_config?.channel_message_id) {
            try {
                const msg = await channel.messages.fetch(row_config.channel_message_id);
                // components: [] clears the retired "Link Account" button from
                // any existing welcome message on restart.
                await msg.edit({ embeds, components: [] });
                console.log('Welcome embed updated');
                return;
            } catch {
                // Message was deleted — post fresh below
            }
        }

        const msg = await channel.send({ embeds });
        welcome.setMessageId.run(msg.id);
        console.log('Welcome embed posted');
    } catch (e) {
        console.error('Failed to initialize welcome embed:', e.message);
    }
}

export { initWelcome };
