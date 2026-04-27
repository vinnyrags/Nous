import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const ORIGINAL_FETCH = global.fetch;

let currentPackBattle;
let config;

beforeEach(async () => {
    vi.resetModules();
    config = (await import('../config.js')).default;
    currentPackBattle = await import('../lib/wp-current-battle.js');
});

afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
});

function mockFetch(response) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: response.ok ?? true,
        status: response.status ?? 200,
        json: async () => response.body ?? {},
        text: async () => JSON.stringify(response.body ?? {}),
    });
    global.fetch = fetchMock;
    return fetchMock;
}

describe('wp-current-battle helper', () => {
    it('setOpen POSTs the expected payload with a Discord pack-battles channel URL', async () => {
        const fetchMock = mockFetch({ body: { status: 'open' } });

        const result = await currentPackBattle.setOpen({
            id: 12,
            stripe_price_id: 'price_abc',
            max_entries: 10,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe(`${config.SITE_URL}/wp-json/shop/v1/current-pack-battle`);
        expect(init.method).toBe('POST');

        const body = JSON.parse(init.body);
        expect(body.secret).toBe(config.LIVESTREAM_SECRET);
        expect(body.status).toBe('open');
        expect(body.battle_id).toBe(12);
        expect(body.stripe_price_id).toBe('price_abc');
        expect(body.max_entries).toBe(10);
        expect(body.paid_entries).toBe(0);
        expect(body.buy_url).toBe(
            `https://discord.com/channels/${config.GUILD_ID}/${config.CHANNELS.PACK_BATTLES}`,
        );
        expect(result).toEqual({ status: 'open' });
    });

    it('setInProgress clears the buy_url and reports the actual paid entry count', async () => {
        const fetchMock = mockFetch({ body: {} });

        await currentPackBattle.setInProgress(
            { id: 12, stripe_price_id: 'price_abc', max_entries: 10 },
            7,
        );

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.status).toBe('in_progress');
        expect(body.buy_url).toBe('');
        expect(body.paid_entries).toBe(7);
    });

    it('clear sends only status=idle (no battle metadata)', async () => {
        const fetchMock = mockFetch({ body: {} });

        await currentPackBattle.clear();

        const body = JSON.parse(fetchMock.mock.calls[0][1].body);
        expect(body.status).toBe('idle');
        expect(body.battle_id).toBeUndefined();
        expect(body.buy_url).toBeUndefined();
    });

    it('returns null when WordPress responds with an error status', async () => {
        mockFetch({ ok: false, status: 403, body: { message: 'Invalid secret.' } });
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await currentPackBattle.clear();

        expect(result).toBeNull();
        consoleSpy.mockRestore();
    });

    it('returns null when fetch itself throws (network error)', async () => {
        global.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND'));
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const result = await currentPackBattle.setOpen({
            id: 1,
            stripe_price_id: 'price_x',
            max_entries: 5,
        });

        expect(result).toBeNull();
        consoleSpy.mockRestore();
    });
});
