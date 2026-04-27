#!/usr/bin/env node
/**
 * One-shot migration: copy recent SQLite queues/entries into the WP
 * unified queue (wp_queue_sessions / wp_queue_entries).
 *
 * Use case: preserve `!queue history` continuity after flipping
 * QUEUE_SOURCE=wp. New entries created after the flip already live in
 * WP — this fills in the historical record so the past N sessions
 * stay visible.
 *
 * Usage:
 *   node scripts/migrate-queue-to-wp.js [--limit=10] [--dry-run]
 *
 * Reads from local SQLite via existing db.js prepared statements; writes
 * to WP via the same /shop/v1/queue REST endpoints used at runtime.
 *
 * Idempotent — entries are written with external_ref="migrate:queue:<id>:entry:<id>",
 * so re-running this script is safe (dupes are caught at the WP endpoint).
 */

import config from '../config.js';
import { queues } from '../db.js';

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith('--limit='));
const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 10;
const dryRun = args.includes('--dry-run');

const BASE = `${config.SITE_URL}/wp-json/shop/v1`;

async function botPost(path, body) {
    if (dryRun) {
        console.log(`  [dry-run] POST ${path} ${JSON.stringify(body).slice(0, 120)}`);
        return { ok: true, json: async () => ({ session: { id: 'dry-run' } }) };
    }
    const res = await fetch(`${BASE}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Bot-Secret': config.LIVESTREAM_SECRET,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`POST ${path} → ${res.status}: ${text}`);
    }
    return res;
}

async function botPatch(path, body) {
    if (dryRun) {
        console.log(`  [dry-run] PATCH ${path} ${JSON.stringify(body).slice(0, 120)}`);
        return { ok: true };
    }
    const res = await fetch(`${BASE}${path}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'X-Bot-Secret': config.LIVESTREAM_SECRET,
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`PATCH ${path} → ${res.status}: ${text}`);
    }
    return res;
}

async function migrate() {
    const recent = queues.getRecentQueues.all(limit);
    console.log(`Found ${recent.length} SQLite queues (limit=${limit}). Migrating to ${BASE}…`);

    for (const sqliteQueue of recent.reverse()) {
        console.log(`\n→ Queue #${sqliteQueue.id} (${sqliteQueue.status}, created ${sqliteQueue.created_at})`);

        // Open a session in WP
        const createRes = await botPost('/queue/sessions', {
            channel_message_id: sqliteQueue.channel_message_id || null,
        });
        let wpSessionId = null;
        if (!dryRun) {
            const data = await createRes.json();
            wpSessionId = data?.session?.id;
            if (!wpSessionId) {
                console.error(`  ✗ Could not extract WP session id; skipping entries`);
                continue;
            }
            console.log(`  ✓ WP session #${wpSessionId} created`);
        } else {
            wpSessionId = `migrated-${sqliteQueue.id}`;
        }

        // Migrate entries
        const entries = queues.getEntries.all(sqliteQueue.id);
        for (const e of entries) {
            await botPost('/queue/entries', {
                session_id: wpSessionId,
                type: 'order',
                source: e.discord_user_id ? 'discord' : 'shop',
                discord_user_id: e.discord_user_id,
                customer_email: e.customer_email,
                detail_label: e.product_name,
                detail_data: { quantity: e.quantity || 1 },
                stripe_session_id: e.stripe_session_id,
                external_ref: `migrate:queue:${sqliteQueue.id}:entry:${e.id}`,
            });
        }
        console.log(`  ✓ ${entries.length} entries migrated`);

        // Replay status transitions
        if (sqliteQueue.duck_race_winner_id) {
            await botPatch(`/queue/sessions/${wpSessionId}`, {
                status: 'complete',
                duck_race_winner_user_id: sqliteQueue.duck_race_winner_id,
            });
            console.log(`  ✓ Marked complete with winner ${sqliteQueue.duck_race_winner_id}`);
        } else if (sqliteQueue.status === 'closed') {
            await botPatch(`/queue/sessions/${wpSessionId}`, { status: 'closed' });
            console.log(`  ✓ Marked closed`);
        } else if (sqliteQueue.status === 'racing') {
            await botPatch(`/queue/sessions/${wpSessionId}`, { status: 'racing' });
            console.log(`  ✓ Marked racing`);
        }
    }

    console.log(`\nDone. ${dryRun ? '(dry-run — no writes)' : 'Migration complete.'}`);
}

migrate().catch((e) => {
    console.error('Migration failed:', e.message);
    process.exit(1);
});
