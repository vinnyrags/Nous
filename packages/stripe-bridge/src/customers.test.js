import { describe, it, expect, vi } from 'vitest';
import { listCustomersByEmail } from './customers.js';

describe('listCustomersByEmail', () => {
    it('lists by email with default limit 1 and returns the data array', async () => {
        const stripe = { customers: { list: vi.fn().mockResolvedValue({ data: [{ id: 'cus_1' }] }) } };
        const out = await listCustomersByEmail(stripe, 'a@b.com');
        expect(stripe.customers.list).toHaveBeenCalledWith({ email: 'a@b.com', limit: 1 });
        expect(out).toEqual([{ id: 'cus_1' }]);
    });

    it('returns an empty array when there are no matches', async () => {
        const stripe = { customers: { list: vi.fn().mockResolvedValue({ data: [] }) } };
        expect(await listCustomersByEmail(stripe, 'none@b.com')).toEqual([]);
    });

    it('honors an explicit limit', async () => {
        const stripe = { customers: { list: vi.fn().mockResolvedValue({ data: [] }) } };
        await listCustomersByEmail(stripe, 'a@b.com', { limit: 5 });
        expect(stripe.customers.list).toHaveBeenCalledWith({ email: 'a@b.com', limit: 5 });
    });
});
