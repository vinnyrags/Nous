/**
 * Wheel Spinner
 *
 * Commands:
 *   !spin giveaway                — Spin giveaway entries, animated draw (mods)
 *   !spin giveaway pick @user     — Pre-select giveaway winner (owner only)
 *   !spin @user1 @user2 @user3    — Ad-hoc spin with mentioned users (mods)
 *   !spin "A" "B" "C"             — Ad-hoc spin with text entries (mods)
 *   !spin pick <winner> <entries>  — Pre-select ad-hoc winner (owner only)
 *
 * Animated embed that cycles through entries, decelerates, and lands on a winner.
 * Giveaway mode handles post-draw actions (Aha role, announcements, embed updates).
 * Ad-hoc mode is fire-and-forget — no state changes.
 */

import { EmbedBuilder } from 'discord.js';
import config from '../config.js';
import { db, giveaways } from '../db.js';
import { client, sendEmbed, getMember, addRole } from '../discord.js';
import { updateGiveawayEmbed, giveawayChannel, announcementChannel } from './giveaway.js';

let spinInProgress = false;

// =========================================================================
// Command router
// =========================================================================

async function handleSpin(message, args) {
    const isAdmin = message.member.roles.cache.has(config.ROLES.NANOOK)
        || message.member.roles.cache.has(config.ROLES.AKIVILI);
    const isOwner = message.member.roles.cache.has(config.ROLES.AKIVILI);

    if (!isAdmin) return message.reply('Only moderators can use the spinner.');

    const first = args[0]?.toLowerCase();

    if (first === 'giveaway') {
        const isPick = args[1]?.toLowerCase() === 'pick';
        if (isPick && !isOwner) return message.reply('Only the owner can pre-select.');
        if (isPick) {
            const pickUser = message.mentions.users.first();
            if (!pickUser) return message.reply('Usage: `!spin giveaway pick @user`');
            try { await message.delete(); } catch { /* may lack perms */ }
            return spinGiveaway(message, pickUser.id);
        }
        return spinGiveaway(message, null);
    }

    if (first === 'pick') {
        if (!isOwner) return message.reply('Only the owner can pre-select.');
        try { await message.delete(); } catch { /* may lack perms */ }
        return spinAdHoc(message, args.slice(1), true);
    }

    // Ad-hoc: !spin @user1 @user2 OR !spin "Prize1" "Prize2"
    return spinAdHoc(message, args, false);
}

// =========================================================================
// Giveaway spin
// =========================================================================

async function spinGiveaway(message, pickedWinnerId) {
    if (spinInProgress) {
        return message.channel.send('A spin is already in progress!');
    }

    const active = giveaways.getActive.get();
    if (active) {
        return message.channel.send('Giveaway is still open. Run `!giveaway close` first.');
    }

    const giveaway = db.prepare(
        `SELECT * FROM giveaways WHERE status = 'closed' ORDER BY closed_at DESC LIMIT 1`
    ).get();

    if (!giveaway) {
        return message.channel.send('No closed giveaway to spin.');
    }

    const dbEntries = giveaways.getEntries.all(giveaway.id);
    if (dbEntries.length < 2) {
        return message.channel.send('Need at least 2 entries to spin!');
    }

    const entries = dbEntries.map((e) => {
        const tiktok = e.tiktok_username ? ` (@${e.tiktok_username})` : '';
        return { id: e.discord_user_id, label: `<@${e.discord_user_id}>${tiktok}` };
    });

    // Validate pick
    if (pickedWinnerId) {
        const inEntries = entries.some((e) => e.id === pickedWinnerId);
        if (!inEntries) {
            return message.channel.send(`<@${pickedWinnerId}> is not in the giveaway entries.`);
        }
        await message.channel.send(`\uD83C\uDFA1 Spin picked. Starting...`);
    }

    const winnerId = pickedWinnerId
        || entries[Math.floor(Math.random() * entries.length)].id;

    spinInProgress = true;

    try {
        const title = `Giveaway \u2014 ${giveaway.prize_name}`;
        await runSpinAnimation(message.channel, entries, winnerId, title, true);
        await finalizeGiveaway(giveaway, winnerId, message);
    } finally {
        spinInProgress = false;
    }
}

async function finalizeGiveaway(giveaway, winnerId, message) {
    giveaways.setWinner.run(winnerId, giveaway.id);

    const member = await getMember(winnerId);
    if (member) {
        await addRole(member, config.ROLES.AHA);
    }

    await updateGiveawayEmbed(giveaway);

    const entry = giveaways.getEntries.all(giveaway.id).find((e) => e.discord_user_id === winnerId);
    const tiktokNote = entry?.tiktok_username ? ` (TikTok: @${entry.tiktok_username})` : '';

    await sendEmbed(giveawayChannel(), {
        title: `\uD83C\uDFC6 Giveaway Winner \u2014 ${giveaway.prize_name}`,
        description: `Congratulations <@${winnerId}>!${tiktokNote} \uD83C\uDF89\n\nYou've won **${giveaway.prize_name}**!`,
        color: 0xffd700,
    });

    await sendEmbed(announcementChannel(), {
        title: `\uD83C\uDFC6 Giveaway Winner \u2014 ${giveaway.prize_name}`,
        description: `<@${winnerId}> just won **${giveaway.prize_name}**! \uD83C\uDF89`,
        color: 0xffd700,
    });

    await message.channel.send(
        `\uD83C\uDFC6 **<@${winnerId}>${tiktokNote} wins ${giveaway.prize_name}!**\n` +
        `\u2022 Aha role assigned\n` +
        `\u2022 Announced in ${giveawayChannel() === 'OPS' ? '#ops' : '#giveaways and #announcements'}`
    );
}

// =========================================================================
// Ad-hoc spin
// =========================================================================

async function spinAdHoc(message, args, isPick) {
    if (spinInProgress) {
        return message.channel.send('A spin is already in progress!');
    }

    const entries = parseEntries(args, message);
    if (!entries || entries.length < 2) {
        return message.channel.send(
            'Need at least 2 entries.\n' +
            'Usage: `!spin @user1 @user2 @user3` or `!spin "Prize 1" "Prize 2" "Prize 3"`'
        );
    }

    let winnerId;

    if (isPick) {
        // First entry in the parsed list is the pick target
        const pickTarget = entries[0];
        winnerId = pickTarget.id;
        await message.channel.send(`\uD83C\uDFA1 Spin picked. Starting...`);
    } else {
        winnerId = entries[Math.floor(Math.random() * entries.length)].id;
    }

    spinInProgress = true;

    try {
        await runSpinAnimation(message.channel, entries, winnerId, 'Wheel Spin');

        const winner = entries.find((e) => e.id === winnerId);
        await message.channel.send(`\uD83C\uDFC6 **${winner.label}** wins!`);
    } finally {
        spinInProgress = false;
    }
}

function parseEntries(args, message) {
    // If mentions exist, use those
    const mentions = message.mentions.users;
    if (mentions.size >= 2) {
        return [...mentions.values()].map((u) => ({ id: u.id, label: `<@${u.id}>` }));
    }

    // Parse quoted strings: "Prize 1" "Prize 2" "Prize 3"
    const raw = args.join(' ');
    const quoted = raw.match(/"([^"]+)"/g);
    if (quoted && quoted.length >= 2) {
        return quoted.map((q) => {
            const text = q.replace(/"/g, '');
            return { id: text, label: text };
        });
    }

    // Fallback: comma-separated
    const csv = raw.split(',').map((s) => s.trim()).filter(Boolean);
    if (csv.length >= 2) {
        return csv.map((text) => ({ id: text, label: text }));
    }

    return null;
}

// =========================================================================
// Animation engine
// =========================================================================

/**
 * Run the spin animation.
 * @param {object}  channel   - Discord channel to post in
 * @param {Array}   entries   - Array of { id, label }
 * @param {string}  winnerId  - The winner's id
 * @param {string}  title     - Embed title context
 * @param {boolean} extended  - If true, run ~30 sec (giveaways). Default ~10 sec (ad-hoc).
 */
async function runSpinAnimation(channel, entries, winnerId, title, extended = false) {
    const winnerIndex = entries.findIndex((e) => e.id === winnerId);
    const frameCount = extended ? 20 : 10;
    const frames = generateSpinFrames(entries.length, winnerIndex, frameCount);
    const totalFrames = frames.length;

    // Post initial "spinning" embed
    const initialEmbed = buildSpinEmbed(title, entries, frames[0], false);
    const spinMsg = await channel.send({ embeds: [initialEmbed] });

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (let i = 1; i < totalFrames; i++) {
        await delay(getFrameDelay(i, totalFrames));
        const isLast = i === totalFrames - 1;
        const embed = buildSpinEmbed(title, entries, frames[i], isLast);
        await spinMsg.edit({ embeds: [embed] });
    }
}

function generateSpinFrames(entryCount, winnerIndex, totalFrames) {
    const frames = [];

    for (let i = 0; i < totalFrames; i++) {
        if (i === totalFrames - 1) {
            // Final frame: land on winner
            frames.push(winnerIndex);
        } else if (i >= totalFrames - 4) {
            // Last few frames: close neighbors of winner (deceleration)
            const offset = (totalFrames - 1 - i) * Math.ceil(entryCount / 20);
            const nearby = ((winnerIndex - offset) % entryCount + entryCount) % entryCount;
            frames.push(nearby);
        } else {
            // Early/mid frames: random positions (fast wheel blur)
            frames.push(Math.floor(Math.random() * entryCount));
        }
    }

    return frames;
}

/**
 * Frame delay in ms. Starts fast, decelerates toward the end.
 * Extended mode (20 frames): ~30 sec total.
 * Standard mode (10 frames): ~10 sec total.
 */
function getFrameDelay(frameIndex, totalFrames) {
    const progress = frameIndex / (totalFrames - 1); // 0.0 → 1.0
    if (progress < 0.4) return 500;        // fast blur
    if (progress < 0.6) return 1000;       // slowing
    if (progress < 0.8) return 2000;       // nearly there
    if (progress < 0.95) return 3000;      // suspense
    return 3500;                           // final landing
}

/**
 * Build a spin embed showing a window of entries around the highlighted position.
 * For large entry lists (>9), shows a slot-machine style 9-entry window.
 * For small lists (<=9), shows all entries.
 */
function buildSpinEmbed(title, entries, highlightIndex, isFinished) {
    const totalEntries = entries.length;
    const windowSize = Math.min(9, totalEntries);
    const half = Math.floor(windowSize / 2);

    const lines = [];

    if (totalEntries <= 9) {
        // Small list: show all entries
        for (let i = 0; i < totalEntries; i++) {
            lines.push(formatSpinLine(entries[i], i, highlightIndex, isFinished));
        }
    } else {
        // Large list: show window around highlight
        for (let offset = -half; offset <= half; offset++) {
            const idx = ((highlightIndex + offset) % totalEntries + totalEntries) % totalEntries;
            lines.push(formatSpinLine(entries[idx], idx, highlightIndex, isFinished));
        }
    }

    const header = totalEntries > 9
        ? `*${totalEntries.toLocaleString()} entries*\n`
        : '';

    const winnerLabel = entries[highlightIndex].label;

    return new EmbedBuilder()
        .setTitle(`\uD83C\uDFA1 ${title}${isFinished ? ' \u2014 Winner!' : ''}`)
        .setDescription(header + lines.join('\n'))
        .setColor(isFinished ? 0xffd700 : 0xceff00)
        .setFooter({ text: isFinished
            ? `Winner: ${winnerLabel}`
            : 'Spinning...' });
}

function formatSpinLine(entry, entryIndex, highlightIndex, isFinished) {
    if (isFinished && entryIndex === highlightIndex) {
        return `\uD83C\uDFC6 **${entry.label}**  \u25C0 WINNER`;
    }
    if (entryIndex === highlightIndex) {
        return `\uD83D\uDC49 **${entry.label}**  \u25C0`;
    }
    return `\u2003\u2003 ${entry.label}`;
}

export { handleSpin };
