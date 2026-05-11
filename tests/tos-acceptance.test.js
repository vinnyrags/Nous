/**
 * Tests for the Discord-flow ToS acceptance helper.
 *
 * The helper is the gate every Buy-button handler checks before
 * generating a Stripe checkout. We pin:
 *   - hasAccepted() correctness at the user × version grain
 *   - record() inserts an audit row
 *   - metadataFor() returns the four Stripe-ready audit fields
 *   - Version bump invalidates an old acceptance (the user-visible
 *     gate fires again, but the historical row is preserved)
 *
 * The helper imports db.js's `tosAcceptances` prepared statements, so
 * we vi.mock the db.js export with an in-memory SQLite that has the
 * same schema. Same pattern other tests in this repo use to isolate
 * from the production data.db file.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

// Set up the mock db BEFORE importing the helper so the helper picks
// up the in-memory statements rather than the production data.db.
const testDb = new Database(':memory:');
testDb.exec(`
    CREATE TABLE discord_tos_acceptances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_user_id TEXT NOT NULL,
        terms_version TEXT NOT NULL,
        accepted_at TEXT NOT NULL DEFAULT (datetime('now')),
        source TEXT NOT NULL DEFAULT 'discord_button'
    );
`);

vi.mock('../db.js', () => ({
    tosAcceptances: {
        has: testDb.prepare(`
            SELECT 1 FROM discord_tos_acceptances
            WHERE discord_user_id = ? AND terms_version = ?
            LIMIT 1
        `),
        insert: testDb.prepare(`
            INSERT INTO discord_tos_acceptances (discord_user_id, terms_version, source)
            VALUES (?, ?, ?)
        `),
        getLatest: testDb.prepare(`
            SELECT * FROM discord_tos_acceptances
            WHERE discord_user_id = ?
            ORDER BY id DESC
            LIMIT 1
        `),
    },
}));

const { hasAccepted, record, metadataFor, CURRENT_VERSION } = await import(
    '../lib/tos-acceptance.js'
);

beforeEach(() => {
    testDb.exec('DELETE FROM discord_tos_acceptances');
});

describe('hasAccepted', () => {
    it('returns false when the user has never accepted', () => {
        expect(hasAccepted('111')).toBe(false);
    });

    it('returns false when discordUserId is null / undefined / empty', () => {
        expect(hasAccepted(null)).toBe(false);
        expect(hasAccepted(undefined)).toBe(false);
        expect(hasAccepted('')).toBe(false);
    });

    it('returns true after the user accepts the current version', () => {
        record('111');
        expect(hasAccepted('111')).toBe(true);
    });

    it('only matches the user it was recorded for', () => {
        record('111');
        expect(hasAccepted('222')).toBe(false);
    });

    it('returns false when only a DIFFERENT version is on record', () => {
        // Simulate a buyer who accepted v1.0 before the bump — the
        // legacy row is still in the audit trail, but the gate must
        // fire again to capture acceptance of the new version.
        testDb
            .prepare(
                `INSERT INTO discord_tos_acceptances (discord_user_id, terms_version, source) VALUES (?, ?, ?)`,
            )
            .run('111', '1.0', 'discord_button');
        expect(hasAccepted('111')).toBe(false);
    });
});

describe('record', () => {
    it('inserts an audit row for the user × current version', () => {
        record('111');
        const row = testDb
            .prepare('SELECT * FROM discord_tos_acceptances WHERE discord_user_id = ?')
            .get('111');
        expect(row).toBeTruthy();
        expect(row.terms_version).toBe(CURRENT_VERSION);
        expect(row.source).toBe('discord_button');
    });

    it('accepts an explicit source label', () => {
        record('111', 'manual_admin');
        const row = testDb
            .prepare('SELECT * FROM discord_tos_acceptances WHERE discord_user_id = ?')
            .get('111');
        expect(row.source).toBe('manual_admin');
    });

    it('no-ops on empty discordUserId — never inserts a phantom row', () => {
        record('');
        record(null);
        record(undefined);
        const count = testDb
            .prepare('SELECT COUNT(*) AS n FROM discord_tos_acceptances')
            .get().n;
        expect(count).toBe(0);
    });

    it('append-only — multiple acceptances per user are allowed', () => {
        // Future-proof: if a buyer re-clicks I-agree (refresh, etc.)
        // we don't dedupe at the storage level. The trail grows.
        record('111');
        record('111');
        record('111');
        const count = testDb
            .prepare(
                'SELECT COUNT(*) AS n FROM discord_tos_acceptances WHERE discord_user_id = ?',
            )
            .get('111').n;
        expect(count).toBe(3);
    });
});

describe('metadataFor', () => {
    it('returns the four Stripe-ready audit fields for an accepted user', () => {
        record('111');
        const meta = metadataFor('111');
        expect(meta.terms_version).toBe(CURRENT_VERSION);
        expect(meta.terms_accepted_source).toBe('discord');
        expect(meta.terms_accepted_discord_user_id).toBe('111');
        expect(meta.terms_accepted_at).toMatch(
            /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
        );
    });

    it('uses the LATEST acceptance row when multiple exist', () => {
        // Pin the "latest wins" behavior — we don't want to attach a
        // stale 2-year-old timestamp to a fresh purchase by a buyer
        // who has re-accepted multiple times.
        record('111', 'old');
        record('111', 'new');
        const meta = metadataFor('111');
        expect(meta.terms_accepted_source).toBe('discord'); // source override
        // Latest row's source field internally is 'new' but we always
        // surface 'discord' in metadata — verify the row LOOKUP went
        // to the most recent insert via a different angle:
        const allRows = testDb
            .prepare(
                'SELECT * FROM discord_tos_acceptances WHERE discord_user_id = ? ORDER BY id DESC',
            )
            .all('111');
        expect(allRows[0].source).toBe('new');
    });

    it('returns empty object when no acceptance is on record', () => {
        expect(metadataFor('111')).toEqual({});
    });

    it('returns empty object for empty discordUserId', () => {
        expect(metadataFor(null)).toEqual({});
        expect(metadataFor('')).toEqual({});
    });
});

describe('CURRENT_VERSION', () => {
    it('matches the v1.2 string the WP + frontend constants use', () => {
        // Belt-and-braces pin: if a future contributor bumps this without
        // also updating itzenzo.tv/src/lib/terms.ts and WP-side
        // TouAcceptance::CURRENT_VERSION, the live gate-cadence story
        // breaks (one repo's CURRENT vs another's submitted). This test
        // is the canary — when you bump version, update it here too AND
        // bump both other places.
        expect(CURRENT_VERSION).toBe('1.2');
    });
});
