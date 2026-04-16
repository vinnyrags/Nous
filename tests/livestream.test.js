import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';

let db, stmts;

beforeEach(() => {
    db = createTestDb();
    stmts = buildStmts(db);
});

describe('livestream session lifecycle', () => {
    it('starts a session', () => {
        const result = stmts.livestream.startSession.run();
        expect(result.lastInsertRowid).toBe(1);

        const session = stmts.livestream.getActiveSession.get();
        expect(session).toBeTruthy();
        expect(session.status).toBe('active');
    });

    it('ends a session', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        stmts.livestream.endSession.run(session.id);

        const active = stmts.livestream.getActiveSession.get();
        expect(active).toBeUndefined();
    });

    it('prevents checking for active when none exists', () => {
        const session = stmts.livestream.getActiveSession.get();
        expect(session).toBeUndefined();
    });
});

describe('livestream buyers', () => {
    it('tracks buyers', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');
        stmts.livestream.addBuyer.run(session.id, 'user2', 'user2@test.com');

        const buyers = stmts.livestream.getBuyers.all(session.id);
        expect(buyers).toHaveLength(2);
    });

    it('deduplicates buyers by email within a session', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com'); // duplicate

        const buyers = stmts.livestream.getBuyers.all(session.id);
        expect(buyers).toHaveLength(1);
    });

    it('same buyer in different sessions creates separate entries', () => {
        // Session 1
        stmts.livestream.startSession.run();
        const s1 = stmts.livestream.getActiveSession.get();
        stmts.livestream.addBuyer.run(s1.id, 'user1', 'user1@test.com');
        stmts.livestream.endSession.run(s1.id);

        // Session 2
        stmts.livestream.startSession.run();
        const s2 = stmts.livestream.getActiveSession.get();
        stmts.livestream.addBuyer.run(s2.id, 'user1', 'user1@test.com');

        const s1Buyers = stmts.livestream.getBuyers.all(s1.id);
        const s2Buyers = stmts.livestream.getBuyers.all(s2.id);
        expect(s1Buyers).toHaveLength(1);
        expect(s2Buyers).toHaveLength(1);
    });

    it('marks shipping as paid', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');
        stmts.livestream.addBuyer.run(session.id, 'user2', 'user2@test.com');

        stmts.livestream.markShippingPaid.run(session.id, 'user1@test.com');

        // getBuyers only returns unpaid
        const unpaid = stmts.livestream.getBuyers.all(session.id);
        expect(unpaid).toHaveLength(1);
        expect(unpaid[0].customer_email).toBe('user2@test.com');
    });

    it('handles battle winner with placeholder email', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        stmts.livestream.addBuyer.run(session.id, 'winner123', 'battle-winner-winner123@placeholder');

        const buyers = stmts.livestream.getBuyers.all(session.id);
        expect(buyers).toHaveLength(1);
        expect(buyers[0].discord_user_id).toBe('winner123');
    });
});

describe('livestream + queue integration', () => {
    it('queue stays open when livestream starts', () => {
        // Open queue (pre-orders)
        stmts.queues.createQueue.run();
        const queue = stmts.queues.getActiveQueue.get();
        stmts.queues.addEntry.run(queue.id, 'user1', 'u1@test.com', 'Pre-order Pack', 1, 's1');

        // Start livestream — queue should still be open
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();
        expect(session).toBeTruthy();

        const stillOpen = stmts.queues.getActiveQueue.get();
        expect(stillOpen).toBeTruthy();
        expect(stillOpen.id).toBe(queue.id);
    });

    it('queue closes and new one opens when livestream ends', () => {
        stmts.queues.createQueue.run();
        const queue = stmts.queues.getActiveQueue.get();

        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        // End stream: close queue, end session, open new queue
        stmts.queues.closeQueue.run(queue.id);
        stmts.livestream.endSession.run(session.id);
        stmts.queues.createQueue.run();

        const newQueue = stmts.queues.getActiveQueue.get();
        expect(newQueue.id).not.toBe(queue.id);

        const oldQueue = stmts.queues.getQueueById.get(queue.id);
        expect(oldQueue.status).toBe('closed');
    });

    it('purchases during livestream go into queue AND livestream buyers', () => {
        stmts.queues.createQueue.run();
        const queue = stmts.queues.getActiveQueue.get();

        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        // Simulate a purchase during livestream
        stmts.queues.addEntry.run(queue.id, 'user1', 'u1@test.com', 'Pack', 1, 's1');
        stmts.livestream.addBuyer.run(session.id, 'user1', 'u1@test.com');

        const queueEntries = stmts.queues.getEntries.all(queue.id);
        const buyers = stmts.livestream.getBuyers.all(session.id);

        expect(queueEntries).toHaveLength(1);
        expect(buyers).toHaveLength(1);
    });
});

describe('shipping scenarios', () => {
    it('multiple purchases by same buyer = one shipping DM', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        // Same buyer, 3 purchases — addBuyer deduplicates by email
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');

        const buyers = stmts.livestream.getBuyers.all(session.id);
        expect(buyers).toHaveLength(1); // one DM, not three
    });

    it('battle winner added to livestream buyers for consolidated shipping', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        // Regular purchase
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');

        // Battle winner (same user) — already tracked, no duplicate
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');

        const buyers = stmts.livestream.getBuyers.all(session.id);
        expect(buyers).toHaveLength(1); // consolidated
    });

    it('battle winner who did not buy gets added with placeholder', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        // Only a battle winner, no shop purchase
        stmts.livestream.addBuyer.run(session.id, 'winner1', 'battle-winner-winner1@placeholder');

        const buyers = stmts.livestream.getBuyers.all(session.id);
        expect(buyers).toHaveLength(1);
        expect(buyers[0].customer_email).toContain('@placeholder');
    });
});

describe('weekly shipping tracking', () => {
    it('hasShippingThisWeek returns undefined when no shipping paid', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');

        const result = stmts.livestream.hasShippingThisWeek.get('user1@test.com');
        expect(result).toBeUndefined();
    });

    it('hasShippingThisWeek returns truthy after shipping is paid', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');

        stmts.livestream.markShippingPaid.run(session.id, 'user1@test.com');

        const result = stmts.livestream.hasShippingThisWeek.get('user1@test.com');
        expect(result).toBeTruthy();
    });

    it('buyer who paid shipping in earlier session is covered for the week', () => {
        // Session 1 — buyer pays shipping
        stmts.livestream.startSession.run();
        const s1 = stmts.livestream.getActiveSession.get();
        stmts.livestream.addBuyer.run(s1.id, 'user1', 'user1@test.com');
        stmts.livestream.markShippingPaid.run(s1.id, 'user1@test.com');
        stmts.livestream.endSession.run(s1.id);

        // Session 2 — same buyer buys again
        stmts.livestream.startSession.run();
        const s2 = stmts.livestream.getActiveSession.get();
        stmts.livestream.addBuyer.run(s2.id, 'user1', 'user1@test.com');

        // Should be recognized as already covered
        const paidThisWeek = stmts.livestream.hasShippingThisWeek.get('user1@test.com');
        expect(paidThisWeek).toBeTruthy();

        // But still shows as unpaid in this session's getBuyers
        const unpaid = stmts.livestream.getBuyers.all(s2.id);
        expect(unpaid).toHaveLength(1);
    });

    it('different buyers are tracked independently', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');
        stmts.livestream.addBuyer.run(session.id, 'user2', 'user2@test.com');

        // Only user1 pays shipping
        stmts.livestream.markShippingPaid.run(session.id, 'user1@test.com');

        expect(stmts.livestream.hasShippingThisWeek.get('user1@test.com')).toBeTruthy();
        expect(stmts.livestream.hasShippingThisWeek.get('user2@test.com')).toBeUndefined();
    });
});
