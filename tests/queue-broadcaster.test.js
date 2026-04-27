/**
 * Tests for the SSE broadcaster (lib/queue-broadcaster.js).
 *
 * Uses a fake Express response (just a write spy) since SSE is plain
 * text — no real network needed.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    addClient,
    broadcast,
    clientCount,
    __resetForTests,
} from '../lib/queue-broadcaster.js';

function fakeRes() {
    return {
        write: vi.fn(),
        end: vi.fn(),
    };
}

beforeEach(() => {
    __resetForTests();
});

describe('addClient', () => {
    it('registers a client and returns a cleanup function', () => {
        const res = fakeRes();
        const cleanup = addClient(res);
        expect(clientCount()).toBe(1);

        cleanup();
        expect(clientCount()).toBe(0);
    });

    it('replays buffered events newer than Last-Event-ID', () => {
        const oldRes = fakeRes();
        addClient(oldRes);
        broadcast('entry.added', { id: 'q_1' }); // id 1
        broadcast('entry.added', { id: 'q_2' }); // id 2
        broadcast('entry.added', { id: 'q_3' }); // id 3

        const reconnect = fakeRes();
        addClient(reconnect, '1'); // wants events after id 1

        // Reconnect should receive events 2 and 3.
        const writes = reconnect.write.mock.calls.map((c) => c[0]).join('');
        expect(writes).toContain('id: 2');
        expect(writes).toContain('id: 3');
        expect(writes).not.toContain('id: 1\n'); // not replayed (already seen)
    });
});

describe('broadcast', () => {
    it('sends event to all connected clients in SSE format', () => {
        const a = fakeRes();
        const b = fakeRes();
        addClient(a);
        addClient(b);

        broadcast('entry.added', { id: 'q_42', type: 'order' });

        for (const res of [a, b]) {
            const text = res.write.mock.calls.map((c) => c[0]).join('');
            expect(text).toContain('event: entry.added');
            expect(text).toContain('id: 1');
            expect(text).toContain('"id":"q_42"');
            expect(text).toContain('"type":"order"');
            expect(text).toMatch(/\n\n$/); // SSE record terminator
        }
    });

    it('assigns monotonic ids to consecutive broadcasts', () => {
        const res = fakeRes();
        addClient(res);

        broadcast('a', {});
        broadcast('b', {});
        broadcast('c', {});

        const writes = res.write.mock.calls.map((c) => c[0]).join('');
        expect(writes).toContain('id: 1');
        expect(writes).toContain('id: 2');
        expect(writes).toContain('id: 3');
    });

    it('caps the replay buffer at 100 events', () => {
        for (let i = 0; i < 150; i++) {
            broadcast('test', { i });
        }

        const reconnect = fakeRes();
        // ID 0 means "give me everything you have buffered" — buffer is
        // capped at 100 so we should get the most recent 100 only.
        addClient(reconnect, '0');

        const text = reconnect.write.mock.calls.map((c) => c[0]).join('');
        const idLines = text.match(/^id: (\d+)$/gm) || [];
        expect(idLines.length).toBe(100);
        // Earliest replayed event should be id 51 (events 1..50 were evicted).
        expect(idLines[0]).toBe('id: 51');
        expect(idLines[99]).toBe('id: 150');
    });
});
