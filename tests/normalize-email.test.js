import { describe, it, expect } from 'vitest';
import { normalizeEmail } from '../lib/normalize-email.js';

describe('normalizeEmail', () => {
    it('lowercases mixed-case input', () => {
        expect(normalizeEmail('User@Gmail.COM')).toBe('user@gmail.com');
    });

    it('trims surrounding whitespace', () => {
        expect(normalizeEmail('  user@gmail.com  ')).toBe('user@gmail.com');
        expect(normalizeEmail('\tuser@gmail.com\n')).toBe('user@gmail.com');
    });

    it('returns null for empty / whitespace-only input', () => {
        expect(normalizeEmail('')).toBeNull();
        expect(normalizeEmail('   ')).toBeNull();
    });

    it('returns null for non-string input', () => {
        expect(normalizeEmail(null)).toBeNull();
        expect(normalizeEmail(undefined)).toBeNull();
        expect(normalizeEmail(123)).toBeNull();
        expect(normalizeEmail({})).toBeNull();
    });

    it('preserves the local-part`+` aliasing (gmail dot+plus aliases)', () => {
        // The `+` alias is a distinct mailbox — lowercasing only.
        expect(normalizeEmail('User+Test@Gmail.COM')).toBe('user+test@gmail.com');
    });

    it('is idempotent', () => {
        const once = normalizeEmail('Foo@Bar.com');
        expect(normalizeEmail(once)).toBe(once);
    });
});
