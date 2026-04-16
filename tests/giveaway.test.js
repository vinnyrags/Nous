/**
 * Tests for giveaway system — DB operations, entry tracking, status lifecycle.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';

/** Format JS Date as SQLite datetime (YYYY-MM-DD HH:MM:SS). */
function toSqlite(date) {
    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '');
}

describe('giveaway DB operations', () => {
    let db, stmts;

    beforeEach(() => {
        db = createTestDb();
        stmts = buildStmts(db);
    });

    describe('lifecycle', () => {
        it('creates a giveaway with prize name', () => {
            const result = stmts.giveaways.create.run('Prismatic Evolutions ETB', null, 0, null);
            const giveaway = stmts.giveaways.getById.get(result.lastInsertRowid);
            expect(giveaway.prize_name).toBe('Prismatic Evolutions ETB');
            expect(giveaway.status).toBe('open');
            expect(giveaway.ends_at).toBeNull();
            expect(giveaway.winner_id).toBeNull();
        });

        it('creates a giveaway with duration', () => {
            const endsAt = toSqlite(new Date(Date.now() + 24 * 60 * 60 * 1000));
            stmts.giveaways.create.run('ETB', endsAt, 0, null);
            const giveaway = stmts.giveaways.getActive.get();
            expect(giveaway.ends_at).toBe(endsAt);
        });

        it('only one active giveaway at a time', () => {
            stmts.giveaways.create.run('Prize 1', null, 0, null);
            stmts.giveaways.create.run('Prize 2', null, 0, null);
            // getActive returns the most recent
            const active = stmts.giveaways.getActive.get();
            expect(active.prize_name).toBe('Prize 2');
        });

        it('closes a giveaway', () => {
            stmts.giveaways.create.run('Prize', null, 0, null);
            const giveaway = stmts.giveaways.getActive.get();
            stmts.giveaways.close.run(giveaway.id);

            const closed = stmts.giveaways.getById.get(giveaway.id);
            expect(closed.status).toBe('closed');
            expect(closed.closed_at).not.toBeNull();
            expect(stmts.giveaways.getActive.get()).toBeUndefined();
        });

        it('cancels a giveaway', () => {
            stmts.giveaways.create.run('Prize', null, 0, null);
            const giveaway = stmts.giveaways.getActive.get();
            stmts.giveaways.cancel.run(giveaway.id);

            const cancelled = stmts.giveaways.getById.get(giveaway.id);
            expect(cancelled.status).toBe('cancelled');
        });

        it('sets winner and marks complete', () => {
            stmts.giveaways.create.run('Prize', null, 0, null);
            const giveaway = stmts.giveaways.getActive.get();
            stmts.giveaways.close.run(giveaway.id);
            stmts.giveaways.setWinner.run('winner123', giveaway.id);

            const complete = stmts.giveaways.getById.get(giveaway.id);
            expect(complete.status).toBe('complete');
            expect(complete.winner_id).toBe('winner123');
        });
    });

    describe('entries', () => {
        it('adds entries to a giveaway', () => {
            stmts.giveaways.create.run('Prize', null, 0, null);
            const giveaway = stmts.giveaways.getActive.get();

            stmts.giveaways.addEntry.run(giveaway.id, 'user1', null);
            stmts.giveaways.addEntry.run(giveaway.id, 'user2', null);
            stmts.giveaways.addEntry.run(giveaway.id, 'user3', null);

            const entries = stmts.giveaways.getEntries.all(giveaway.id);
            expect(entries).toHaveLength(3);
            expect(entries[0].discord_user_id).toBe('user1');
        });

        it('enforces one entry per user per giveaway', () => {
            stmts.giveaways.create.run('Prize', null, 0, null);
            const giveaway = stmts.giveaways.getActive.get();

            stmts.giveaways.addEntry.run(giveaway.id, 'user1', null);
            stmts.giveaways.addEntry.run(giveaway.id, 'user1', null); // duplicate

            const count = stmts.giveaways.getEntryCount.get(giveaway.id);
            expect(count.count).toBe(1);
        });

        it('counts entries correctly', () => {
            stmts.giveaways.create.run('Prize', null, 0, null);
            const giveaway = stmts.giveaways.getActive.get();

            for (let i = 0; i < 5; i++) {
                stmts.giveaways.addEntry.run(giveaway.id, `user${i}`, null);
            }

            const count = stmts.giveaways.getEntryCount.get(giveaway.id);
            expect(count.count).toBe(5);
        });

        it('entries from different giveaways are independent', () => {
            stmts.giveaways.create.run('Prize 1', null, 0, null);
            const g1 = stmts.giveaways.getActive.get();
            stmts.giveaways.addEntry.run(g1.id, 'user1', null);
            stmts.giveaways.close.run(g1.id);

            stmts.giveaways.create.run('Prize 2', null, 0, null);
            const g2 = stmts.giveaways.getActive.get();
            stmts.giveaways.addEntry.run(g2.id, 'user1', null); // same user, different giveaway
            stmts.giveaways.addEntry.run(g2.id, 'user2', null);

            expect(stmts.giveaways.getEntryCount.get(g1.id).count).toBe(1);
            expect(stmts.giveaways.getEntryCount.get(g2.id).count).toBe(2);
        });
    });

    describe('message tracking', () => {
        it('stores and retrieves by message ID', () => {
            stmts.giveaways.create.run('Prize', null, 0, null);
            const giveaway = stmts.giveaways.getActive.get();
            stmts.giveaways.setMessageId.run('msg_123', giveaway.id);

            const found = stmts.giveaways.getByMessageId.get('msg_123');
            expect(found).toBeTruthy();
            expect(found.id).toBe(giveaway.id);
        });

        it('returns undefined for unknown message ID', () => {
            const found = stmts.giveaways.getByMessageId.get('nonexistent');
            expect(found).toBeUndefined();
        });
    });

    describe('expiration', () => {
        it('finds expired giveaways', () => {
            // Create giveaway that ended in the past
            const pastDate = toSqlite(new Date(Date.now() - 60000));
            stmts.giveaways.create.run('Expired Prize', pastDate, 0, null);

            const expired = stmts.giveaways.getExpired.all();
            expect(expired).toHaveLength(1);
            expect(expired[0].prize_name).toBe('Expired Prize');
        });

        it('does not find non-expired giveaways', () => {
            const futureDate = toSqlite(new Date(Date.now() + 60000));
            stmts.giveaways.create.run('Future Prize', futureDate, 0, null);

            const expired = stmts.giveaways.getExpired.all();
            expect(expired).toHaveLength(0);
        });

        it('does not find giveaways without ends_at', () => {
            stmts.giveaways.create.run('No Deadline', null, 0, null);

            const expired = stmts.giveaways.getExpired.all();
            expect(expired).toHaveLength(0);
        });
    });
});
