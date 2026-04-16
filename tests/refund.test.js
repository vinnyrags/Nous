/**
 * Tests for !refund command — purchase lookup and refund flow.
 *
 * These tests cover the database-level behavior that the refund command relies on.
 * Stripe API interactions are tested via mock in integration tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';

let db, stmts;

beforeEach(() => {
    db = createTestDb();
    stmts = buildStmts(db);
});

// =========================================================================
// User-based refund (most recent purchase lookup)
// =========================================================================

describe('user-based refund lookup', () => {
    it('getRecentByDiscordId returns the most recent purchase', () => {
        stmts.purchases.insertPurchase.run('cs_first', 'discord1', 'user@test.com', 'Product A', 2000);
        stmts.purchases.insertPurchase.run('cs_second', 'discord1', 'user@test.com', 'Product B', 3000);

        const recent = stmts.purchases.getRecentByDiscordId.get('discord1');
        expect(recent.stripe_session_id).toBe('cs_second');
        expect(recent.product_name).toBe('Product B');
        expect(recent.amount).toBe(3000);
    });

    it('returns undefined when user has no purchases', () => {
        const recent = stmts.purchases.getRecentByDiscordId.get('no-purchases');
        expect(recent).toBeUndefined();
    });
});

// =========================================================================
// Session-based refund (specific session lookup)
// =========================================================================

describe('session-based refund lookup', () => {
    it('getBySessionId returns matching purchase', () => {
        stmts.purchases.insertPurchase.run('cs_target', 'discord1', 'user@test.com', 'Target Product', 5000);
        stmts.purchases.insertPurchase.run('cs_other', 'discord1', 'user@test.com', 'Other Product', 2000);

        const purchase = stmts.purchases.getBySessionId.get('cs_target');
        expect(purchase).toBeDefined();
        expect(purchase.product_name).toBe('Target Product');
        expect(purchase.amount).toBe(5000);
    });

    it('returns undefined for unknown session', () => {
        const purchase = stmts.purchases.getBySessionId.get('cs_nonexistent');
        expect(purchase).toBeUndefined();
    });
});

// =========================================================================
// Refund amount parsing scenarios
// =========================================================================

describe('refund amount scenarios', () => {
    it('full refund — purchase amount available for reference', () => {
        stmts.purchases.insertPurchase.run('cs_full', 'discord1', 'user@test.com', 'Full Refund Product', 4500);

        const purchase = stmts.purchases.getBySessionId.get('cs_full');
        expect(purchase.amount).toBe(4500);
        // Full refund: no amount specified → Stripe refunds the full PaymentIntent amount
    });

    it('partial refund — amount less than purchase total', () => {
        stmts.purchases.insertPurchase.run('cs_partial', 'discord1', 'user@test.com', 'Partial Product', 5000);

        const purchase = stmts.purchases.getBySessionId.get('cs_partial');
        // Partial refund: $10.00 (1000 cents) out of $50.00 (5000 cents)
        const partialAmount = 1000;
        expect(partialAmount).toBeLessThan(purchase.amount);
    });
});

// =========================================================================
// Edge cases
// =========================================================================

describe('edge cases', () => {
    it('multiple purchases by same user — only most recent returned', () => {
        stmts.purchases.insertPurchase.run('cs_old', 'discord1', 'user@test.com', 'Old Product', 1000);
        stmts.purchases.insertPurchase.run('cs_mid', 'discord1', 'user@test.com', 'Mid Product', 2000);
        stmts.purchases.insertPurchase.run('cs_new', 'discord1', 'user@test.com', 'New Product', 3000);

        const recent = stmts.purchases.getRecentByDiscordId.get('discord1');
        expect(recent.stripe_session_id).toBe('cs_new');
    });

    it('purchases by different users are independent', () => {
        stmts.purchases.insertPurchase.run('cs_user1', 'discord1', 'user1@test.com', 'Product 1', 1000);
        stmts.purchases.insertPurchase.run('cs_user2', 'discord2', 'user2@test.com', 'Product 2', 2000);

        const recent1 = stmts.purchases.getRecentByDiscordId.get('discord1');
        const recent2 = stmts.purchases.getRecentByDiscordId.get('discord2');

        expect(recent1.stripe_session_id).toBe('cs_user1');
        expect(recent2.stripe_session_id).toBe('cs_user2');
    });
});
