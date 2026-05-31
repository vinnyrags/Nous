import { describe, it, expect, vi } from 'vitest';
import { createCheckoutSession } from './create.js';

describe('createCheckoutSession', () => {
    it('passes the params object through to the SDK and returns the session', async () => {
        const session = { id: 'cs_1', url: 'https://checkout.stripe.com/cs_1' };
        const stripe = { checkout: { sessions: { create: vi.fn().mockResolvedValue(session) } } };
        const params = { mode: 'payment', line_items: [{ price: 'price_x', quantity: 1 }] };
        const out = await createCheckoutSession(stripe, params);
        expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(params);
        expect(out).toBe(session);
    });

    it('propagates Stripe errors (caller owns the catch)', async () => {
        const stripe = {
            checkout: { sessions: { create: vi.fn().mockRejectedValue(new Error('No such price')) } },
        };
        await expect(createCheckoutSession(stripe, {})).rejects.toThrow('No such price');
    });
});
