import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';

let db, stmts;

beforeEach(() => {
    db = createTestDb();
    stmts = buildStmts(db);
});

describe('battle lifecycle', () => {
    it('creates a battle', () => {
        const result = stmts.battles.createBattle.run('prismatic-evolutions', 'Prismatic Evolutions', 'price_123', 10, null);
        expect(result.lastInsertRowid).toBe(1);

        const battle = stmts.battles.getActiveBattle.get();
        expect(battle).toBeTruthy();
        expect(battle.product_name).toBe('Prismatic Evolutions');
        expect(battle.stripe_price_id).toBe('price_123');
        expect(battle.max_entries).toBe(10);
        expect(battle.status).toBe('open');
    });

    it('returns an active battle when multiple exist', () => {
        stmts.battles.createBattle.run('product-a', 'Product A', 'price_a', 10, null);
        stmts.battles.createBattle.run('product-b', 'Product B', 'price_b', 10, null);

        // Both are open — getActiveBattle returns one of them
        const active = stmts.battles.getActiveBattle.get();
        expect(active).toBeTruthy();
        expect(active.status).toBe('open');
    });

    it('closes a battle', () => {
        stmts.battles.createBattle.run('test', 'Test', 'price_1', 10, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.closeBattle.run(battle.id);

        const closed = stmts.battles.getBattleById.get(battle.id);
        expect(closed.status).toBe('closed');
        expect(closed.closed_at).toBeTruthy();

        const active = stmts.battles.getActiveBattle.get();
        expect(active).toBeUndefined();
    });

    it('cancels a battle', () => {
        stmts.battles.createBattle.run('test', 'Test', 'price_1', 10, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.cancelBattle.run(battle.id);

        const cancelled = stmts.battles.getBattleById.get(battle.id);
        expect(cancelled.status).toBe('cancelled');
    });

    it('deletes empty battles', () => {
        stmts.battles.createBattle.run('test', 'Test', 'price_1', 10, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.deleteBattle.run(battle.id);

        const deleted = stmts.battles.getBattleById.get(battle.id);
        expect(deleted).toBeUndefined();
    });

    it('sets winner', () => {
        stmts.battles.createBattle.run('test', 'Test', 'price_1', 10, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.setBattleWinner.run('user123', battle.id);

        const updated = stmts.battles.getBattleById.get(battle.id);
        expect(updated.winner_id).toBe('user123');
        expect(updated.status).toBe('complete');
    });
});

describe('battle entries', () => {
    it('adds entries', () => {
        stmts.battles.createBattle.run('test', 'Test', 'price_1', 10, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.addEntry.run(battle.id, 'user1', battle.id, battle.id);
        stmts.battles.addEntry.run(battle.id, 'user2', battle.id, battle.id);

        const count = stmts.battles.getEntryCount.get(battle.id);
        expect(count.count).toBe(2);
    });

    it('prevents duplicate entries', () => {
        stmts.battles.createBattle.run('test', 'Test', 'price_1', 10, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.addEntry.run(battle.id, 'user1', battle.id, battle.id);
        stmts.battles.addEntry.run(battle.id, 'user1', battle.id, battle.id); // duplicate

        const count = stmts.battles.getEntryCount.get(battle.id);
        expect(count.count).toBe(1);
    });

    it('confirms payment', () => {
        stmts.battles.createBattle.run('test', 'Test', 'price_1', 10, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.addEntry.run(battle.id, 'user1', battle.id, battle.id);
        stmts.battles.confirmPayment.run('session_abc', battle.id, 'user1');

        const paid = stmts.battles.getPaidEntries.all(battle.id);
        expect(paid).toHaveLength(1);
        expect(paid[0].stripe_session_id).toBe('session_abc');
    });

    it('distinguishes paid and unpaid entries', () => {
        stmts.battles.createBattle.run('test', 'Test', 'price_1', 10, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.addEntry.run(battle.id, 'user1', battle.id, battle.id);
        stmts.battles.addEntry.run(battle.id, 'user2', battle.id, battle.id);
        stmts.battles.confirmPayment.run('session_abc', battle.id, 'user1');

        const all = stmts.battles.getEntries.all(battle.id);
        const paid = stmts.battles.getPaidEntries.all(battle.id);

        expect(all).toHaveLength(2);
        expect(paid).toHaveLength(1);
        expect(paid[0].discord_user_id).toBe('user1');
    });
});

describe('battle numbering', () => {
    it('starts at 1', () => {
        const { next } = stmts.battles.getNextBattleNumber.get();
        expect(next).toBe(1);
    });

    it('increments sequentially', () => {
        stmts.battles.createBattle.run('a', 'A', 'p1', 10, null);
        const b1 = stmts.battles.getActiveBattle.get();
        stmts.battles.setBattleNumber.run(1, b1.id);
        stmts.battles.closeBattle.run(b1.id);

        stmts.battles.createBattle.run('b', 'B', 'p2', 10, null);
        const b2 = stmts.battles.getActiveBattle.get();

        const { next } = stmts.battles.getNextBattleNumber.get();
        expect(next).toBe(2);
    });

    it('does not skip numbers when empty battles are deleted', () => {
        // Battle 1: has entries, gets number 1
        stmts.battles.createBattle.run('a', 'A', 'p1', 10, null);
        const b1 = stmts.battles.getActiveBattle.get();
        stmts.battles.addEntry.run(b1.id, 'user1', b1.id, b1.id);
        stmts.battles.confirmPayment.run('s1', b1.id, 'user1');
        stmts.battles.setBattleNumber.run(1, b1.id);
        stmts.battles.closeBattle.run(b1.id);

        // Battle 2: empty, deleted
        stmts.battles.createBattle.run('b', 'B', 'p2', 10, null);
        const b2 = stmts.battles.getActiveBattle.get();
        stmts.battles.deleteBattle.run(b2.id);

        // Battle 3: should be number 2, not 3
        const { next } = stmts.battles.getNextBattleNumber.get();
        expect(next).toBe(2);
    });
});
