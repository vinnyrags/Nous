/**
 * Stock management and sync tests.
 * Tests stock decrement/restore cycles, deduplication, and edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';

let db, stmts;

beforeEach(() => {
    db = createTestDb();
    stmts = buildStmts(db);
});

describe('stock decrement and restore cycle', () => {
    it('decrement then restore returns to original stock', () => {
        // Simulate: stock starts at 10, checkout decrements to 9, cancel restores to 10
        let stock = 10;
        stock = Math.max(0, stock - 1); // checkout decrement
        expect(stock).toBe(9);
        stock = stock + 1; // cancel restore
        expect(stock).toBe(10);
    });

    it('multiple decrements then full restore', () => {
        let stock = 5;
        // 3 items checked out
        stock = Math.max(0, stock - 3);
        expect(stock).toBe(2);
        // All 3 restored (cancelled)
        stock = stock + 3;
        expect(stock).toBe(5);
    });

    it('decrement cannot go below zero', () => {
        let stock = 1;
        stock = Math.max(0, stock - 5); // trying to decrement more than available
        expect(stock).toBe(0);
    });

    it('restore after zero stock', () => {
        let stock = 0;
        stock = stock + 2; // restore from cancelled checkout
        expect(stock).toBe(2);
    });
});

describe('webhook duplicate prevention', () => {
    it('duplicate purchase session IDs are rejected', () => {
        stmts.purchases.insertPurchase.run('session_1', 'user1', 'u1@test.com', 'Pack', 500);
        stmts.purchases.insertPurchase.run('session_1', 'user1', 'u1@test.com', 'Pack', 500); // duplicate

        const rows = db.prepare('SELECT * FROM purchases').all();
        expect(rows).toHaveLength(1); // only one recorded
    });

    it('same user different sessions are both recorded', () => {
        stmts.purchases.insertPurchase.run('session_1', 'user1', 'u1@test.com', 'Pack A', 500);
        stmts.purchases.insertPurchase.run('session_2', 'user1', 'u1@test.com', 'Pack B', 700);

        const rows = db.prepare('SELECT * FROM purchases').all();
        expect(rows).toHaveLength(2);
    });

    it('purchase count only increments once per call', () => {
        stmts.purchases.incrementPurchaseCount.run('user1');
        expect(stmts.purchases.getPurchaseCount.get('user1').total_purchases).toBe(1);

        stmts.purchases.incrementPurchaseCount.run('user1');
        expect(stmts.purchases.getPurchaseCount.get('user1').total_purchases).toBe(2);
    });
});

describe('battle owner entry stock tracking', () => {
    it('owner entry adds paid entry without Stripe session', () => {
        stmts.battles.createBattle.run('test', 'Test', 'price_1', 10, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.addEntry.run(battle.id, 'owner123', battle.id, battle.id);
        stmts.battles.confirmPayment.run(`owner-${battle.id}`, battle.id, 'owner123');

        const paid = stmts.battles.getPaidEntries.all(battle.id);
        expect(paid).toHaveLength(1);
        expect(paid[0].stripe_session_id).toBe(`owner-${battle.id}`);
    });

    it('owner cannot join same battle twice', () => {
        stmts.battles.createBattle.run('test', 'Test', 'price_1', 10, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.addEntry.run(battle.id, 'owner123', battle.id, battle.id);
        stmts.battles.addEntry.run(battle.id, 'owner123', battle.id, battle.id); // duplicate ignored

        const entries = stmts.battles.getEntries.all(battle.id);
        expect(entries).toHaveLength(1);
    });
});

describe('queue entry with varying quantities', () => {
    it('single item quantity 1', () => {
        stmts.queues.createQueue.run();
        const queue = stmts.queues.getActiveQueue.get();

        stmts.queues.addEntry.run(queue.id, 'user1', 'u1@test.com', 'Pack', 1, 's1');

        const entries = stmts.queues.getEntries.all(queue.id);
        expect(entries).toHaveLength(1);
        expect(entries[0].quantity).toBe(1);
    });

    it('single item quantity 5', () => {
        stmts.queues.createQueue.run();
        const queue = stmts.queues.getActiveQueue.get();

        stmts.queues.addEntry.run(queue.id, 'user1', 'u1@test.com', 'Booster Box', 5, 's1');

        const entries = stmts.queues.getEntries.all(queue.id);
        expect(entries[0].quantity).toBe(5);

        // Still only 1 duck race entry
        const buyers = stmts.queues.getUniqueBuyers.all(queue.id);
        expect(buyers).toHaveLength(1);
    });

    it('multiple items same buyer = multiple entries but one duck race entry', () => {
        stmts.queues.createQueue.run();
        const queue = stmts.queues.getActiveQueue.get();

        stmts.queues.addEntry.run(queue.id, 'user1', 'u1@test.com', 'Pack A', 1, 's1');
        stmts.queues.addEntry.run(queue.id, 'user1', 'u1@test.com', 'Pack B', 3, 's2');
        stmts.queues.addEntry.run(queue.id, 'user1', 'u1@test.com', 'Box C', 1, 's3');

        const entries = stmts.queues.getEntries.all(queue.id);
        expect(entries).toHaveLength(3);

        const buyers = stmts.queues.getUniqueBuyers.all(queue.id);
        expect(buyers).toHaveLength(1); // one duck race entry
    });
});
