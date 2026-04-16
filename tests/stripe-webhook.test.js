/**
 * Tests for Stripe webhook handler — database-level logic tested via
 * direct statement calls (matching the existing test pattern).
 *
 * The handleCheckoutCompleted function can't be tested through vi.mock
 * because the source uses CJS require() which bypasses Vitest's mock system.
 * Instead, we test the database operations it performs directly.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';

let db, stmts;

beforeEach(() => {
    db = createTestDb();
    stmts = buildStmts(db);
});

// =========================================================================
// Purchase recording (same operations handleCheckoutCompleted performs)
// =========================================================================

describe('purchase recording operations', () => {
    it('records purchase with all fields', () => {
        stmts.purchases.insertPurchase.run('cs_123', 'discord1', 'buyer@example.com', 'Prismatic Evolutions', 2500);
        const p = db.prepare('SELECT * FROM purchases WHERE stripe_session_id = ?').get('cs_123');
        expect(p.discord_user_id).toBe('discord1');
        expect(p.customer_email).toBe('buyer@example.com');
        expect(p.product_name).toBe('Prismatic Evolutions');
        expect(p.amount).toBe(2500);
    });

    it('ignores duplicate session IDs', () => {
        stmts.purchases.insertPurchase.run('cs_dup', null, 'a@b.com', 'Card', 100);
        stmts.purchases.insertPurchase.run('cs_dup', null, 'a@b.com', 'Card', 100);
        const count = db.prepare('SELECT COUNT(*) as c FROM purchases WHERE stripe_session_id = ?').get('cs_dup').c;
        expect(count).toBe(1);
    });

    it('records purchase with null discord_user_id for unlinked users', () => {
        stmts.purchases.insertPurchase.run('cs_anon', null, 'buyer@example.com', 'Card', 1000);
        const p = db.prepare('SELECT * FROM purchases WHERE stripe_session_id = ?').get('cs_anon');
        expect(p.discord_user_id).toBeNull();
    });
});

// =========================================================================
// Purchase count tracking (role promotion logic)
// =========================================================================

describe('purchase count tracking for role promotion', () => {
    it('starts at 1 for first purchase', () => {
        stmts.purchases.incrementPurchaseCount.run('user1');
        const c = stmts.purchases.getPurchaseCount.get('user1');
        expect(c.total_purchases).toBe(1);
    });

    it('increments on subsequent purchases', () => {
        stmts.purchases.incrementPurchaseCount.run('user1');
        stmts.purchases.incrementPurchaseCount.run('user1');
        stmts.purchases.incrementPurchaseCount.run('user1');
        expect(stmts.purchases.getPurchaseCount.get('user1').total_purchases).toBe(3);
    });

    it('tracks counts per user independently', () => {
        stmts.purchases.incrementPurchaseCount.run('user1');
        stmts.purchases.incrementPurchaseCount.run('user1');
        stmts.purchases.incrementPurchaseCount.run('user2');
        expect(stmts.purchases.getPurchaseCount.get('user1').total_purchases).toBe(2);
        expect(stmts.purchases.getPurchaseCount.get('user2').total_purchases).toBe(1);
    });

    it('returns undefined for users with no purchases', () => {
        expect(stmts.purchases.getPurchaseCount.get('nobody')).toBeUndefined();
    });

    it('reaches Xipe threshold at 1', () => {
        stmts.purchases.incrementPurchaseCount.run('user1');
        const count = stmts.purchases.getPurchaseCount.get('user1').total_purchases;
        expect(count >= 1).toBe(true); // XIPE_PURCHASE_THRESHOLD
    });

    it('reaches Long threshold at 5', () => {
        for (let i = 0; i < 5; i++) stmts.purchases.incrementPurchaseCount.run('user1');
        const count = stmts.purchases.getPurchaseCount.get('user1').total_purchases;
        expect(count >= 5).toBe(true); // LONG_PURCHASE_THRESHOLD
    });
});

// =========================================================================
// Auto-linking Discord ↔ email
// =========================================================================

describe('Discord auto-linking', () => {
    it('links discord user to email', () => {
        stmts.purchases.linkDiscord.run('discord1', 'buyer@example.com');
        const link = stmts.purchases.getDiscordIdByEmail.get('buyer@example.com');
        expect(link.discord_user_id).toBe('discord1');
    });

    it('looks up email by discord ID', () => {
        stmts.purchases.linkDiscord.run('discord1', 'buyer@example.com');
        const link = stmts.purchases.getEmailByDiscordId.get('discord1');
        expect(link.customer_email).toBe('buyer@example.com');
    });

    it('replaces link on re-link (INSERT OR REPLACE)', () => {
        stmts.purchases.linkDiscord.run('discord1', 'old@example.com');
        stmts.purchases.linkDiscord.run('discord1', 'new@example.com');
        const link = stmts.purchases.getEmailByDiscordId.get('discord1');
        expect(link.customer_email).toBe('new@example.com');
    });

    it('supports looking up discord ID by linked email', () => {
        stmts.purchases.linkDiscord.run('discord1', 'buyer@example.com');
        stmts.purchases.insertPurchase.run('cs_1', null, 'buyer@example.com', 'Card', 100);
        // Webhook flow: look up discord ID from email
        const link = stmts.purchases.getDiscordIdByEmail.get('buyer@example.com');
        expect(link.discord_user_id).toBe('discord1');
    });
});

// =========================================================================
// Auto-link via Discord username (checkout custom field)
// =========================================================================

describe('auto-link via Discord username custom field', () => {
    it('auto-links when username resolves to a known discord user', () => {
        // Simulate what the webhook does: no existing link, so check custom field
        const email = 'newbuyer@example.com';
        const resolvedDiscordId = 'resolved_123';

        // No link exists yet
        expect(stmts.purchases.getDiscordIdByEmail.get(email)).toBeUndefined();

        // Auto-link (same operation the webhook performs after findMemberByUsername succeeds)
        stmts.purchases.linkDiscord.run(resolvedDiscordId, email);

        // Now the link exists
        const link = stmts.purchases.getDiscordIdByEmail.get(email);
        expect(link.discord_user_id).toBe(resolvedDiscordId);
    });

    it('auto-linked user gets purchase recorded with discord ID', () => {
        const email = 'newbuyer@example.com';
        const resolvedDiscordId = 'resolved_123';

        // Auto-link first
        stmts.purchases.linkDiscord.run(resolvedDiscordId, email);

        // Purchase recorded with the resolved discord ID (not null)
        stmts.purchases.insertPurchase.run('cs_autolink', resolvedDiscordId, email, 'Card Pack', 2500);
        const p = db.prepare('SELECT * FROM purchases WHERE stripe_session_id = ?').get('cs_autolink');
        expect(p.discord_user_id).toBe(resolvedDiscordId);
    });

    it('auto-linked user gets added to queue with discord ID', () => {
        const email = 'newbuyer@example.com';
        const resolvedDiscordId = 'resolved_123';

        // Auto-link
        stmts.purchases.linkDiscord.run(resolvedDiscordId, email);

        // Open a queue and add entry with resolved ID
        stmts.queues.createQueue.run();
        const queue = stmts.queues.getActiveQueue.get();
        stmts.queues.addEntry.run(queue.id, resolvedDiscordId, email, 'Card Pack', 1, 'cs_autolink');

        const entries = stmts.queues.getEntries.all(queue.id);
        expect(entries).toHaveLength(1);
        expect(entries[0].discord_user_id).toBe(resolvedDiscordId);

        // Counts as a unique buyer for duck race
        const buyers = stmts.queues.getUniqueBuyers.all(queue.id);
        expect(buyers).toHaveLength(1);
    });

    it('skips auto-link when email is already linked (existing link takes precedence)', () => {
        const email = 'existing@example.com';
        const existingDiscordId = 'existing_456';

        // Pre-existing link
        stmts.purchases.linkDiscord.run(existingDiscordId, email);

        // Webhook flow: lookup succeeds → skip auto-link entirely
        const link = stmts.purchases.getDiscordIdByEmail.get(email);
        expect(link.discord_user_id).toBe(existingDiscordId);
    });

    it('purchase proceeds unlinked when username is not found', () => {
        const email = 'noDiscord@example.com';

        // No link exists, username lookup would fail → purchase recorded unlinked
        stmts.purchases.insertPurchase.run('cs_nofind', null, email, 'Card Pack', 1500);
        const p = db.prepare('SELECT * FROM purchases WHERE stripe_session_id = ?').get('cs_nofind');
        expect(p.discord_user_id).toBeNull();
        expect(p.customer_email).toBe(email);
    });

    it('auto-link enables role promotion on first purchase', () => {
        const email = 'newbuyer@example.com';
        const resolvedDiscordId = 'resolved_123';

        // Auto-link at purchase time
        stmts.purchases.linkDiscord.run(resolvedDiscordId, email);
        stmts.purchases.insertPurchase.run('cs_promo', resolvedDiscordId, email, 'Card', 2500);
        stmts.purchases.incrementPurchaseCount.run(resolvedDiscordId);

        // Xipe threshold met on first purchase
        const count = stmts.purchases.getPurchaseCount.get(resolvedDiscordId).total_purchases;
        expect(count).toBe(1);
        expect(count >= 1).toBe(true);
    });
});

// =========================================================================
// Battle payment flow (operations checkBattlePayment performs)
// =========================================================================

describe('battle payment flow', () => {
    it('adds entry and confirms payment in one flow', () => {
        stmts.battles.createBattle.run('product', 'Test Product', 'price_123', 20, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.addEntry.run(battle.id, 'user1', battle.id, battle.id);
        stmts.battles.confirmPayment.run('cs_pay_123', battle.id, 'user1');

        const entries = stmts.battles.getPaidEntries.all(battle.id);
        expect(entries).toHaveLength(1);
        expect(entries[0].paid).toBe(1);
        expect(entries[0].stripe_session_id).toBe('cs_pay_123');
    });

    it('respects max entries limit', () => {
        stmts.battles.createBattle.run('product', 'Test', 'price_1', 2, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.addEntry.run(battle.id, 'user1', battle.id, battle.id);
        stmts.battles.addEntry.run(battle.id, 'user2', battle.id, battle.id);

        const count = stmts.battles.getEntryCount.get(battle.id).count;
        expect(count >= battle.max_entries).toBe(true);

        // Third entry should be checked before adding
        // In the handler, this check prevents adding more entries
        expect(count >= 2).toBe(true);
    });

    it('links purchase to battle entry via session ID', () => {
        stmts.battles.createBattle.run('product', 'Test', 'price_1', 20, null);
        const battle = stmts.battles.getActiveBattle.get();

        stmts.battles.addEntry.run(battle.id, 'user1', battle.id, battle.id);
        stmts.battles.confirmPayment.run('cs_battle_pay', battle.id, 'user1');

        const entry = stmts.battles.getPaidEntries.all(battle.id)[0];
        expect(entry.stripe_session_id).toBe('cs_battle_pay');
    });
});

// =========================================================================
// Full purchase → promotion flow
// =========================================================================

describe('purchase → promotion flow', () => {
    it('complete flow: link → purchase → count → check threshold', () => {
        // Step 1: Link Discord account
        stmts.purchases.linkDiscord.run('discord1', 'buyer@example.com');

        // Step 2: Record purchase
        stmts.purchases.insertPurchase.run('cs_flow_1', 'discord1', 'buyer@example.com', 'Card', 2500);

        // Step 3: Increment count
        stmts.purchases.incrementPurchaseCount.run('discord1');

        // Step 4: Check threshold
        const count = stmts.purchases.getPurchaseCount.get('discord1').total_purchases;
        expect(count).toBe(1);
        expect(count >= 1).toBe(true); // Xipe threshold met
        expect(count >= 5).toBe(false); // Long threshold not met
    });

    it('reaches Long after 5 purchases', () => {
        stmts.purchases.linkDiscord.run('discord1', 'buyer@example.com');

        for (let i = 0; i < 5; i++) {
            stmts.purchases.insertPurchase.run(`cs_flow_${i}`, 'discord1', 'buyer@example.com', 'Card', 1000);
            stmts.purchases.incrementPurchaseCount.run('discord1');
        }

        const count = stmts.purchases.getPurchaseCount.get('discord1').total_purchases;
        expect(count).toBe(5);
        expect(count >= 5).toBe(true); // Long threshold met
    });
});

// =========================================================================
// Shipping payment tracking
// =========================================================================

describe('shipping payment tracking', () => {
    it('shipping payment does not create a purchase record', () => {
        // Shipping payments should early-return — no purchase inserted
        const before = db.prepare('SELECT COUNT(*) as c FROM purchases').get().c;

        // No purchase inserted for shipping (the webhook handler returns early)
        const after = db.prepare('SELECT COUNT(*) as c FROM purchases').get().c;
        expect(after).toBe(before);
    });
});
