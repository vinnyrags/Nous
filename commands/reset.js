/**
 * Reset Command — !reset
 *
 * Testing-only command. Wipes all bot data (purchases, shipping, battles,
 * queues, card listings, etc.), resets community goals, then runs
 * !sync to restore stock from Google Sheets → Stripe → WordPress.
 *
 * Akivili only. Requires confirmation before executing.
 */

import { EmbedBuilder } from 'discord.js';
import { db } from '../db.js';
import config from '../config.js';
import { handleSync } from './sync.js';
import { initCommunityGoals } from '../community-goals.js';

// Order matters — child tables before parents (foreign key constraints)
const TABLES_TO_CLEAR = [
    'queue_entries',
    'queues',
    'battle_entries',
    'battles',
    'duck_race_entries',
    'giveaway_entries',
    'giveaways',
    'pull_entries',
    'card_listings',
    'livestream_buyers',
    'livestream_sessions',
    'purchases',
    'purchase_counts',
    'discord_links',
    'shipping_payments',
    'active_coupons',
];

async function handleReset(message) {
    // Akivili only
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the owner can reset the system.');
    }

    // Require confirmation
    await message.channel.send({ embeds: [new EmbedBuilder()
        .setTitle('⚠️ System Reset')
        .setDescription(
            'This will wipe **ALL data** — purchases, shipping, battles, queues, card listings, giveaways, discord links, and community goals.\n\n' +
            'Stock will be restored via `!sync` (Sheets → Stripe → WordPress).\n\n' +
            '✅ React to confirm, or type `cancel` to abort.'
        )
        .setColor(0xe74c3c)] });

    const confirmMsg = message.channel.lastMessage;
    try { await confirmMsg.react('✅'); } catch { /* can't react */ }

    const confirmed = await Promise.race([
        confirmMsg.awaitReactions({
            filter: (r, u) => r.emoji.name === '✅' && u.id === message.author.id,
            max: 1,
            time: 30_000,
        }).then((collected) => collected.size > 0),
        new Promise((resolve) => {
            const collector = message.channel.createMessageCollector({
                filter: (m) => m.author.id === message.author.id && m.content.toLowerCase() === 'cancel',
                max: 1,
                time: 30_000,
            });
            collector.on('collect', () => resolve(false));
            collector.on('end', (_, reason) => { if (reason === 'time') resolve(false); });
        }),
    ]);

    if (!confirmed) {
        return message.channel.send({ embeds: [new EmbedBuilder()
            .setDescription('❌ Reset cancelled.')
            .setColor(0xe74c3c)] });
    }

    // Step 1: Clear all tables
    await message.channel.send({ embeds: [new EmbedBuilder()
        .setDescription('🗑️ Clearing all tables...')
        .setColor(0xf39c12)] });

    const cleared = [];
    for (const table of TABLES_TO_CLEAR) {
        try {
            const result = db.prepare(`DELETE FROM ${table}`).run();
            if (result.changes > 0) {
                cleared.push(`${table}: ${result.changes} rows`);
            }
        } catch (e) {
            console.error(`Failed to clear ${table}:`, e.message);
        }
    }

    // Reset community goals to defaults
    db.prepare('UPDATE community_goals SET cycle = 1, cycle_revenue = 0, lifetime_revenue = 0 WHERE id = 1').run();

    // Reset autoincrement counters
    try {
        db.prepare('DELETE FROM sqlite_sequence').run();
        console.log('Autoincrement counters reset');
    } catch (e) {
        console.log('sqlite_sequence reset skipped:', e.message);
    }

    const summary = cleared.length
        ? `Cleared: ${cleared.join(', ')}`
        : 'All tables were already empty';

    // Refresh the #restock-tracker pinned message
    await initCommunityGoals();

    await message.channel.send({ embeds: [new EmbedBuilder()
        .setTitle('✅ Database Wiped')
        .setDescription(`${summary}\n\nCommunity goals reset to cycle 1, $0. Restock tracker updated.`)
        .setColor(0xceff00)] });

    // Step 2: Sync products to restore stock
    await message.channel.send({ embeds: [new EmbedBuilder()
        .setDescription('🔄 **Restoring stock via !sync...**')
        .setColor(0x3498db)] });
    await handleSync(message, []);
}

export { handleReset };
