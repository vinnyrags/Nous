import { describe, it, expect, vi } from 'vitest';
import {
    resolveSessionIdFromCharge,
    retrieveCharge,
    retrieveSessionWithPaymentIntent,
    createRefund,
} from './refunds.js';

function fakeStripe() {
    return {
        checkout: {
            sessions: {
                list: vi.fn().mockResolvedValue({ data: [{ id: 'cs_resolved' }] }),
                retrieve: vi.fn().mockResolvedValue({ id: 'cs_1', payment_intent: { id: 'pi_1' } }),
            },
        },
        charges: { retrieve: vi.fn().mockResolvedValue({ id: 'ch_1' }) },
        refunds: { create: vi.fn().mockResolvedValue({ id: 're_1', amount: 500 }) },
    };
}

// =========================================================================
// resolveSessionIdFromCharge
// =========================================================================

describe('resolveSessionIdFromCharge', () => {
    it('looks up the session by string payment_intent and returns its id', async () => {
        const stripe = fakeStripe();
        const id = await resolveSessionIdFromCharge(stripe, { payment_intent: 'pi_x' });
        expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({ payment_intent: 'pi_x', limit: 1 });
        expect(id).toBe('cs_resolved');
    });

    it('expands an embedded payment_intent object to its id', async () => {
        const stripe = fakeStripe();
        await resolveSessionIdFromCharge(stripe, { payment_intent: { id: 'pi_embedded' } });
        expect(stripe.checkout.sessions.list).toHaveBeenCalledWith({ payment_intent: 'pi_embedded', limit: 1 });
    });

    it('returns null and skips the API call when payment_intent is missing', async () => {
        const stripe = fakeStripe();
        const id = await resolveSessionIdFromCharge(stripe, {});
        expect(id).toBeNull();
        expect(stripe.checkout.sessions.list).not.toHaveBeenCalled();
    });

    it('returns null when no session matches', async () => {
        const stripe = fakeStripe();
        stripe.checkout.sessions.list.mockResolvedValueOnce({ data: [] });
        expect(await resolveSessionIdFromCharge(stripe, { payment_intent: 'pi_x' })).toBeNull();
    });

    it('returns null on a Stripe API error (does not throw)', async () => {
        const stripe = fakeStripe();
        stripe.checkout.sessions.list.mockRejectedValueOnce(new Error('Stripe down'));
        expect(await resolveSessionIdFromCharge(stripe, { payment_intent: 'pi_x' })).toBeNull();
    });
});

// =========================================================================
// retrieveCharge / retrieveSessionWithPaymentIntent
// =========================================================================

describe('retrieveCharge', () => {
    it('retrieves the charge by id', async () => {
        const stripe = fakeStripe();
        const charge = await retrieveCharge(stripe, 'ch_disputed');
        expect(stripe.charges.retrieve).toHaveBeenCalledWith('ch_disputed');
        expect(charge.id).toBe('ch_1');
    });

    it('propagates Stripe errors', async () => {
        const stripe = fakeStripe();
        stripe.charges.retrieve.mockRejectedValueOnce(new Error('not found'));
        await expect(retrieveCharge(stripe, 'ch_x')).rejects.toThrow('not found');
    });
});

describe('retrieveSessionWithPaymentIntent', () => {
    it('retrieves the session with payment_intent expanded', async () => {
        const stripe = fakeStripe();
        const session = await retrieveSessionWithPaymentIntent(stripe, 'cs_target');
        expect(stripe.checkout.sessions.retrieve).toHaveBeenCalledWith('cs_target', { expand: ['payment_intent'] });
        expect(session.payment_intent.id).toBe('pi_1');
    });
});

// =========================================================================
// createRefund — param construction contract
// =========================================================================

describe('createRefund', () => {
    it('refunds the full PaymentIntent when no amount/reason given', async () => {
        const stripe = fakeStripe();
        await createRefund(stripe, { paymentIntentId: 'pi_1' });
        expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_1' });
    });

    it('adds amount for a partial refund', async () => {
        const stripe = fakeStripe();
        await createRefund(stripe, { paymentIntentId: 'pi_1', amountCents: 1500 });
        expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_1', amount: 1500 });
    });

    it('omits a zero amount (treated as full refund)', async () => {
        const stripe = fakeStripe();
        await createRefund(stripe, { paymentIntentId: 'pi_1', amountCents: 0 });
        expect(stripe.refunds.create).toHaveBeenCalledWith({ payment_intent: 'pi_1' });
    });

    it('adds reason metadata when given', async () => {
        const stripe = fakeStripe();
        await createRefund(stripe, { paymentIntentId: 'pi_1', reason: 'dinged_card' });
        expect(stripe.refunds.create).toHaveBeenCalledWith({
            payment_intent: 'pi_1',
            metadata: { reason: 'dinged_card' },
        });
    });

    it('combines amount and reason', async () => {
        const stripe = fakeStripe();
        await createRefund(stripe, { paymentIntentId: 'pi_1', amountCents: 2000, reason: 'partial' });
        expect(stripe.refunds.create).toHaveBeenCalledWith({
            payment_intent: 'pi_1',
            amount: 2000,
            metadata: { reason: 'partial' },
        });
    });

    it('returns the Stripe refund object', async () => {
        const stripe = fakeStripe();
        const refund = await createRefund(stripe, { paymentIntentId: 'pi_1' });
        expect(refund).toEqual({ id: 're_1', amount: 500 });
    });
});
