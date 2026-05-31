import { describe, it, expect, vi } from 'vitest';
import { findPromotionCodeByCode, createCoupon, createPromotionCode } from './coupons.js';

function fakeStripe() {
    return {
        promotionCodes: {
            list: vi.fn().mockResolvedValue({ data: [{ id: 'promo_1', code: 'SPRING20' }] }),
            create: vi.fn().mockResolvedValue({ id: 'promo_new' }),
        },
        coupons: {
            create: vi.fn().mockResolvedValue({ id: 'coupon_new' }),
        },
    };
}

describe('findPromotionCodeByCode', () => {
    it('lists by code with limit 1 and returns the first match', async () => {
        const stripe = fakeStripe();
        const promo = await findPromotionCodeByCode(stripe, 'SPRING20');
        expect(stripe.promotionCodes.list).toHaveBeenCalledWith({ code: 'SPRING20', limit: 1 });
        expect(promo).toEqual({ id: 'promo_1', code: 'SPRING20' });
    });

    it('expands data.coupon when requested', async () => {
        const stripe = fakeStripe();
        await findPromotionCodeByCode(stripe, 'SPRING20', { expandCoupon: true });
        expect(stripe.promotionCodes.list).toHaveBeenCalledWith({ code: 'SPRING20', limit: 1, expand: ['data.coupon'] });
    });

    it('returns null when no code matches', async () => {
        const stripe = fakeStripe();
        stripe.promotionCodes.list.mockResolvedValueOnce({ data: [] });
        expect(await findPromotionCodeByCode(stripe, 'NOPE')).toBeNull();
    });
});

describe('createCoupon', () => {
    it('passes the coupon params through verbatim', async () => {
        const stripe = fakeStripe();
        const params = { percent_off: 20, duration: 'once' };
        const coupon = await createCoupon(stripe, params);
        expect(stripe.coupons.create).toHaveBeenCalledWith(params);
        expect(coupon).toEqual({ id: 'coupon_new' });
    });
});

describe('createPromotionCode', () => {
    it('binds the code to the coupon, omitting max_redemptions when falsy (unlimited)', async () => {
        const stripe = fakeStripe();
        await createPromotionCode(stripe, { couponId: 'coupon_new', code: 'FLASH50' });
        expect(stripe.promotionCodes.create).toHaveBeenCalledWith({ coupon: 'coupon_new', code: 'FLASH50' });
    });

    it('adds max_redemptions when given', async () => {
        const stripe = fakeStripe();
        await createPromotionCode(stripe, { couponId: 'coupon_new', code: 'FLASH50', maxRedemptions: 5 });
        expect(stripe.promotionCodes.create).toHaveBeenCalledWith({ coupon: 'coupon_new', code: 'FLASH50', max_redemptions: 5 });
    });
});
