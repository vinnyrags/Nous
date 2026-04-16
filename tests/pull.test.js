/**
 * Tests for !pull command — pull box listings and purchase counting.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';

let db, stmts;

beforeEach(() => {
    db = createTestDb();
    stmts = buildStmts(db);
});

// =========================================================================
// Pull box creation
// =========================================================================

describe('pull box creation', () => {
    it('creates a listing with status pull', () => {
        stmts.cardListings.create.run('Mystery Pull Box', 300, null, 'pull');

        const pull = stmts.cardListings.getByStatus.get('pull');
        expect(pull).toBeDefined();
        expect(pull.card_name).toBe('Mystery Pull Box');
        expect(pull.price).toBe(300);
        expect(pull.status).toBe('pull');
        expect(pull.purchase_count).toBe(0);
    });

    it('getByStatus returns null when no active pull', () => {
        const pull = stmts.cardListings.getByStatus.get('pull');
        expect(pull).toBeUndefined();
    });

    it('getByStatus returns the most recent pull', () => {
        stmts.cardListings.create.run('Old Pull', 100, null, 'pull');
        const old = stmts.cardListings.getByStatus.get('pull');
        stmts.cardListings.markSold.run(old.id);

        stmts.cardListings.create.run('New Pull', 200, null, 'pull');
        const pull = stmts.cardListings.getByStatus.get('pull');
        expect(pull.card_name).toBe('New Pull');
    });
});

// =========================================================================
// Purchase counting
// =========================================================================

describe('purchase counting', () => {
    it('incrementPurchaseCount increases count by 1', () => {
        stmts.cardListings.create.run('Pull Box', 300, null, 'pull');
        const pull = stmts.cardListings.getByStatus.get('pull');

        stmts.cardListings.incrementPurchaseCount.run(pull.id);
        const updated = stmts.cardListings.getById.get(pull.id);
        expect(updated.purchase_count).toBe(1);
    });

    it('accumulates across multiple purchases', () => {
        stmts.cardListings.create.run('Pull Box', 300, null, 'pull');
        const pull = stmts.cardListings.getByStatus.get('pull');

        stmts.cardListings.incrementPurchaseCount.run(pull.id);
        stmts.cardListings.incrementPurchaseCount.run(pull.id);
        stmts.cardListings.incrementPurchaseCount.run(pull.id);

        const updated = stmts.cardListings.getById.get(pull.id);
        expect(updated.purchase_count).toBe(3);
    });

    it('does not affect other listings', () => {
        stmts.cardListings.create.run('Pull Box', 300, null, 'pull');
        stmts.cardListings.create.run('Regular Card', 2500, null, 'active');

        const pull = stmts.cardListings.getByStatus.get('pull');
        stmts.cardListings.incrementPurchaseCount.run(pull.id);

        const active = stmts.cardListings.getByStatus.get('active');
        expect(active.purchase_count).toBe(0);
    });
});

// =========================================================================
// Closing a pull box
// =========================================================================

describe('closing a pull box', () => {
    it('markSold changes status from pull to sold', () => {
        stmts.cardListings.create.run('Pull Box', 300, null, 'pull');
        const pull = stmts.cardListings.getByStatus.get('pull');

        stmts.cardListings.markSold.run(pull.id);

        const closed = stmts.cardListings.getById.get(pull.id);
        expect(closed.status).toBe('sold');
        expect(closed.sold_at).toBeTruthy();
    });

    it('getByStatus returns nothing after closing', () => {
        stmts.cardListings.create.run('Pull Box', 300, null, 'pull');
        const pull = stmts.cardListings.getByStatus.get('pull');
        stmts.cardListings.markSold.run(pull.id);

        expect(stmts.cardListings.getByStatus.get('pull')).toBeUndefined();
    });

    it('purchase count persists after closing', () => {
        stmts.cardListings.create.run('Pull Box', 300, null, 'pull');
        const pull = stmts.cardListings.getByStatus.get('pull');

        stmts.cardListings.incrementPurchaseCount.run(pull.id);
        stmts.cardListings.incrementPurchaseCount.run(pull.id);
        stmts.cardListings.markSold.run(pull.id);

        const closed = stmts.cardListings.getById.get(pull.id);
        expect(closed.purchase_count).toBe(2);
    });
});

// =========================================================================
// Pull box does not interfere with regular card listings
// =========================================================================

describe('pull box isolation', () => {
    it('regular card listings still work alongside pull boxes', () => {
        stmts.cardListings.create.run('Pull Box', 300, null, 'pull');
        stmts.cardListings.create.run('Rare Card', 5000, 'buyer1', 'reserved');

        const pull = stmts.cardListings.getByStatus.get('pull');
        const reserved = stmts.cardListings.getByStatus.get('reserved');

        expect(pull.card_name).toBe('Pull Box');
        expect(reserved.card_name).toBe('Rare Card');
    });
});
