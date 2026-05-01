/**
 * Refund Propagator — Unit Tests
 *
 * Verifies the unified refund propagator against scenarios that the manual
 * !refund tests don't cover:
 *   - Stripe Dashboard refund (webhook_refund) source labeling
 *   - Stripe dispute (webhook_dispute) skips the buyer DM
 *   - Idempotency on re-run (refunded_at preserved)
 *   - WP queue mirror called with the right shape
 *   - No purchase row → propagator still posts ops embed
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, buildStmts } from './setup.js';

const mockSendEmbed = vi.fn().mockResolvedValue(null);
const mockGetMember = vi.fn().mockImplementation((userId) =>
    Promise.resolve({
        id: userId,
        user: { tag: `user#${userId}` },
        createDM: vi.fn().mockResolvedValue({ send: vi.fn().mockResolvedValue({}) }),
    })
);

vi.mock('../discord.js', () => ({
    sendEmbed: (...args) => mockSendEmbed(...args),
    getMember: (...args) => mockGetMember(...args),
}));

vi.mock('../config.js', () => ({
    default: {
        SHOP_URL: 'https://itzenzo.tv',
    },
}));

const mockCancelShippingEasy = vi.fn();
vi.mock('../shippingeasy-api.js', () => ({
    cancelOrder: (...args) => mockCancelShippingEasy(...args),
}));

const mockMarkEntryRefundedBySession = vi.fn();
vi.mock('../lib/queue-source.js', () => ({
    markEntryRefundedBySession: (...args) => mockMarkEntryRefundedBySession(...args),
}));

vi.mock('../db.js', () => ({
    db: null,
    purchases: {},
}));

const dbModule = await import('../db.js');
let db, stmts;

beforeEach(() => {
    db = createTestDb();
    stmts = buildStmts(db);
    dbModule.db = db;
    Object.assign(dbModule.purchases, stmts.purchases);
    vi.clearAllMocks();

    mockCancelShippingEasy.mockResolvedValue(true);
    mockMarkEntryRefundedBySession.mockResolvedValue({ entry: { id: 'q_1', status: 'refunded' }, duplicate: false });
});

const { propagateRefund } = await import('../lib/refund-propagator.js');

function seed({ sessionId, discordId = 'buyer1', amount = 5000, seOrderId = null, shippedAt = null, productName = 'Box' }) {
    stmts.purchases.insertPurchase.run(sessionId, discordId, 'buyer@example.com', productName, amount);
    if (seOrderId) stmts.purchases.setShippingEasyOrderId.run(seOrderId, sessionId);
    if (shippedAt) {
        db.prepare('UPDATE purchases SET shipped_at = ? WHERE stripe_session_id = ?').run(shippedAt, sessionId);
    }
}

function getPurchase(sessionId) {
    return stmts.purchases.getBySessionId.get(sessionId);
}

// =========================================================================
// Stripe Dashboard refund (webhook source)
// =========================================================================

describe('webhook_refund source', () => {
    it('marks purchases.refunded_at + refund_amount + reason', async () => {
        seed({ sessionId: 'cs_dash', amount: 5000 });

        await propagateRefund('cs_dash', {
            source: 'webhook_refund',
            amountCents: null, // null means full refund
            reason: 'requested_by_customer',
            refundId: 're_dashboard_1',
        });

        const updated = getPurchase('cs_dash');
        expect(updated.refunded_at).toBeTruthy();
        expect(updated.refund_amount).toBeNull();
        expect(updated.refund_reason).toBe('requested_by_customer');
    });

    it('mirrors the refund to the unified queue', async () => {
        seed({ sessionId: 'cs_q', amount: 5000 });

        await propagateRefund('cs_q', {
            source: 'webhook_refund',
            amountCents: 5000,
            reason: null,
        });

        expect(mockMarkEntryRefundedBySession).toHaveBeenCalledOnce();
        expect(mockMarkEntryRefundedBySession).toHaveBeenCalledWith('cs_q', expect.objectContaining({
            refundAmountCents: 5000,
            isPartial: false,
        }));
    });

    it('flags partial refunds when amount < original', async () => {
        seed({ sessionId: 'cs_partial', amount: 5000 });

        await propagateRefund('cs_partial', {
            source: 'webhook_refund',
            amountCents: 1000,
            reason: 'damaged-card-credit',
        });

        expect(mockMarkEntryRefundedBySession).toHaveBeenCalledWith('cs_partial', expect.objectContaining({
            refundAmountCents: 1000,
            isPartial: true,
        }));
    });

    it('does NOT cancel ShippingEasy on partial refund', async () => {
        seed({ sessionId: 'cs_partial_se', amount: 5000, seOrderId: 'se_777' });

        await propagateRefund('cs_partial_se', {
            source: 'webhook_refund',
            amountCents: 1000,
        });

        expect(mockCancelShippingEasy).not.toHaveBeenCalled();
    });

    it('cancels ShippingEasy on full unshipped refund', async () => {
        seed({ sessionId: 'cs_full_se', amount: 5000, seOrderId: 'se_888' });

        await propagateRefund('cs_full_se', {
            source: 'webhook_refund',
            amountCents: null,
        });

        expect(mockCancelShippingEasy).toHaveBeenCalledOnce();
    });

    it('DMs the buyer when Discord-linked', async () => {
        seed({ sessionId: 'cs_dm', amount: 5000 });
        const dmSend = vi.fn().mockResolvedValue({});
        mockGetMember.mockResolvedValueOnce({
            createDM: vi.fn().mockResolvedValue({ send: dmSend }),
        });

        await propagateRefund('cs_dm', { source: 'webhook_refund', amountCents: 5000 });

        expect(dmSend).toHaveBeenCalledOnce();
    });

    it('posts the ops embed with Stripe Dashboard source label', async () => {
        seed({ sessionId: 'cs_ops', amount: 5000 });

        await propagateRefund('cs_ops', {
            source: 'webhook_refund',
            amountCents: 5000,
            refundId: 're_xyz',
        });

        const opsCall = mockSendEmbed.mock.calls.find((c) => c[0] === 'OPS');
        expect(opsCall).toBeDefined();
        expect(opsCall[1].description).toContain('Stripe Dashboard / API');
        expect(opsCall[1].description).toContain('re_xyz');
    });
});

// =========================================================================
// Stripe dispute — adversarial, no buyer DM
// =========================================================================

describe('webhook_dispute source', () => {
    it('does NOT DM the buyer', async () => {
        seed({ sessionId: 'cs_dispute', amount: 5000 });
        const dmSend = vi.fn().mockResolvedValue({});
        mockGetMember.mockResolvedValueOnce({
            createDM: vi.fn().mockResolvedValue({ send: dmSend }),
        });

        await propagateRefund('cs_dispute', {
            source: 'webhook_dispute',
            amountCents: 5000,
            reason: 'Dispute fraudulent — needs_response',
        });

        expect(dmSend).not.toHaveBeenCalled();
    });

    it('still propagates to queue + ops embed', async () => {
        seed({ sessionId: 'cs_dispute_full', amount: 5000 });

        await propagateRefund('cs_dispute_full', {
            source: 'webhook_dispute',
            amountCents: 5000,
        });

        expect(mockMarkEntryRefundedBySession).toHaveBeenCalledOnce();
        const opsCall = mockSendEmbed.mock.calls.find((c) => c[0] === 'OPS');
        expect(opsCall[1].description).toContain('Stripe dispute');
    });
});

// =========================================================================
// Idempotency
// =========================================================================

describe('idempotency', () => {
    it('preserves the original refunded_at on re-run', async () => {
        seed({ sessionId: 'cs_idem', amount: 5000 });

        await propagateRefund('cs_idem', { source: 'webhook_refund', amountCents: 5000 });
        const first = getPurchase('cs_idem').refunded_at;

        // Wait a tick then re-run
        await new Promise(r => setTimeout(r, 1100));
        await propagateRefund('cs_idem', { source: 'webhook_refund', amountCents: 5000 });
        const second = getPurchase('cs_idem').refunded_at;

        expect(second).toBe(first);
    });
});

// =========================================================================
// Anonymous refund — no purchase row in our DB
// =========================================================================

describe('no purchase row', () => {
    it('still posts the ops embed with unknown product', async () => {
        // No seedPurchase
        await propagateRefund('cs_ghost', { source: 'webhook_refund', amountCents: 1000 });

        const opsCall = mockSendEmbed.mock.calls.find((c) => c[0] === 'OPS');
        expect(opsCall).toBeDefined();
        expect(opsCall[1].description).toContain('Unknown');
    });

    it('does not crash on missing purchase row', async () => {
        await expect(
            propagateRefund('cs_ghost_2', { source: 'webhook_refund', amountCents: 1000 })
        ).resolves.toMatchObject({ ok: true });
    });

    it('does not call ShippingEasy when no purchase row', async () => {
        await propagateRefund('cs_ghost_3', { source: 'webhook_refund', amountCents: 1000 });
        expect(mockCancelShippingEasy).not.toHaveBeenCalled();
    });
});
