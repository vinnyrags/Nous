/**
 * Tests for the collection-import seed script's parsing helpers.
 * The full script (file I/O) is exercised manually; these pin the
 * pure functions that do the actual line-shape decisions.
 */

import { describe, it, expect } from 'vitest';
import {
    parseCardLine,
    splitNameAndSet,
    normalizeVariant,
} from '../scripts/shop/build-collection-import.mjs';

describe('parseCardLine — happy paths', () => {
    it('parses a standard "Name SetName Number" line', () => {
        const r = parseCardLine('- Charizard Base Set 4/102');
        expect(r).toMatchObject({
            cardName: 'Charizard',
            setName: 'Base Set',
            cardNumber: '4/102',
            variant: null,
            language: 'English',
        });
    });

    it('captures shadowless variant from a parenthetical', () => {
        const r = parseCardLine('- Hitmonchan Base Set 7/102 (Shadowless)');
        expect(r.cardName).toBe('Hitmonchan');
        expect(r.setName).toBe('Base Set');
        expect(r.cardNumber).toBe('7/102');
        expect(r.variant).toBe('shadowless');
    });

    it('captures first-edition variant', () => {
        const r = parseCardLine('- Machamp Base Set 8/102 (First Edition)');
        expect(r.variant).toBe('first-edition');
    });

    it('handles "Base Set 2" before "Base Set" (longest-prefix wins)', () => {
        // splitNameAndSet iterates KNOWN_SETS in order — Base Set 2 must
        // be listed BEFORE Base Set so Alakazam Base Set 2 doesn't
        // match Base Set first and leave " 2 1/130" stuck on the end.
        const r = parseCardLine('- Alakazam Base Set 2 1/130');
        expect(r.setName).toBe('Base Set 2');
        expect(r.cardName).toBe('Alakazam');
        expect(r.cardNumber).toBe('1/130');
    });

    it('handles Team Rocket cards with "Dark" prefix', () => {
        const r = parseCardLine('- Dark Charizard Team Rocket 4/82');
        expect(r.cardName).toBe('Dark Charizard');
        expect(r.setName).toBe('Team Rocket');
        expect(r.cardNumber).toBe('4/82');
    });

    it('captures movie-promo variant', () => {
        const r = parseCardLine('- Mewtwo promo (movie promo 14)');
        expect(r.variant).toBe('movie-promo');
    });
});

describe('parseCardLine — skipped inputs', () => {
    it('returns null for headers without list markers', () => {
        // tmp/card-updates.txt has bare headings like "Personal
        // Collection (Not For Sale)" with no leading "- " — those
        // should be skipped without any colon-based heuristic.
        expect(parseCardLine('Personal Collection (Not For Sale)')).toBeNull();
        expect(parseCardLine('Japanese Cards')).toBeNull();
    });

    it('returns null for headers ending in colon (legacy shape)', () => {
        expect(parseCardLine('Personal Collection (Not For Sale):')).toBeNull();
    });

    it('returns null for empty / whitespace lines', () => {
        expect(parseCardLine('')).toBeNull();
        expect(parseCardLine('   ')).toBeNull();
    });

    it('returns null for non-string input', () => {
        expect(parseCardLine(null)).toBeNull();
        expect(parseCardLine(undefined)).toBeNull();
        expect(parseCardLine(42)).toBeNull();
    });
});

describe('splitNameAndSet', () => {
    it('returns blank for empty input', () => {
        expect(splitNameAndSet('')).toEqual({ cardName: '', setName: '' });
    });

    it('falls back to whole-string name when no known set markers match', () => {
        // Newer sets aren't in KNOWN_SETS — that's intentional, the
        // curator fills setName manually in Sheets after the seed runs.
        const r = splitNameAndSet('Charizard ex Obsidian Flames');
        expect(r.cardName).toBe('Charizard ex Obsidian Flames');
        expect(r.setName).toBe('');
    });

    it('splits on the rightmost known set even when card name has set-like words', () => {
        const r = splitNameAndSet('Dark Slowbro Team Rocket');
        expect(r.cardName).toBe('Dark Slowbro');
        expect(r.setName).toBe('Team Rocket');
    });
});

describe('normalizeVariant', () => {
    it('handles the canonical variant strings', () => {
        expect(normalizeVariant('Shadowless')).toBe('shadowless');
        expect(normalizeVariant('First Edition')).toBe('first-edition');
        expect(normalizeVariant('1st Edition')).toBe('first-edition');
        expect(normalizeVariant('Full Art')).toBe('full-art');
        expect(normalizeVariant('Alternate Art')).toBe('alternate-art');
        expect(normalizeVariant('Alt Art')).toBe('alternate-art');
        expect(normalizeVariant('Secret Rare')).toBe('secret');
        expect(normalizeVariant('Rainbow Rare')).toBe('rainbow');
    });

    it('returns null/falsy for empty input', () => {
        expect(normalizeVariant('')).toBeNull();
        expect(normalizeVariant(null)).toBeNull();
    });

    it('falls through to trimmed raw for unrecognized variants', () => {
        expect(normalizeVariant('Custom Holographic Treatment')).toBe(
            'Custom Holographic Treatment',
        );
    });
});
