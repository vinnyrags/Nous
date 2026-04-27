/**
 * Current Pack Battle — push the live pack-battle state to the WordPress
 * shop-settings options page so the itzenzo.tv homepage widget can render
 * "pack battle is live / in progress / nothing right now."
 *
 * Pack battles require a Discord identity (one entry per user), so the
 * website can't direct-buy — buy_url points at the #pack-battles channel
 * where the existing Discord buy button lives.
 */

import config from '../config.js';

const ENDPOINT = `${config.SITE_URL}/wp-json/shop/v1/current-pack-battle`;
const PACK_BATTLES_CHANNEL_ID = config.CHANNELS.PACK_BATTLES;

function packBattlesUrl() {
    return `https://discord.com/channels/${config.GUILD_ID}/${PACK_BATTLES_CHANNEL_ID}`;
}

async function post(body) {
    try {
        const response = await fetch(ENDPOINT, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: config.LIVESTREAM_SECRET, ...body }),
        });

        if (!response.ok) {
            const text = await response.text();
            console.error(`current-pack-battle ${body.status} failed (${response.status}):`, text);
            return null;
        }

        return await response.json();
    } catch (e) {
        console.error('current-pack-battle push errored:', e.message);
        return null;
    }
}

/**
 * Mark a battle as open and shareable on the homepage.
 *
 * @param {object} battle Row from the SQLite battles table after createBattle.
 */
export function setOpen(battle) {
    return post({
        status: 'open',
        battle_id: battle.id,
        stripe_price_id: battle.stripe_price_id ?? '',
        buy_url: packBattlesUrl(),
        max_entries: battle.max_entries ?? 0,
        paid_entries: 0,
    });
}

/**
 * Mark a battle as in-progress (entries closed, packs being opened on stream).
 * The buy link is cleared; only the pack identity and final entry count remain.
 */
export function setInProgress(battle, paidEntriesCount) {
    return post({
        status: 'in_progress',
        battle_id: battle.id,
        stripe_price_id: battle.stripe_price_id ?? '',
        buy_url: '',
        max_entries: battle.max_entries ?? 0,
        paid_entries: paidEntriesCount ?? 0,
    });
}

/** Clear the homepage widget back to its idle state. */
export function clear() {
    return post({ status: 'idle' });
}
