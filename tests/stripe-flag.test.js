import { describe, it, expect } from 'vitest';
import {
    parseEnvFlag,
    parseWpConfigFlag,
    resolveStripeEnabled,
} from '../lib/stripe-flag.js';

describe('parseEnvFlag', () => {
    it('returns undefined when unset', () => {
        expect(parseEnvFlag(undefined)).toBeUndefined();
        expect(parseEnvFlag(null)).toBeUndefined();
    });

    it('treats false-y strings as false (case/space-insensitive)', () => {
        for (const v of ['false', 'FALSE', ' false ', '0', '']) {
            expect(parseEnvFlag(v)).toBe(false);
        }
    });

    it('treats anything else as true', () => {
        for (const v of ['true', '1', 'yes', 'on']) {
            expect(parseEnvFlag(v)).toBe(true);
        }
    });
});

describe('parseWpConfigFlag', () => {
    it('reads an explicit false define', () => {
        expect(parseWpConfigFlag("define('STRIPE_ENABLED', false);")).toBe(false);
    });

    it('reads an explicit true define', () => {
        expect(parseWpConfigFlag("define('STRIPE_ENABLED', true);")).toBe(true);
    });

    it('returns undefined when the define is absent', () => {
        expect(parseWpConfigFlag("define('OTHER', false);")).toBeUndefined();
        expect(parseWpConfigFlag('')).toBeUndefined();
        expect(parseWpConfigFlag(undefined)).toBeUndefined();
    });
});

describe('resolveStripeEnabled', () => {
    it('defaults to true with no signal (backward-compatible)', () => {
        expect(resolveStripeEnabled({})).toBe(true);
        expect(resolveStripeEnabled({ envValue: undefined, fileContents: [null, null] })).toBe(true);
    });

    it('env var wins over the wp-config file', () => {
        expect(resolveStripeEnabled({
            envValue: 'false',
            fileContents: ["define('STRIPE_ENABLED', true);"],
        })).toBe(false);

        expect(resolveStripeEnabled({
            envValue: 'true',
            fileContents: ["define('STRIPE_ENABLED', false);"],
        })).toBe(true);
    });

    it('falls back to the first wp-config define when env is unset', () => {
        expect(resolveStripeEnabled({
            envValue: undefined,
            fileContents: [null, "define('STRIPE_ENABLED', false);"],
        })).toBe(false);
    });

    it('parks Stripe when the WP define is false and nothing else is set', () => {
        expect(resolveStripeEnabled({
            envValue: undefined,
            fileContents: ["define('STRIPE_ENABLED', false);"],
        })).toBe(false);
    });
});
