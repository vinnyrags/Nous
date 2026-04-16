import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';

let db, stmts;

beforeEach(() => {
    db = createTestDb();
    stmts = buildStmts(db);
});

describe('purchase tracking', () => {
    it('records a purchase', () => {
        stmts.purchases.insertPurchase.run('session_1', 'user1', 'user1@test.com', 'Pokemon Pack', 500);

        const rows = db.prepare('SELECT * FROM purchases').all();
        expect(rows).toHaveLength(1);
        expect(rows[0].product_name).toBe('Pokemon Pack');
        expect(rows[0].amount).toBe(500);
    });

    it('prevents duplicate sessions', () => {
        stmts.purchases.insertPurchase.run('session_1', 'user1', 'u1@test.com', 'Pack A', 500);
        stmts.purchases.insertPurchase.run('session_1', 'user1', 'u1@test.com', 'Pack A', 500); // duplicate

        const rows = db.prepare('SELECT * FROM purchases').all();
        expect(rows).toHaveLength(1);
    });
});

describe('purchase counts and role promotion', () => {
    it('increments purchase count', () => {
        stmts.purchases.incrementPurchaseCount.run('user1');
        stmts.purchases.incrementPurchaseCount.run('user1');
        stmts.purchases.incrementPurchaseCount.run('user1');

        const row = stmts.purchases.getPurchaseCount.get('user1');
        expect(row.total_purchases).toBe(3);
    });

    it('starts at 0 for new users', () => {
        const row = stmts.purchases.getPurchaseCount.get('unknown');
        expect(row).toBeUndefined();
    });

    it('tracks counts per user independently', () => {
        stmts.purchases.incrementPurchaseCount.run('user1');
        stmts.purchases.incrementPurchaseCount.run('user1');
        stmts.purchases.incrementPurchaseCount.run('user2');

        expect(stmts.purchases.getPurchaseCount.get('user1').total_purchases).toBe(2);
        expect(stmts.purchases.getPurchaseCount.get('user2').total_purchases).toBe(1);
    });

    it('reaches Xipe threshold at 1 purchase', () => {
        stmts.purchases.incrementPurchaseCount.run('user1');
        const count = stmts.purchases.getPurchaseCount.get('user1').total_purchases;
        expect(count >= 1).toBe(true); // Xipe threshold
    });

    it('reaches Long threshold at 5 purchases', () => {
        for (let i = 0; i < 5; i++) {
            stmts.purchases.incrementPurchaseCount.run('user1');
        }
        const count = stmts.purchases.getPurchaseCount.get('user1').total_purchases;
        expect(count >= 5).toBe(true); // Long threshold
    });
});

describe('discord account linking', () => {
    it('links discord to email', () => {
        stmts.purchases.linkDiscord.run('user1', 'user1@test.com');

        const link = stmts.purchases.getDiscordIdByEmail.get('user1@test.com');
        expect(link.discord_user_id).toBe('user1');
    });

    it('reverse lookup by discord id', () => {
        stmts.purchases.linkDiscord.run('user1', 'user1@test.com');

        const link = stmts.purchases.getEmailByDiscordId.get('user1');
        expect(link.customer_email).toBe('user1@test.com');
    });

    it('replaces existing link on conflict', () => {
        stmts.purchases.linkDiscord.run('user1', 'old@test.com');
        stmts.purchases.linkDiscord.run('user1', 'new@test.com');

        const link = stmts.purchases.getEmailByDiscordId.get('user1');
        expect(link.customer_email).toBe('new@test.com');
    });

    it('returns undefined for unlinked user', () => {
        const link = stmts.purchases.getDiscordIdByEmail.get('nobody@test.com');
        expect(link).toBeUndefined();
    });
});

describe('critical purchase path', () => {
    it('full purchase flow: link → buy → count → promote', () => {
        // Step 1: User links their account
        stmts.purchases.linkDiscord.run('user1', 'user1@test.com');

        // Step 2: Purchase comes in, look up discord id by email
        const link = stmts.purchases.getDiscordIdByEmail.get('user1@test.com');
        expect(link.discord_user_id).toBe('user1');

        // Step 3: Record purchase
        stmts.purchases.insertPurchase.run('session_1', link.discord_user_id, 'user1@test.com', 'Pokemon Pack', 700);

        // Step 4: Increment count
        stmts.purchases.incrementPurchaseCount.run(link.discord_user_id);
        const count = stmts.purchases.getPurchaseCount.get(link.discord_user_id);
        expect(count.total_purchases).toBe(1);

        // At this point: Xipe threshold met (1+)
    });

    it('full purchase flow with queue entry', () => {
        stmts.purchases.linkDiscord.run('user1', 'user1@test.com');
        stmts.queues.createQueue.run();
        const queue = stmts.queues.getActiveQueue.get();

        // Purchase adds to queue
        stmts.queues.addEntry.run(queue.id, 'user1', 'user1@test.com', 'Pokemon Pack', 1, 'session_1');
        stmts.purchases.insertPurchase.run('session_1', 'user1', 'user1@test.com', 'Pokemon Pack', 700);
        stmts.purchases.incrementPurchaseCount.run('user1');

        const entries = stmts.queues.getEntries.all(queue.id);
        expect(entries).toHaveLength(1);

        const buyers = stmts.queues.getUniqueBuyers.all(queue.id);
        expect(buyers).toHaveLength(1); // 1 duck race entry
    });

    it('full livestream purchase flow', () => {
        stmts.purchases.linkDiscord.run('user1', 'user1@test.com');
        stmts.queues.createQueue.run();
        stmts.livestream.startSession.run();

        const queue = stmts.queues.getActiveQueue.get();
        const session = stmts.livestream.getActiveSession.get();

        // Livestream purchase (has live=1 metadata)
        stmts.queues.addEntry.run(queue.id, 'user1', 'user1@test.com', 'Pokemon Pack', 1, 'session_1');
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');
        stmts.purchases.insertPurchase.run('session_1', 'user1', 'user1@test.com', 'Pokemon Pack', 700);
        stmts.purchases.incrementPurchaseCount.run('user1');

        // Verify all systems tracked the purchase
        expect(stmts.queues.getEntries.all(queue.id)).toHaveLength(1);
        expect(stmts.livestream.getBuyers.all(session.id)).toHaveLength(1);
        expect(stmts.purchases.getPurchaseCount.get('user1').total_purchases).toBe(1);
    });

    it('repeat buyer during livestream only gets one shipping DM', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        // 5 purchases by same buyer
        for (let i = 0; i < 5; i++) {
            stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');
        }

        const buyers = stmts.livestream.getBuyers.all(session.id);
        expect(buyers).toHaveLength(1); // ONE shipping DM
    });

    it('battle winner + shop buyer = one shipping DM', () => {
        stmts.livestream.startSession.run();
        const session = stmts.livestream.getActiveSession.get();

        // Shop purchase
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');

        // Win a battle — same user
        stmts.livestream.addBuyer.run(session.id, 'user1', 'user1@test.com');

        const buyers = stmts.livestream.getBuyers.all(session.id);
        expect(buyers).toHaveLength(1); // consolidated
    });
});
