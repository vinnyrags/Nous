/**
 * Express server for webhook endpoints.
 *
 * Routes:
 *   POST /webhooks/twitch             — Twitch EventSub (going live/offline)
 *   POST /webhooks/shippingeasy       — tracking from label purchases
 *   POST /webhooks/queue-changed      — WP queue events → SSE relay
 *   POST /webhooks/activity-changed   — WP activity events → SSE relay
 *   POST /webhooks/card-offer-received — Make-an-Offer submissions
 *   GET  /activity/recent             — Activity-feed backfill
 *   GET  /queue/stream                — SSE live queue
 *   GET  /health                      — Health check
 */

import express from 'express';
import { logger } from './lib/logger.js';
import config from './config.js';
import { activityEvents } from './db.js';
import { handleTwitchWebhook } from './webhooks/twitch.js';
import { handleShippingEasyWebhook } from './webhooks/shippingeasy.js';
import { addClient, broadcast as broadcastQueue, clientCount } from './lib/queue-broadcaster.js';
import { updateQueueChannelEmbed } from './commands/queue.js';
import { updateDuckRaceEmbed } from './lib/duck-race-embed.js';
import { broadcastDuckRaceEntryAdded } from './lib/activity-broadcaster.js';
import { client as discordClient } from './discord.js';

const app = express();


// =========================================================================
// Twitch webhook — needs raw body for signature verification
// =========================================================================

app.post('/webhooks/twitch', express.json({
    verify: (req, res, buf) => { req.rawBody = buf.toString(); },
}), handleTwitchWebhook);

// =========================================================================
// ShippingEasy webhook — tracking info from label purchases
// =========================================================================

app.post('/webhooks/shippingeasy', express.json(), handleShippingEasyWebhook);

// =========================================================================
// Live queue — WP fires `queue.changed` events; we relay them to all
// connected SSE clients (the itzenzo.tv homepage LIVE QUEUE section).
// RTS card-view requests are queue entries (`type=rts`) and arrive on the
// same channel as orders/pack-battles/pull-boxes — no separate webhook.
// =========================================================================

// In-memory per-session roster snapshot. Used to detect when a NEW
// unique buyer joins the duck race roster (count grew) so we can fire
// the activity.duck_race.entry_added envelope exactly once per buyer
// per session. Lost on bot restart — first roster.updated event for a
// session after restart re-seeds the count without firing the envelope
// (treating the entire roster as already-known), so we never spam the
// feed with envelopes for buyers who joined while the bot was down.
const sessionRosterCounts = new Map();

app.post('/webhooks/queue-changed', express.json({ limit: '256kb' }), (req, res) => {
    const providedSecret = req.get('X-Bot-Secret') || '';
    if (!config.LIVESTREAM_SECRET || providedSecret !== config.LIVESTREAM_SECRET) {
        return res.sendStatus(403);
    }

    const { event, data } = req.body || {};
    if (typeof event !== 'string' || !event) {
        return res.sendStatus(400);
    }

    try {
        broadcastQueue(event, data ?? {});

        // Refresh the Discord #queue embed for the affected session. Without
        // this, website-originated entries (RTS submissions, future WP-direct
        // flows) only update the homepage Live Queue via SSE — the Discord
        // embed silently stays stale because nothing on the Discord side
        // observes the WP-level action. Discord-source entries (orders, pull-
        // box buys, battle entries via Stripe webhooks) already refresh the
        // embed in their addToQueue handler, so this is a redundant no-op
        // for those paths; the WP-source case is the load-bearing one.
        const dataObj = data ?? {};
        let sessionId = null;
        if (event.startsWith('entry.') && dataObj.rawEntry && dataObj.rawEntry.sessionId) {
            sessionId = Number(dataObj.rawEntry.sessionId);
        } else if (event === 'roster.updated' && dataObj.sessionId) {
            sessionId = Number(dataObj.sessionId);
        } else if (event.startsWith('session.') && dataObj.session && dataObj.session.id) {
            sessionId = Number(dataObj.session.id);
        }
        if (sessionId) {
            // Fire-and-forget — don't block the webhook response on Discord
            // rate limits or transient failures. The next queue mutation
            // will retry the refresh anyway.
            updateQueueChannelEmbed(sessionId).catch((e) => {
                logger.error(`queue-changed embed refresh failed for session ${sessionId}:`, e.message);
            });
            // Same fire-and-forget for the #duck-race embed. roster.updated
            // events fire it; entry.* and session.* events also fire it
            // (status flips, winner declarations, etc.). updateDuckRaceEmbed
            // silently noops when CHANNELS.DUCK_RACE is unset, so dev
            // environments without the channel configured don't break.
            updateDuckRaceEmbed(sessionId).catch((e) => {
                logger.error(`queue-changed duck-race embed refresh failed for session ${sessionId}:`, e.message);
            });

            // Detect new unique buyer joining the duck race roster and
            // fire the activity.duck_race.entry_added envelope so it
            // shows up in the homepage Activity Feed alongside the
            // raw entry.added event. Only fires on roster.updated (when
            // we have rosterCount + roster); other event kinds skip.
            if (event === 'roster.updated' && typeof dataObj.rosterCount === 'number') {
                const newCount = dataObj.rosterCount;
                const oldCount = sessionRosterCounts.has(sessionId)
                    ? sessionRosterCounts.get(sessionId)
                    : null;
                sessionRosterCounts.set(sessionId, newCount);

                // First event for this session post-restart — seed the
                // count silently. Avoids replaying envelopes for every
                // already-joined buyer when the bot comes back up.
                if (oldCount !== null && newCount > oldCount && Array.isArray(dataObj.roster) && dataObj.roster.length > 0) {
                    // The newest buyer is the LAST entry in the roster
                    // (server returns first-purchase-time ASC). Render
                    // their display key with the same three-shape contract
                    // the queue/duck-race embeds use.
                    const newest = dataObj.roster[dataObj.roster.length - 1];
                    const buyer = String(newest.buyer || '');
                    let label;
                    if (/^\d+$/.test(buyer)) {
                        label = `<@${buyer}>`;
                    } else if (buyer.includes('@')) {
                        label = buyer;
                    } else {
                        label = `@${buyer}`;
                    }
                    broadcastDuckRaceEntryAdded(label, newCount);
                }
            }
        }

        res.sendStatus(200);
    } catch (e) {
        logger.error('queue-changed broadcast failed:', e.message);
        res.sendStatus(500);
    }
});

// =========================================================================
// Activity feed — display-ready event envelopes (pull-box claims, etc.)
// fired from WP. Producers in Nous itself (battles, coupons, pull-box
// lifecycle, low-stock, community goals) call broadcast() directly.
// =========================================================================

app.post('/webhooks/activity-changed', express.json({ limit: '64kb' }), (req, res) => {
    const providedSecret = req.get('X-Bot-Secret') || '';
    if (!config.LIVESTREAM_SECRET || providedSecret !== config.LIVESTREAM_SECRET) {
        return res.sendStatus(403);
    }

    const { event, data } = req.body || {};
    if (typeof event !== 'string' || !event) {
        return res.sendStatus(400);
    }

    try {
        broadcastQueue(event, data ?? {});
        res.sendStatus(200);
    } catch (e) {
        logger.error('activity-changed broadcast failed:', e.message);
        res.sendStatus(500);
    }
});

// =========================================================================
// Card offers — WP fires `card.offer_received` when a buyer submits the
// /collection Make-an-Offer form. We DM the operator (with #ops fallback)
// and broadcast an activity envelope for the homepage feed.
// =========================================================================

app.post('/webhooks/card-offer-received', express.json({ limit: '64kb' }), async (req, res) => {
    const providedSecret = req.get('X-Bot-Secret') || '';
    if (!config.LIVESTREAM_SECRET || providedSecret !== config.LIVESTREAM_SECRET) {
        return res.sendStatus(403);
    }

    const { event, data } = req.body || {};
    if (event !== 'card.offer_received' || !data) {
        return res.sendStatus(400);
    }

    // Ack first, fan out async — same pattern as queue-changed. Discord
    // API can be slow and we don't want to hold the WP socket open.
    res.sendStatus(200);

    try {
        const { handleCardOffer } = await import('./handlers/cardOffer.js');
        await handleCardOffer({ data, client: discordClient });
    } catch (e) {
        logger.error('card-offer dispatch failed:', e.message);
    }
});

// Backfill endpoint for the itzenzo.tv homepage Activity Feed. Returns
// the most-recent `limit` persisted events (default 50, capped at 200)
// in chronological order — most recent FIRST, matching the frontend's
// expected ordering. Public read-only; rate limits handled by the
// frontend's natural cache behavior (only fires on page mount).
//
// Persistence happens in lib/queue-broadcaster.js's broadcast(): every
// event flowing through SSE is also written to the activity_events
// SQLite table. So this endpoint is the canonical answer to "what
// happened that the feed missed because the bot restarted / the buyer
// just opened the page".
app.get('/activity/recent', (req, res) => {
    res.set('Cache-Control', 'no-store');
    const requested = parseInt(String(req.query.limit ?? ''), 10);
    const limit = Number.isFinite(requested) && requested > 0
        ? Math.min(requested, 200)
        : 50;
    try {
        const rows = activityEvents.recent.all(limit);
        const events = rows.map((row) => {
            let data = {};
            try { data = JSON.parse(row.data || '{}'); } catch { /* fall through to empty */ }
            return { id: row.id, event: row.event, data, createdAt: row.created_at };
        });
        res.json({ events });
    } catch (e) {
        logger.error('activity/recent query failed:', e.message);
        res.status(500).json({ error: 'activity feed unavailable' });
    }
});

app.get('/queue/stream', (req, res) => {
    res.set({
        'Content-Type':      'text/event-stream',
        'Cache-Control':     'no-cache, no-transform',
        Connection:          'keep-alive',
        'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n');

    const lastEventId = req.get('Last-Event-ID') || req.query.lastEventId || null;
    const cleanup = addClient(res, lastEventId);

    req.on('close', () => {
        cleanup();
        try { res.end(); } catch { /* already ended */ }
    });
});

app.get('/queue/stream/stats', (req, res) => {
    res.json({ connectedClients: clientCount() });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
});


/**
 * Start the Express server.
 *
 * Binds to 127.0.0.1 so the bot is only reachable through nginx on the
 * production host (nginx proxies /bot/ → http://127.0.0.1:3100/). External
 * traffic must hit nginx, which terminates TLS and applies any host-level
 * rate limiting before reaching the bot. Override via BOT_BIND_HOST=0.0.0.0
 * if a deployment needs the bot exposed directly on all interfaces.
 */
function startServer() {
    const host = config.BOT_BIND_HOST;
    // Return the http.Server so the caller (index.js) can close() it during
    // graceful shutdown and stop accepting new connections before exit.
    return app.listen(config.PORT, host, () => {
        logger.info(`Webhook server listening on ${host}:${config.PORT}`);
    });
}

export { app, startServer };
