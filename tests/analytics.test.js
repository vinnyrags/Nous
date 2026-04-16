/**
 * Tests for analytics queries — range stats, top products, new buyers, stream/battle counts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';

describe('analytics queries', () => {
    let db, stmts;

    beforeEach(() => {
        db = createTestDb();
        stmts = buildStmts(db);
    });

    function insertPurchase(sessionId, discordId, email, product, amount, createdAt) {
        db.prepare(`
            INSERT INTO purchases (stripe_session_id, discord_user_id, customer_email, product_name, amount, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(sessionId, discordId, email, product, amount, createdAt);
    }

    function insertSession(createdAt, status = 'ended') {
        db.prepare(`INSERT INTO livestream_sessions (status, created_at) VALUES (?, ?)`).run(status, createdAt);
    }

    function insertBattle(createdAt, status = 'complete') {
        db.prepare(`INSERT INTO battles (product_slug, product_name, status, created_at) VALUES ('slug', 'Battle Pack', ?, ?)`).run(status, createdAt);
    }

    describe('getRangeStats', () => {
        it('returns zeros for empty range', () => {
            const stats = stmts.analytics.getRangeStats.get('2026-04-01', '2026-05-01');
            expect(stats.total_revenue).toBe(0);
            expect(stats.order_count).toBe(0);
            expect(stats.unique_buyers).toBe(0);
        });

        it('sums revenue and counts orders in range', () => {
            insertPurchase('s1', 'u1', 'a@b.com', 'Pack A', 2500, '2026-04-05T20:00:00');
            insertPurchase('s2', 'u2', 'c@d.com', 'Pack B', 3000, '2026-04-05T21:00:00');
            insertPurchase('s3', 'u1', 'a@b.com', 'Pack A', 2500, '2026-04-05T22:00:00');

            const stats = stmts.analytics.getRangeStats.get('2026-04-01', '2026-05-01');
            expect(stats.total_revenue).toBe(8000);
            expect(stats.order_count).toBe(3);
            expect(stats.unique_buyers).toBe(2);
        });

        it('excludes purchases outside range', () => {
            insertPurchase('s1', 'u1', 'a@b.com', 'Pack A', 2500, '2026-03-31T23:59:00');
            insertPurchase('s2', 'u2', 'c@d.com', 'Pack B', 3000, '2026-04-05T20:00:00');
            insertPurchase('s3', 'u3', 'e@f.com', 'Pack C', 1500, '2026-05-01T00:00:00');

            const stats = stmts.analytics.getRangeStats.get('2026-04-01', '2026-05-01');
            expect(stats.total_revenue).toBe(3000);
            expect(stats.order_count).toBe(1);
        });

        it('counts buyers by discord_user_id when available, email otherwise', () => {
            insertPurchase('s1', 'u1', 'a@b.com', 'Pack A', 1000, '2026-04-05T20:00:00');
            insertPurchase('s2', null, 'anon@test.com', 'Pack B', 1000, '2026-04-05T21:00:00');
            insertPurchase('s3', null, 'anon@test.com', 'Pack C', 1000, '2026-04-05T22:00:00');

            const stats = stmts.analytics.getRangeStats.get('2026-04-01', '2026-05-01');
            expect(stats.unique_buyers).toBe(2); // u1 + anon@test.com
        });
    });

    describe('getTopProducts', () => {
        it('returns products sorted by revenue descending', () => {
            insertPurchase('s1', 'u1', 'a@b.com', 'Cheap Pack', 500, '2026-04-05T20:00:00');
            insertPurchase('s2', 'u2', 'c@d.com', 'Expensive Box', 5000, '2026-04-05T21:00:00');
            insertPurchase('s3', 'u3', 'e@f.com', 'Cheap Pack', 500, '2026-04-05T22:00:00');

            const products = stmts.analytics.getTopProducts.all('2026-04-01', '2026-05-01');
            expect(products[0].product_name).toBe('Expensive Box');
            expect(products[0].revenue).toBe(5000);
            expect(products[1].product_name).toBe('Cheap Pack');
            expect(products[1].count).toBe(2);
            expect(products[1].revenue).toBe(1000);
        });

        it('limits to 5 products', () => {
            for (let i = 0; i < 7; i++) {
                insertPurchase(`s${i}`, `u${i}`, `${i}@b.com`, `Product ${i}`, (i + 1) * 100, '2026-04-05T20:00:00');
            }
            const products = stmts.analytics.getTopProducts.all('2026-04-01', '2026-05-01');
            expect(products.length).toBe(5);
        });
    });

    describe('getStreamCount', () => {
        it('counts sessions in range', () => {
            insertSession('2026-04-02T19:00:00');
            insertSession('2026-04-09T19:00:00');
            insertSession('2026-03-25T19:00:00'); // outside range

            const result = stmts.analytics.getStreamCount.get('2026-04-01', '2026-05-01');
            expect(result.count).toBe(2);
        });
    });

    describe('getNewBuyerCount', () => {
        it('identifies first-time buyers in range', () => {
            // Existing buyer from March
            insertPurchase('s0', 'u1', 'a@b.com', 'Pack', 1000, '2026-03-15T20:00:00');
            // Same buyer in April (returning)
            insertPurchase('s1', 'u1', 'a@b.com', 'Pack', 1000, '2026-04-05T20:00:00');
            // New buyer in April
            insertPurchase('s2', 'u2', 'c@d.com', 'Pack', 1000, '2026-04-05T21:00:00');

            const result = stmts.analytics.getNewBuyerCount.get('2026-04-01', '2026-05-01', '2026-04-01');
            expect(result.count).toBe(1); // only u2 is new
        });

        it('counts all buyers as new when no prior purchases', () => {
            insertPurchase('s1', 'u1', 'a@b.com', 'Pack', 1000, '2026-04-05T20:00:00');
            insertPurchase('s2', 'u2', 'c@d.com', 'Pack', 1000, '2026-04-05T21:00:00');

            const result = stmts.analytics.getNewBuyerCount.get('2026-04-01', '2026-05-01', '2026-04-01');
            expect(result.count).toBe(2);
        });
    });

    describe('getBattleCount', () => {
        it('counts only completed battles in range', () => {
            insertBattle('2026-04-05T20:00:00', 'complete');
            insertBattle('2026-04-05T21:00:00', 'cancelled');
            insertBattle('2026-04-12T20:00:00', 'complete');
            insertBattle('2026-03-20T20:00:00', 'complete'); // outside range

            const result = stmts.analytics.getBattleCount.get('2026-04-01', '2026-05-01');
            expect(result.count).toBe(2);
        });
    });
});
