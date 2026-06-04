/**
 * Welcome Channel — persistent embed with Link Account button.
 *
 * Auto-posted on bot startup via initWelcome(). No command needed.
 * The embed is edited in place on restart — never duplicated.
 */

import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
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
                    '<#' + config.CHANNELS.HOW_IT_WORKS + '> — How buying, shipping, and refunds work',
                    '<#' + config.CHANNELS.LOOKING_FOR_GROUP + '> — Find a squad, see what we\'re playing',
                ].join('\n'),
            },
            {
                name: 'Link Your Account',
                value:
                    'Bought from the shop before? Click the **Link Account** button below and enter the email you used at checkout. ' +
                    'This connects your purchase history to your Discord profile and unlocks automatic role upgrades as you hit purchase milestones.',
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

function buildWelcomeButton() {
    const button = new ButtonBuilder()
        .setCustomId('welcome-link')
        .setLabel('Link Account')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔗');

    return new ActionRowBuilder().addComponents(button);
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

        const embed = buildWelcomeEmbed();
        const row = buildWelcomeButton();
        const row_config = welcome.getConfig.get();

        if (row_config?.channel_message_id) {
            try {
                const msg = await channel.messages.fetch(row_config.channel_message_id);
                await msg.edit({ embeds: [embed], components: [row] });
                console.log('Welcome embed updated');
                return;
            } catch {
                // Message was deleted — post fresh below
            }
        }

        const msg = await channel.send({ embeds: [embed], components: [row] });
        welcome.setMessageId.run(msg.id);
        console.log('Welcome embed posted');
    } catch (e) {
        console.error('Failed to initialize welcome embed:', e.message);
    }
}

export { initWelcome };
