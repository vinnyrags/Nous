/**
 * WordPress pull-box API client.
 *
 * Mirrors the queue cutover pattern: WordPress is the source of truth
 * for pull-box state (one box per tier, finite slots, atomic claims),
 * Nous reads/writes via REST, the Discord !pull command and the
 * itzenzo.tv homepage modal both project from the same data.
 *
 * Unlike lib/wp-queue.js, no SQLite fallback — pull-box state is
 * ephemeral (one box at a time, opened by !pull, closed by !pull close)
 * so there's nothing to migrate or roll back to.
 */

import config from '../config.js';

const BASE = `${config.SITE_URL}/wp-json/shop/v1`;

async function botFetch(path, init = {}) {
    const url = `${BASE}${path}`;
    const headers = {
        'Content-Type': 'application/json',
        'X-Bot-Secret': config.LIVESTREAM_SECRET,
        ...(init.headers || {}),
    };

    let response;
    try {
        response = await fetch(url, { ...init, headers });
    } catch (e) {
        console.error(`wp-pull-box ${init.method || 'GET'} ${path} network error:`, e.message);
        throw e;
    }

    if (!response.ok) {
        const text = await response.text();
        const error = new Error(`wp-pull-box ${init.method || 'GET'} ${path} → ${response.status}: ${text.slice(0, 200)}`);
        error.status = response.status;
        error.body = text;
        try { error.bodyJson = JSON.parse(text); } catch { /* not JSON */ }
        throw error;
    }

    if (response.status === 204) return null;
    return await response.json();
}

/**
 * The currently-open pull box for a tier, or null. Includes claimed
 * slot numbers + buyer display labels so the on-stream embed can
 * render the grid without a second round-trip.
 */
export async function getActiveBox(tier) {
    const data = await botFetch(`/pull-boxes/active?tier=${encodeURIComponent(tier)}`);
    return data?.box || null;
}

/**
 * Open a new pull box for a tier. Throws if a box is already open
 * for the same tier (409 from WP).
 */
export async function createBox({ name, tier, priceCents, totalSlots, stripePriceId = null, discordMessageId = null }) {
    const data = await botFetch('/pull-boxes', {
        method: 'POST',
        body: JSON.stringify({
            name,
            tier,
            price_cents: priceCents,
            total_slots: totalSlots,
            stripe_price_id: stripePriceId,
            discord_message_id: discordMessageId,
        }),
    });
    return data?.box || null;
}

export async function updateBox(boxId, { status, totalSlots, discordMessageId } = {}) {
    const payload = {};
    if (status !== undefined) payload.status = status;
    if (totalSlots !== undefined) payload.total_slots = totalSlots;
    if (discordMessageId !== undefined) payload.discord_message_id = discordMessageId;
    const data = await botFetch(`/pull-boxes/${encodeURIComponent(boxId)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
    });
    return data?.box || null;
}

export async function closeBox(boxId) {
    return updateBox(boxId, { status: 'closed' });
}

export async function replenishBox(boxId, newTotalSlots) {
    return updateBox(boxId, { totalSlots: newTotalSlots });
}

/**
 * Atomically claim a list of slot numbers. Throws on conflict (409)
 * with the latest claimed-slots list attached on `error.bodyJson.data`.
 */
export async function claimSlots(boxId, slots, { discordUserId = null, discordHandle = null, customerEmail = null, stripeSessionId = null } = {}) {
    const data = await botFetch(`/pull-boxes/${encodeURIComponent(boxId)}/claim`, {
        method: 'POST',
        body: JSON.stringify({
            slots,
            discord_user_id: discordUserId,
            discord_handle: discordHandle,
            customer_email: customerEmail,
            stripe_session_id: stripeSessionId,
        }),
    });
    return data;
}
