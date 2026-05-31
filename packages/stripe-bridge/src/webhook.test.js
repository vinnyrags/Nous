import { describe, it, expect, vi } from 'vitest';
import { constructWebhookEvent, listSessionLineItems } from './webhook.js';

describe('constructWebhookEvent', () => {
    it('passes payload, signature, and secret to the SDK and returns the event', () => {
        const event = { id: 'evt_1', type: 'checkout.session.completed' };
        const stripe = { webhooks: { constructEvent: vi.fn().mockReturnValue(event) } };
        const out = constructWebhookEvent(stripe, { payload: 'raw', signature: 'sig', secret: 'whsec' });
        expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith('raw', 'sig', 'whsec');
        expect(out).toBe(event);
    });

    it('propagates a signature verification error', () => {
        const stripe = {
            webhooks: { constructEvent: vi.fn(() => { throw new Error('No signatures found'); }) },
        };
        expect(() => constructWebhookEvent(stripe, { payload: 'x', signature: 'bad', secret: 's' }))
            .toThrow('No signatures found');
    });
});

describe('listSessionLineItems', () => {
    it('fetches with the given limit and maps to { name, quantity }', async () => {
        const stripe = {
            checkout: { sessions: { listLineItems: vi.fn().mockResolvedValue({
                data: [
                    { description: 'Booster Pack', quantity: 2 },
                    { description: 'Sleeves', quantity: 1 },
                ],
            }) } },
        };
        const out = await listSessionLineItems(stripe, 'cs_1', { limit: 100 });
        expect(stripe.checkout.sessions.listLineItems).toHaveBeenCalledWith('cs_1', { limit: 100 });
        expect(out).toEqual([
            { name: 'Booster Pack', quantity: 2 },
            { name: 'Sleeves', quantity: 1 },
        ]);
    });

    it('defaults a missing description to "Unknown Product" and missing quantity to 1', async () => {
        const stripe = {
            checkout: { sessions: { listLineItems: vi.fn().mockResolvedValue({ data: [{}] }) } },
        };
        const out = await listSessionLineItems(stripe, 'cs_1');
        expect(out).toEqual([{ name: 'Unknown Product', quantity: 1 }]);
    });

    it('defaults the limit to 100 when omitted', async () => {
        const stripe = {
            checkout: { sessions: { listLineItems: vi.fn().mockResolvedValue({ data: [] }) } },
        };
        await listSessionLineItems(stripe, 'cs_1');
        expect(stripe.checkout.sessions.listLineItems).toHaveBeenCalledWith('cs_1', { limit: 100 });
    });

    it('propagates Stripe errors (caller owns the empty-list fallback)', async () => {
        const stripe = {
            checkout: { sessions: { listLineItems: vi.fn().mockRejectedValue(new Error('rate limited')) } },
        };
        await expect(listSessionLineItems(stripe, 'cs_1')).rejects.toThrow('rate limited');
    });
});
