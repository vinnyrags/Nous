/**
 * Card Requests — !requests / !request commands
 *
 * Bridges the WordPress wp_card_view_requests table into Discord so
 * the mod team can triage pending requests during card nights without
 * leaving the stream channel.
 *
 * Commands:
 *   !requests              — list up to 10 pending requests (oldest first)
 *   !requests all          — list recent (any status)
 *   !request next          — show the oldest pending request
 *   !request shown <id>    — mark a request shown
 *   !request skip <id>     — mark a request skipped
 */

import config from '../config.js';
import { EmbedBuilder } from 'discord.js';

const WP_REST_BASE = `${config.SITE_URL}/wp-json/shop/v1`;

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        'X-Bot-Secret': config.LIVESTREAM_SECRET || '',
    };
}

async function fetchRequests({ status = 'pending', limit = 10, order = 'oldest' } = {}) {
    const url = new URL(`${WP_REST_BASE}/card-requests`);
    url.searchParams.set('status', status);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('order', order);

    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) {
        throw new Error(`list failed: HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.requests || [];
}

async function updateRequest(id, action) {
    const url = `${WP_REST_BASE}/card-requests/${id}/${action}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: authHeaders(),
    });
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`update failed: HTTP ${res.status} ${body}`);
    }
    return res.json();
}

function requestLine(r) {
    const contact = r.discord_username
        ? `@${r.discord_username.replace(/^@/, '')}`
        : r.email;
    return `**#${r.id}** ${r.card_title || `card ${r.card_id}`} — ${contact}`;
}

/**
 * !requests [all|shown|skipped]
 */
export async function handleRequests(message, args = []) {
    const modeArg = (args[0] || 'pending').toLowerCase();
    const status = ['pending', 'shown', 'skipped', 'all'].includes(modeArg)
        ? modeArg
        : 'pending';

    try {
        const rows = await fetchRequests({ status, limit: 10, order: 'oldest' });
        if (!rows.length) {
            return message.reply(`No ${status === 'all' ? '' : status + ' '}card requests.`);
        }

        const embed = new EmbedBuilder()
            .setTitle(`Card Requests (${status})`)
            .setDescription(rows.map(requestLine).join('\n'))
            .setColor(0xf59e0b)
            .setFooter({
                text:
                    status === 'pending'
                        ? 'Use !request shown <id> or !request skip <id> to triage'
                        : 'Use !request shown <id> / skip <id> / reopen via admin',
            });

        await message.channel.send({ embeds: [embed] });
    } catch (e) {
        console.error('!requests failed:', e.message);
        await message.reply('Could not fetch card requests. Check the bot logs.');
    }
}

/**
 * !request next | shown <id> | skip <id>
 */
export async function handleRequest(message, args = []) {
    const action = (args[0] || '').toLowerCase();

    if (action === 'next') {
        try {
            const [next] = await fetchRequests({ status: 'pending', limit: 1, order: 'oldest' });
            if (!next) {
                return message.reply('No pending card requests.');
            }
            const embed = new EmbedBuilder()
                .setTitle(`Next up — ${next.card_title || `card ${next.card_id}`}`)
                .setDescription(requestLine(next))
                .addFields(
                    { name: 'Email', value: next.email || '—', inline: true },
                    { name: 'Discord', value: next.discord_username || '—', inline: true },
                    { name: 'Requested', value: next.requested_at || '—', inline: true },
                )
                .setColor(0x22c55e)
                .setFooter({
                    text: `Mark shown: !request shown ${next.id}  ·  Skip: !request skip ${next.id}`,
                });

            return message.channel.send({ embeds: [embed] });
        } catch (e) {
            console.error('!request next failed:', e.message);
            return message.reply('Could not fetch next card request.');
        }
    }

    if (action !== 'shown' && action !== 'skip') {
        return message.reply('Usage: `!request next` | `!request shown <id>` | `!request skip <id>`');
    }

    const id = parseInt(args[1] || '', 10);
    if (!id || id < 1) {
        return message.reply(`Usage: \`!request ${action} <id>\``);
    }

    try {
        await updateRequest(id, action);
        await message.reply(`Request #${id} marked as **${action === 'shown' ? 'shown' : 'skipped'}**.`);
    } catch (e) {
        console.error(`!request ${action} ${id} failed:`, e.message);
        await message.reply(`Could not mark request #${id} as ${action}. Check the bot logs.`);
    }
}
