/**
 * Discord-flow ToS acceptance — the third place CURRENT_VERSION lives.
 *
 *   - Frontend (itzenzo.tv):   src/lib/terms.ts        → TERMS_VERSION
 *   - Backend  (WordPress):    Shop/Support/TouAcceptance.php → CURRENT_VERSION
 *   - Discord  (this module):  CURRENT_VERSION below
 *
 * All three MUST stay in sync at version-bump time. A buyer who agreed
 * to v1.0 has their acceptance recorded against that string; a v1.1
 * bump invalidates that for the gate purpose (next Buy click prompts
 * for re-acceptance) but the historical row stays in the audit trail.
 *
 * One-time-per-version model: hasAccepted(userId) checks for ANY row
 * matching the current version. After a successful click on the
 * "I agree" button, record(userId, source) inserts a row and the
 * next purchase by that user skips the gate entirely — until we bump
 * CURRENT_VERSION.
 *
 * The audit fields returned by metadataFor() get merged into Stripe
 * session.metadata + payment_intent_data.metadata so chargeback
 * defense flows through Stripe's dispute portal without a cross-
 * system lookup.
 */

import { tosAcceptances } from '../db.js';

export const CURRENT_VERSION = '1.3';

/**
 * Has this Discord user accepted the CURRENT version of the terms?
 *
 * @param {string|null|undefined} discordUserId
 * @returns {boolean}
 */
export function hasAccepted(discordUserId) {
    if (!discordUserId) return false;
    return !!tosAcceptances.has.get(discordUserId, CURRENT_VERSION);
}

/**
 * Record an acceptance for this Discord user against the current
 * version. Idempotent at the "does this user have *any* acceptance"
 * level — duplicate calls just add more rows to the audit trail
 * (which is fine; the trail is meant to be append-only).
 *
 * @param {string} discordUserId
 * @param {string} [source='discord_button'] — where the acceptance
 *   came from (currently always the Buy-flow I-agree button, but
 *   future sources like a /tos slash command would label themselves
 *   differently).
 */
export function record(discordUserId, source = 'discord_button') {
    if (!discordUserId) return;
    tosAcceptances.insert.run(discordUserId, CURRENT_VERSION, source);
}

/**
 * Build the Stripe-ready audit metadata for a Discord user's most
 * recent acceptance. Returns an empty object if no acceptance is on
 * file — callers should typically gate on hasAccepted() before
 * reaching this point, so the empty case is a defensive fallback
 * rather than the expected path.
 *
 * The accepted_at value comes from the ORIGINAL acceptance row, not
 * the time of the actual purchase. A buyer who accepted on 2026-05-12
 * and bought on 2026-05-15 has metadata showing the original acceptance
 * timestamp — that's the legally meaningful moment.
 *
 * @param {string|null|undefined} discordUserId
 * @returns {{
 *   terms_version: string,
 *   terms_accepted_at: string,
 *   terms_accepted_source: 'discord',
 *   terms_accepted_discord_user_id: string,
 * } | {}}
 */
export function metadataFor(discordUserId) {
    if (!discordUserId) return {};
    const row = tosAcceptances.getLatest.get(discordUserId);
    if (!row) return {};
    return {
        terms_version: row.terms_version,
        terms_accepted_at: row.accepted_at,
        terms_accepted_source: 'discord',
        terms_accepted_discord_user_id: discordUserId,
    };
}
