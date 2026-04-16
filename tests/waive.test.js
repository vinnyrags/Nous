/**
 * Tests for !waive command — shipping waiver and refund logic.
 *
 * These tests cover the database-level behavior that the waive command relies on.
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
// Pre-waiver path (buyer hasn't paid yet)
// =========================================================================

describe('pre-waiver', () => {
    it('inserts a waiver record with amount=0 and source=waiver', () => {
        stmts.shipping.record.run('user@test.com', 'discord1', 0, 'waiver', null);

        const records = stmts.shipping.getThisWeek.all();
        expect(records).toHaveLength(1);
        expect(records[0].amount).toBe(0);
        expect(records[0].source).toBe('waiver');
    });

    it('hasShippingThisWeek returns truthy after waiver', () => {
        stmts.shipping.record.run('user@test.com', 'discord1', 0, 'waiver', null);

        expect(stmts.shipping.hasShippingThisWeek.get('user@test.com')).toBeTruthy();
    });

    it('hasShippingThisMonth returns truthy after waiver', () => {
        stmts.shipping.record.run('user@test.com', 'discord1', 0, 'waiver', null);

        expect(stmts.shipping.hasShippingThisMonth.get('user@test.com')).toBeTruthy();
    });

    it('waiver does not affect other buyers', () => {
        stmts.shipping.record.run('user1@test.com', 'discord1', 0, 'waiver', null);

        expect(stmts.shipping.hasShippingThisWeek.get('user1@test.com')).toBeTruthy();
        expect(stmts.shipping.hasShippingThisWeek.get('user2@test.com')).toBeUndefined();
    });
});

// =========================================================================
// Refund path (buyer already paid — database operations)
// =========================================================================

describe('refund path (database)', () => {
    it('getByEmailThisWeek returns record with stripe_session_id', () => {
        stmts.shipping.record.run('user@test.com', 'discord1', 1000, 'checkout', 'cs_test_abc');

        const record = stmts.shipping.getByEmailThisWeek.get('user@test.com');
        expect(record).toBeDefined();
        expect(record.stripe_session_id).toBe('cs_test_abc');
        expect(record.amount).toBe(1000);
    });

    it('deleteById removes the shipping record after refund', () => {
        stmts.shipping.record.run('user@test.com', 'discord1', 1000, 'checkout', 'cs_test_abc');

        const record = stmts.shipping.getByEmailThisWeek.get('user@test.com');
        stmts.shipping.deleteById.run(record.id);

        // Buyer is no longer covered
        expect(stmts.shipping.hasShippingThisWeek.get('user@test.com')).toBeUndefined();
    });

    it('legacy record without stripe_session_id', () => {
        stmts.shipping.record.run('user@test.com', 'discord1', 1000, 'checkout', null);

        const record = stmts.shipping.getByEmailThisWeek.get('user@test.com');
        expect(record).toBeDefined();
        expect(record.stripe_session_id).toBeNull();
    });
});

// =========================================================================
// Email lookup prerequisite
// =========================================================================

describe('email lookup', () => {
    it('getEmailByDiscordId returns linked email', () => {
        stmts.purchases.linkDiscord.run('discord1', 'user@test.com');

        const link = stmts.purchases.getEmailByDiscordId.get('discord1');
        expect(link.customer_email).toBe('user@test.com');
    });

    it('getEmailByDiscordId returns undefined for unlinked user', () => {
        const link = stmts.purchases.getEmailByDiscordId.get('unknown');
        expect(link).toBeUndefined();
    });
});
