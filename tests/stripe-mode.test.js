import { describe, it, expect } from 'vitest';
import { detectMode, isLiveMode, isTestMode } from '../lib/stripe-mode.cjs';

describe('detectMode', () => {
    it('classifies sk_live_, pk_live_, rk_live_ as live', () => {
        expect(detectMode('sk_live_abc123')).toBe('live');
        expect(detectMode('pk_live_xyz')).toBe('live');
        expect(detectMode('rk_live_restricted')).toBe('live');
    });

    it('classifies sk_test_, pk_test_, rk_test_ as test', () => {
        expect(detectMode('sk_test_abc123')).toBe('test');
        expect(detectMode('pk_test_xyz')).toBe('test');
        expect(detectMode('rk_test_restricted')).toBe('test');
    });

    it('returns unknown for missing/garbage values', () => {
        expect(detectMode(undefined)).toBe('unknown');
        expect(detectMode(null)).toBe('unknown');
        expect(detectMode('')).toBe('unknown');
        expect(detectMode('whsec_signing_secret')).toBe('unknown');
        expect(detectMode('not-a-stripe-key')).toBe('unknown');
        expect(detectMode(42)).toBe('unknown');
    });

    it('does not match keys that merely contain the substring', () => {
        // The prefix must come at the start; "sk_LIVE_" and embedded
        // matches like "user_sk_live_…" are unknown.
        expect(detectMode('user_sk_live_abc')).toBe('unknown');
        expect(detectMode('sk_LIVE_abc')).toBe('unknown');
    });
});

describe('isLiveMode / isTestMode', () => {
    it('isLiveMode is true only for live keys', () => {
        expect(isLiveMode('sk_live_x')).toBe(true);
        expect(isLiveMode('sk_test_x')).toBe(false);
        expect(isLiveMode(undefined)).toBe(false);
    });

    it('isTestMode is true only for test keys', () => {
        expect(isTestMode('sk_test_x')).toBe(true);
        expect(isTestMode('sk_live_x')).toBe(false);
        expect(isTestMode(undefined)).toBe(false);
    });
});
