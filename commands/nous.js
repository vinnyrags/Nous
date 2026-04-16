/**
 * Nous Message Command — !nous #channel message
 *
 * Owner-only. Posts a message as Nous in the specified channel.
 * Deletes the command message so it looks like Nous spoke on its own.
 *
 * Usage:
 *   !nous #channel Hello everyone!
 *   !nous #announcements 🎉 Big news coming tomorrow.
 */

import config from '../config.js';

async function handleNous(message, args) {
    // Owner-only
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the server owner can speak as Nous.');
    }

    const channel = message.mentions.channels.first();
    if (!channel) {
        return message.reply('Usage: `!nous #channel Your message here`');
    }

    // Everything after the channel mention is the message
    const text = args
        .filter((a) => !a.match(/^<#\d+>$/))
        .join(' ')
        .trim();

    if (!text) {
        return message.reply('Usage: `!nous #channel Your message here`');
    }

    try {
        await channel.send(text);

        // Delete the command message so it looks organic
        try { await message.delete(); } catch { /* missing permissions */ }
    } catch (e) {
        console.error('Nous message error:', e.message);
        return message.reply(`Could not send to ${channel}: ${e.message}`);
    }
}

export { handleNous };
