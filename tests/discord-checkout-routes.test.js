/**
 * Discord-initiated checkout routes — express layer contract tests.
 *
 * Covers the GET endpoints Nous serves for Discord button purchases:
 *   GET /battle/checkout/:id        — pack-battle entry
 *   GET /pull-box/checkout/:tier    — pull-box buy-in (V or VMAX)
 *   GET /card-shop/checkout/:listingId — !sell card sale
 *   GET /product/checkout/:priceId  — !product / direct embed buy
 *   GET /shipping/checkout          — international shipping top-up
 *
 * The `!test` command exercises the post-payment handlers (handleCheckoutCompleted),
 * but doesn't drive these GET routes themselves — they're only hit when a
 * Discord buyer clicks a Buy button. This file fills that gap.
 *
 * Each test stubs Stripe at `stripe.checkout.sessions.create`, mocks the
 * relevant DB queries, and asserts the session params Stripe would receive.
 * Stripe's HTTP layer is treated as a black box (per the same testing
 * philosophy that drives Phase 2's webhook contract tests).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';

// =========================================================================
// Mocks — install BEFORE the module imports below
// =========================================================================

vi.mock('../config.js', () => ({
    default: {
        STRIPE_SECRET_KEY: 'sk_test_123',
        STRIPE_WEBHOOK_SECRET: '',
        DISCORD_BOT_TOKEN: 'fake',
        SHOP_URL: 'https://itzenzo.tv',
        SITE_URL: 'https://vincentragosta.io',
        ROLES: { XIPE: 'role-xipe', LONG: 'role-long', AKIVILI: 'role-akivili' },
        XIPE_PURCHASE_THRESHOLD: 1,
        LONG_PURCHASE_THRESHOLD: 5,
        LOW_STOCK_THRESHOLD: 3,
        SHIPPING: {
            DOMESTIC: 1000,
            INTERNATIONAL: 2500,
            COUNTRIES: ['US', 'CA'],
        },
        QUEUE_SOURCE: 'sqlite',
        BOT_BIND_HOST: '127.0.0.1',
        PORT: 3100,
        LIVESTREAM_SECRET: 'test-livestream-secret',
        CHANNELS: {},
    },
}));

const mockSessionsCreate = vi.fn();
vi.mock('stripe', () => ({
    default: vi.fn().mockImplementation(() => ({
        checkout: { sessions: { create: (...a) => mockSessionsCreate(...a) } },
        webhooks: { constructEvent: vi.fn() },
        charges: { retrieve: vi.fn() },
        refunds: { create: vi.fn() },
        prices: { retrieve: vi.fn() },
        products: { update: vi.fn(), del: vi.fn() },
    })),
}));

// Bot guts that boot at import time but aren't relevant to these specs.
vi.mock('../discord.js', () => ({
    client: {
        on: vi.fn(),
        once: vi.fn(),
        login: vi.fn().mockResolvedValue('logged-in'),
        channels: { cache: new Map() },
    },
    sendEmbed: vi.fn(),
    sendToChannel: vi.fn(),
    getChannel: vi.fn(),
    getMember: vi.fn(),
    getGuild: vi.fn(),
    setChannelOverride: vi.fn(),
    clearChannelOverrides: vi.fn(),
    findMemberByUsername: vi.fn(),
    addRole: vi.fn(),
    hasRole: vi.fn(),
}));

vi.mock('../shippingeasy-api.js', () => ({
    createOrder: vi.fn(),
    cancelOrder: vi.fn(),
}));

vi.mock('../webhooks/stripe.js', () => ({
    handleCheckoutCritical: vi.fn(),
    handleCheckoutNotifications: vi.fn(),
    handleCheckoutCompleted: vi.fn(),
    notifyCatalogProductDeactivated: vi.fn(),
    priceEventProductId: vi.fn(),
}));

vi.mock('../webhooks/twitch.js', () => ({
    handleTwitchWebhook: vi.fn(),
}));

vi.mock('../webhooks/shippingeasy.js', () => ({
    handleShippingEasyWebhook: vi.fn(),
}));

vi.mock('../webhooks/card-request.js', () => ({
    handleCardRequestCritical: vi.fn(),
    handleCardRequestNotifications: vi.fn(),
}));

vi.mock('../lib/refund-propagator.js', () => ({
    propagateRefund: vi.fn(),
}));

vi.mock('../lib/refund-bridge.js', () => ({
    handleRefundEvent: vi.fn(),
    handleDisputeEvent: vi.fn(),
}));

vi.mock('../lib/queue-broadcaster.js', () => ({
    addClient: vi.fn(),
    broadcast: vi.fn(),
    clientCount: vi.fn().mockReturnValue(0),
}));

const mockHasShippingCoveredByDiscordId = vi.fn().mockReturnValue(false);
const mockBuildShippingOptions = vi.fn().mockReturnValue([{ shipping_rate_data: 'mock-rate' }]);

vi.mock('../shipping.js', () => ({
    isInternationalByEmail: vi.fn(),
    hasShippingCoveredByDiscordId: (...a) => mockHasShippingCoveredByDiscordId(...a),
    hasShippingCovered: vi.fn(),
    getShippingLabel: vi.fn(),
    buildShippingOptions: (...a) => mockBuildShippingOptions(...a),
}));

vi.mock('../webhook-limiter.js', () => ({
    createLimiter: () => async (fn) => fn(),
}));

// db.js mock — populated per test via Object.assign so each spec controls its own state
vi.mock('../db.js', () => ({
    db: null,
    purchases: {},
    battles: {},
    cardListings: {},
    listSessions: {},
    discordLinks: {},
    shipping: { record: { run: vi.fn() } },
    tracking: {},
    stripeEvents: { claimEvent: { run: vi.fn().mockReturnValue({ changes: 1 }) }, pruneOlderThan: { run: vi.fn() } },
}));

// wp-pull-box dynamic-imported by /pull-box/checkout/:tier — mock here too
const mockGetActiveBox = vi.fn();
vi.mock('../lib/wp-pull-box.js', () => ({
    getActiveBox: (...a) => mockGetActiveBox(...a),
}));

// =========================================================================
// Test setup
// =========================================================================

const dbModule = await import('../db.js');
const { app } = await import('../server.js');

beforeEach(() => {
    vi.clearAllMocks();
    mockHasShippingCoveredByDiscordId.mockReturnValue(false);
    mockSessionsCreate.mockResolvedValue({ id: 'cs_test_redirect_target', url: 'https://checkout.stripe.com/c/pay/cs_test_x' });

    // Reset query stubs to "no data found" defaults
    Object.assign(dbModule.purchases, {
        getEmailByDiscordId: { get: () => null },
    });
    Object.assign(dbModule.battles, {
        getActiveBattle: { get: () => null },
        getEntries: { all: () => [] },
    });
    Object.assign(dbModule.cardListings, {
        getById: { get: () => null },
        setStripeSessionId: { run: vi.fn() },
    });
});

// =========================================================================
// /battle/checkout/:id
// =========================================================================

describe('GET /battle/checkout/:id', () => {
    it('redirects to a Stripe checkout session for an active battle', async () => {
        Object.assign(dbModule.battles, {
            getActiveBattle: { get: () => ({ id: 7, stripe_price_id: 'price_battle_xyz', product_name: 'Test Battle' }) },
            getEntries: { all: () => [] },
        });

        const res = await request(app).get('/battle/checkout/7?user=user_alpha');

        expect(res.status).toBe(303);
        expect(res.headers.location).toBe('https://checkout.stripe.com/c/pay/cs_test_x');
        expect(mockSessionsCreate).toHaveBeenCalledOnce();
        const params = mockSessionsCreate.mock.calls[0][0];
        expect(params.line_items).toEqual([{ price: 'price_battle_xyz', quantity: 1 }]);
        expect(params.metadata).toMatchObject({
            source: 'pack-battle',
            battle_id: '7',
            discord_user_id: 'user_alpha',
        });
    });

    it('refuses entry for a buyer who already entered the battle', async () => {
        Object.assign(dbModule.battles, {
            getActiveBattle: { get: () => ({ id: 7, stripe_price_id: 'price_x', product_name: 'B' }) },
            getEntries: { all: () => [{ discord_user_id: 'user_alpha' }] },
        });

        const res = await request(app).get('/battle/checkout/7?user=user_alpha');

        expect(res.status).toBe(400);
        expect(res.text).toMatch(/already entered/i);
        expect(mockSessionsCreate).not.toHaveBeenCalled();
    });

    it('404s when no active battle exists', async () => {
        const res = await request(app).get('/battle/checkout/1');
        expect(res.status).toBe(404);
        expect(mockSessionsCreate).not.toHaveBeenCalled();
    });

    it('prefills email for a Discord-linked buyer', async () => {
        Object.assign(dbModule.purchases, {
            getEmailByDiscordId: { get: () => ({ customer_email: 'linked@buyer.com' }) },
        });
        Object.assign(dbModule.battles, {
            getActiveBattle: { get: () => ({ id: 7, stripe_price_id: 'price_x', product_name: 'B' }) },
            getEntries: { all: () => [] },
        });

        await request(app).get('/battle/checkout/7?user=user_beta');

        const params = mockSessionsCreate.mock.calls[0][0];
        expect(params.customer_email).toBe('linked@buyer.com');
    });
});

// =========================================================================
// /pull-box/checkout/:tier
// =========================================================================

describe('GET /pull-box/checkout/:tier', () => {
    it('redirects to a Stripe session for an active V-tier box', async () => {
        mockGetActiveBox.mockResolvedValueOnce({
            id: 4,
            tier: 'v',
            stripePriceId: 'price_v_box',
            totalSlots: 100,
            claimedSlots: [],
        });

        const res = await request(app).get('/pull-box/checkout/v?user=user_alpha');

        expect(res.status).toBe(303);
        const params = mockSessionsCreate.mock.calls[0][0];
        expect(params.line_items[0].price).toBe('price_v_box');
        expect(params.metadata).toMatchObject({
            source: 'pull_box',
            pull_box_id: '4',
            tier: 'v',
        });
    });

    it('rejects unknown tiers with 400', async () => {
        const res = await request(app).get('/pull-box/checkout/legendary');
        expect(res.status).toBe(400);
        expect(mockSessionsCreate).not.toHaveBeenCalled();
    });

    it('404s when no box is open for the tier', async () => {
        mockGetActiveBox.mockResolvedValueOnce(null);
        const res = await request(app).get('/pull-box/checkout/vmax');
        expect(res.status).toBe(404);
    });

    it('503s when the box has no stripe_price_id configured (ACF gap)', async () => {
        mockGetActiveBox.mockResolvedValueOnce({
            id: 4,
            tier: 'v',
            stripePriceId: null,
            totalSlots: 100,
            claimedSlots: [],
        });

        const res = await request(app).get('/pull-box/checkout/v');
        expect(res.status).toBe(503);
    });

    it('caps adjustable_quantity.maximum at remaining slots', async () => {
        mockGetActiveBox.mockResolvedValueOnce({
            id: 4,
            tier: 'v',
            stripePriceId: 'price_v',
            totalSlots: 100,
            claimedSlots: Array.from({ length: 95 }, (_, i) => ({ slotNumber: i + 1 })),
        });

        await request(app).get('/pull-box/checkout/v');

        const params = mockSessionsCreate.mock.calls[0][0];
        // 100 total - 95 claimed = 5 remaining; min(20, 5) = 5
        expect(params.line_items[0].adjustable_quantity.maximum).toBe(5);
    });

    it('409s when the box is sold out', async () => {
        mockGetActiveBox.mockResolvedValueOnce({
            id: 4,
            tier: 'v',
            stripePriceId: 'price_v',
            totalSlots: 100,
            claimedSlots: Array.from({ length: 100 }, (_, i) => ({ slotNumber: i + 1 })),
        });

        const res = await request(app).get('/pull-box/checkout/v');
        expect(res.status).toBe(409);
        expect(mockSessionsCreate).not.toHaveBeenCalled();
    });
});

// =========================================================================
// /card-shop/checkout/:listingId
// =========================================================================

describe('GET /card-shop/checkout/:listingId', () => {
    it('redirects for an active listing', async () => {
        Object.assign(dbModule.cardListings, {
            getById: { get: () => ({ id: 12, status: 'active', card_name: 'Charizard 1st Ed', price: 49999, buyer_discord_id: null }) },
            setStripeSessionId: { run: vi.fn() },
        });

        const res = await request(app).get('/card-shop/checkout/12');

        expect(res.status).toBe(303);
        const params = mockSessionsCreate.mock.calls[0][0];
        expect(params.line_items[0].price_data.unit_amount).toBe(49999);
        expect(params.metadata).toMatchObject({
            source: 'card-sale',
            card_listing_id: '12',
            card_name: 'Charizard 1st Ed',
        });
    });

    it('attaches the Stripe session id back to the listing row on create', async () => {
        const setStripeSessionId = { run: vi.fn() };
        Object.assign(dbModule.cardListings, {
            getById: { get: () => ({ id: 12, status: 'active', card_name: 'X', price: 100, buyer_discord_id: null }) },
            setStripeSessionId,
        });

        await request(app).get('/card-shop/checkout/12');

        expect(setStripeSessionId.run).toHaveBeenCalledWith('cs_test_redirect_target', 12);
    });

    it('404s for a sold listing (status=sold)', async () => {
        Object.assign(dbModule.cardListings, {
            getById: { get: () => ({ id: 12, status: 'sold', card_name: 'X', price: 100 }) },
            setStripeSessionId: { run: vi.fn() },
        });

        const res = await request(app).get('/card-shop/checkout/12');
        expect(res.status).toBe(404);
    });

    it('enables adjustable_quantity for status=pull listings (gacha mode)', async () => {
        Object.assign(dbModule.cardListings, {
            getById: { get: () => ({ id: 12, status: 'pull', card_name: 'Pull X', price: 100 }) },
            setStripeSessionId: { run: vi.fn() },
        });

        await request(app).get('/card-shop/checkout/12');

        const params = mockSessionsCreate.mock.calls[0][0];
        expect(params.line_items[0].adjustable_quantity).toMatchObject({
            enabled: true,
            minimum: 1,
            maximum: 20,
        });
    });

    it('skips shipping when buyer has shipping covered for the period', async () => {
        Object.assign(dbModule.cardListings, {
            getById: { get: () => ({ id: 12, status: 'active', card_name: 'X', price: 100 }) },
            setStripeSessionId: { run: vi.fn() },
        });
        mockHasShippingCoveredByDiscordId.mockReturnValueOnce(true);

        await request(app).get('/card-shop/checkout/12?user=user_alpha');

        const params = mockSessionsCreate.mock.calls[0][0];
        expect(params.shipping_options).toBeUndefined();
        expect(params.shipping_address_collection).toBeUndefined();
    });
});

// =========================================================================
// /product/checkout/:priceId
// =========================================================================

describe('GET /product/checkout/:priceId', () => {
    it('redirects to a Stripe session with the priceId line item', async () => {
        const res = await request(app).get('/product/checkout/price_xyz_direct?user=user_gamma');

        expect(res.status).toBe(303);
        const params = mockSessionsCreate.mock.calls[0][0];
        expect(params.line_items).toEqual([{ price: 'price_xyz_direct', quantity: 1 }]);
        expect(params.metadata).toMatchObject({
            source: 'hype-checkout',
            discord_user_id: 'user_gamma',
        });
    });

    it('includes shipping options when the buyer is uncovered', async () => {
        await request(app).get('/product/checkout/price_x?user=user_uncovered');

        const params = mockSessionsCreate.mock.calls[0][0];
        expect(params.shipping_options).toBeDefined();
        expect(params.shipping_address_collection).toMatchObject({
            allowed_countries: ['US', 'CA'],
        });
    });

    it('skips shipping when the buyer is covered', async () => {
        mockHasShippingCoveredByDiscordId.mockReturnValueOnce(true);
        await request(app).get('/product/checkout/price_x?user=user_covered');

        const params = mockSessionsCreate.mock.calls[0][0];
        expect(params.shipping_options).toBeUndefined();
    });
});

// =========================================================================
// /shipping/checkout
// =========================================================================

describe('GET /shipping/checkout', () => {
    it('creates a Stripe session for the requested shipping amount', async () => {
        const res = await request(app).get('/shipping/checkout?amount=1500&reason=International+top-up&user=user_alpha');

        expect(res.status).toBe(303);
        const params = mockSessionsCreate.mock.calls[0][0];
        expect(params.line_items[0].price_data.unit_amount).toBe(1500);
        expect(params.line_items[0].price_data.product_data.name).toBe('International top-up');
        expect(params.metadata).toMatchObject({
            source: 'ad-hoc-shipping',
            discord_user_id: 'user_alpha',
            reason: 'International top-up',
        });
    });

    it('400s when amount is missing or zero', async () => {
        const r1 = await request(app).get('/shipping/checkout');
        expect(r1.status).toBe(400);
        const r2 = await request(app).get('/shipping/checkout?amount=0');
        expect(r2.status).toBe(400);
        expect(mockSessionsCreate).not.toHaveBeenCalled();
    });

    it('refuses (200 with skip message) when buyer already covered for the period', async () => {
        mockHasShippingCoveredByDiscordId.mockReturnValueOnce(true);
        const res = await request(app).get('/shipping/checkout?amount=1500&user=user_covered');

        expect(res.status).toBe(200);
        expect(res.text).toMatch(/already covered/i);
        expect(mockSessionsCreate).not.toHaveBeenCalled();
    });
});
