/**
 * Analytics Snapshot Command
 *
 * !snapshot           — Current month
 * !snapshot march     — Specific month (current year)
 * !snapshot 2026      — Full year
 * !snapshot march 2026 — Specific month + year
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { analytics, goals } from '../db.js';
import { sendToChannel } from '../discord.js';

const MONTHS = {
    january: 0, jan: 0,
    february: 1, feb: 1,
    march: 2, mar: 2,
    april: 3, apr: 3,
    may: 4,
    june: 5, jun: 5,
    july: 6, jul: 6,
    august: 7, aug: 7,
    september: 8, sep: 8, sept: 8,
    october: 9, oct: 9,
    november: 10, nov: 10,
    december: 11, dec: 11,
};

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Parse args into a date range { start, end, label }.
 */
function parseDateRange(args) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    if (args.length === 0) {
        // Default: current month
        const start = new Date(currentYear, currentMonth, 1);
        const end = new Date(currentYear, currentMonth + 1, 1);
        return { start, end, label: `${MONTH_NAMES[currentMonth]} ${currentYear}` };
    }

    const first = args[0].toLowerCase();
    const second = args[1];

    // Check if first arg is a year (4-digit number)
    if (/^\d{4}$/.test(first)) {
        const year = parseInt(first, 10);
        const start = new Date(year, 0, 1);
        const end = new Date(year + 1, 0, 1);
        return { start, end, label: `${year}` };
    }

    // Check if first arg is a month name
    const monthIndex = MONTHS[first];
    if (monthIndex !== undefined) {
        const year = second && /^\d{4}$/.test(second) ? parseInt(second, 10) : currentYear;
        const start = new Date(year, monthIndex, 1);
        const end = new Date(year, monthIndex + 1, 1);
        return { start, end, label: `${MONTH_NAMES[monthIndex]} ${year}` };
    }

    return null;
}

function formatDollars(cents) {
    return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function handleSnapshot(message, args) {
    // Akivili only
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the owner can use this command.');
    }

    const range = parseDateRange(args);
    if (!range) {
        return message.reply('Usage: `!snapshot`, `!snapshot march`, `!snapshot 2026`, `!snapshot march 2026`');
    }

    const startStr = range.start.toISOString();
    const endStr = range.end.toISOString();

    // Query all stats
    const stats = analytics.getRangeStats.get(startStr, endStr);
    const topProducts = analytics.getTopProducts.all(startStr, endStr);
    const streamCount = analytics.getStreamCount.get(startStr, endStr);
    const newBuyers = analytics.getNewBuyerCount.get(startStr, endStr, startStr);
    const battleCount = analytics.getBattleCount.get(startStr, endStr);
    const goal = goals.get.get();

    const returningBuyers = stats.unique_buyers - newBuyers.count;
    const avgPerStream = streamCount.count > 0
        ? formatDollars(Math.round(stats.total_revenue / streamCount.count))
        : 'N/A';

    // Build embed
    const lines = [
        `**Revenue:** ${formatDollars(stats.total_revenue)}`,
        `**Orders:** ${stats.order_count}`,
        `**Buyers:** ${stats.unique_buyers} (${newBuyers.count} new, ${returningBuyers} returning)`,
        `**Streams:** ${streamCount.count}`,
        `**Avg per stream:** ${avgPerStream}`,
        `**Battles:** ${battleCount.count}`,
    ];

    const embed = new EmbedBuilder()
        .setTitle(`📊 Snapshot — ${range.label}`)
        .setDescription(lines.join('\n'))
        .setColor(0xceff00);

    // Top products field
    if (topProducts.length > 0) {
        const productLines = topProducts.map((p, i) =>
            `${i + 1}. **${p.product_name}** — ${p.count} sold (${formatDollars(p.revenue)})`
        );
        embed.addFields({ name: 'Top Products', value: productLines.join('\n') });
    }

    // Community goal state
    const cyclePercent = Math.min(Math.round((goal.cycle_revenue / 250000) * 100), 100);
    const goalLines = [
        `Cycle #${goal.cycle} — ${cyclePercent}% (${formatDollars(goal.cycle_revenue)} / $2,500.00)`,
        `Lifetime: ${formatDollars(goal.lifetime_revenue)}`,
    ];
    embed.addFields({ name: 'Community Goal', value: goalLines.join('\n') });

    embed.setFooter({ text: `Generated ${new Date().toLocaleDateString('en-US')}` });

    // Post to #analytics
    await sendToChannel('ANALYTICS', { embeds: [embed] });

    // Confirm in current channel
    await message.channel.send(`📊 Snapshot posted to <#${config.CHANNELS.ANALYTICS}>`);
}

export { handleSnapshot };
