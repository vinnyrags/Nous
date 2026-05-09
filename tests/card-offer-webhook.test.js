/**
 * Tests for the card-offer webhook handler:
 *
 *   - operator DM happy path (DM goes through, ops post is silent ack)
 *   - DM failure (ops post carries the warning)
 *   - operator user not configured (only ops post happens)
 *   - activity envelope broadcast carries the right shape
 *   - embed contents (offer amount, email, discord username, message)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const sendToChannelMock = vi.fn();
const broadcastMock = vi.fn();
const userSendMock = vi.fn();
const usersFetchMock = vi.fn();

vi.mock('../config.js', () => ({
    default: {
        OPERATOR_DISCORD_ID: '111222333',
        CHANNELS: { OPS: '0' },
    },
}));

vi.mock('../discord.js', () => ({
    sendToChannel: (...args) => sendToChannelMock(...args),
}));

vi.mock('../lib/queue-broadcaster.js', () => ({
    broadcast: (...args) => broadcastMock(...args),
}));

import { handleCardOffer } from '../handlers/cardOffer.js';

const fakeClient = {
    users: { fetch: (...args) => usersFetchMock(...args) },
};

beforeEach(() => {
    sendToChannelMock.mockReset().mockResolvedValue(undefined);
    broadcastMock.mockReset();
    userSendMock.mockReset().mockResolvedValue(undefined);
    usersFetchMock.mockReset().mockResolvedValue({
        send: (...args) => userSendMock(...args),
    });
});

describe('handleCardOffer — operator DM happy path', () => {
    it("DMs the configured operator with the offer embed", async () => {
        await handleCardOffer({
            data: {
                cardTitle: 'Charizard Base Set 4/102',
                cardPermalink: 'https://itzenzo.tv/collection',
                email: 'buyer@example.com',
                discordUsername: 'vinnyrags',
                offerAmount: '$2,500.00',
                message: 'Looking for shadowless if you have it.',
            },
            client: fakeClient,
        });

        expect(usersFetchMock).toHaveBeenCalledWith('111222333');
        expect(userSendMock).toHaveBeenCalledTimes(1);
        const dmPayload = userSendMock.mock.calls[0][0];
        expect(dmPayload.embeds).toHaveLength(1);
        const dmEmbed = dmPayload.embeds[0].toJSON();
        expect(dmEmbed.title).toMatch(/offer/i);
        expect(dmEmbed.description).toContain('Charizard Base Set 4/102');
        expect(dmEmbed.fields.find((f) => f.name === 'Offer').value).toBe('$2,500.00');
        expect(dmEmbed.fields.find((f) => f.name === 'Email').value).toBe('buyer@example.com');
    });

    it("posts the same embed to #ops as audit trail (no warning content)", async () => {
        await handleCardOffer({
            data: {
                cardTitle: 'Charizard',
                email: 'buyer@example.com',
                offerAmount: '$500.00',
            },
            client: fakeClient,
        });

        expect(sendToChannelMock).toHaveBeenCalledTimes(1);
        const [channelKey, opsPayload] = sendToChannelMock.mock.calls[0];
        expect(channelKey).toBe('OPS');
        expect(opsPayload.content).toBeNull();
        expect(opsPayload.embeds).toHaveLength(1);
    });
});

describe('handleCardOffer — DM failure fallback', () => {
    it("includes a DM-failed warning on the #ops post when DM throws", async () => {
        usersFetchMock.mockResolvedValue({
            send: vi.fn().mockRejectedValue(new Error('Cannot send messages to this user')),
        });

        await handleCardOffer({
            data: {
                cardTitle: 'Charizard',
                email: 'buyer@example.com',
                offerAmount: '$500.00',
            },
            client: fakeClient,
        });

        expect(sendToChannelMock).toHaveBeenCalledTimes(1);
        const [, opsPayload] = sendToChannelMock.mock.calls[0];
        expect(opsPayload.content).toMatch(/DM delivery failed/i);
    });
});

describe('handleCardOffer — no operator configured', () => {
    it("skips DM entirely and posts only to #ops when OPERATOR_DISCORD_ID is unset", async () => {
        // Re-mock config without an operator id for this test only.
        vi.resetModules();
        vi.doMock('../config.js', () => ({
            default: {
                OPERATOR_DISCORD_ID: null,
                CHANNELS: { OPS: '0' },
            },
        }));
        const { handleCardOffer: handler } = await import('../handlers/cardOffer.js');

        await handler({
            data: {
                cardTitle: 'Charizard',
                email: 'buyer@example.com',
                offerAmount: '$500.00',
            },
            client: fakeClient,
        });

        expect(usersFetchMock).not.toHaveBeenCalled();
        expect(sendToChannelMock).toHaveBeenCalledTimes(1);
    });
});

describe('handleCardOffer — activity broadcast', () => {
    it("broadcasts an activity.card_offer envelope with display-ready fields", async () => {
        await handleCardOffer({
            data: {
                cardTitle: 'Charizard',
                email: 'buyer@example.com',
                offerAmount: '$500.00',
            },
            client: fakeClient,
        });

        expect(broadcastMock).toHaveBeenCalledTimes(1);
        const [event, envelope] = broadcastMock.mock.calls[0];
        expect(event).toBe('activity.card_offer');
        expect(envelope.kind).toBe('card_offer');
        expect(envelope.title).toMatch(/Offer received/i);
        expect(envelope.description).toContain('Charizard');
        expect(envelope.description).toContain('$500.00');
        expect(envelope.color).toBe('amber');
        expect(envelope.icon).toBe('💰');
        expect(envelope.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
