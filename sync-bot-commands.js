/**
 * Sync reference channels with canonical embed content.
 *
 * On startup, syncs #bot-commands and #livestream-flow. Compares existing
 * bot embeds to the defined content, edits changed messages, posts missing
 * ones, and deletes extras. Only touches messages authored by the bot.
 */

import { EmbedBuilder } from 'discord.js';
import { client } from './discord.js';
import config from './config.js';
import commandMessages from './bot-commands.js';
import flowMessages from './livestream-flow.js';

/**
 * Build a Discord EmbedBuilder from a plain object.
 */
function buildEmbed({ title, description, color = 0xceff00, fields = [], footer = null }) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color);
    if (fields.length) embed.addFields(fields);
    if (footer) embed.setFooter({ text: footer });
    return embed;
}

/**
 * Check if an existing message's embed matches the desired content.
 */
function embedMatches(message, desired) {
    const existing = message.embeds?.[0];
    if (!existing) return false;
    return existing.title === desired.title
        && existing.description === desired.description;
}

/**
 * Sync a channel's messages with an array of embed definitions.
 */
async function syncChannel(channelKey, desiredMessages, label) {
    const channel = client.channels.cache.get(config.CHANNELS[channelKey]);
    if (!channel) {
        console.error(`${label} channel not found — skipping sync`);
        return;
    }

    try {
        const fetched = await channel.messages.fetch({ limit: 100 });
        const botMessages = [...fetched.values()]
            .filter((m) => m.author.id === client.user.id)
            .sort((a, b) => a.createdTimestamp - b.createdTimestamp);

        let edited = 0;
        let posted = 0;
        let deleted = 0;

        for (let i = 0; i < desiredMessages.length; i++) {
            const embed = buildEmbed(desiredMessages[i]);

            if (i < botMessages.length) {
                if (!embedMatches(botMessages[i], desiredMessages[i])) {
                    await botMessages[i].edit({ content: '', embeds: [embed] });
                    edited++;
                }
            } else {
                await channel.send({ embeds: [embed] });
                posted++;
            }
        }

        for (let i = desiredMessages.length; i < botMessages.length; i++) {
            await botMessages[i].delete();
            deleted++;
        }

        const changes = edited + posted + deleted;
        if (changes > 0) {
            console.log(`${label} synced: ${edited} edited, ${posted} posted, ${deleted} deleted`);
        } else {
            console.log(`${label} up to date`);
        }
    } catch (e) {
        console.error(`Failed to sync ${label}:`, e.message);
    }
}

async function syncBotCommands() {
    await syncChannel('BOT_COMMANDS', commandMessages, 'Bot commands');
    await syncChannel('LIVESTREAM_FLOW', flowMessages, 'Livestream flow');
}

export { syncBotCommands };
