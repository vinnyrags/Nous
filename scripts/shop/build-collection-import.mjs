#!/usr/bin/env node
/**
 * Pre-flight: parse tmp/card-updates.txt → tmp/collection-import.json
 *
 * The personal-collection page (/collection on itzenzo.tv) needs each
 * card represented as a `card` CPT post in WordPress with
 * `is_personal_collection = true`. The 60 cards Vinny wants to seed are
 * in tmp/card-updates.txt as freeform "- Cardname Set Name Number
 * (Variant)" lines. This script normalizes those into a structured JSON
 * the next step can ingest.
 *
 * Output shape per row:
 *   {
 *     cardName:   "Charizard",
 *     setName:    "Base Set",
 *     cardNumber: "4/102",
 *     variant:    "shadowless" | "first-edition" | null,
 *     language:   "English" | "Japanese",
 *     rawLine:    "- Charizard Base Set 4/102",
 *   }
 *
 * From here the workflow is:
 *   1. Open the Sheets Collection tab (manual today; future PR adds a
 *      sheets-write helper).
 *   2. Paste the JSON rows in (or copy-as-CSV, then paste).
 *   3. Edit/enrich as needed in Sheets (image URLs, rarity, etc.).
 *   4. A follow-up `import-collection-cards.js` script will read
 *      Sheets, enrich missing fields via the Pokemon TCG API, and
 *      create WP posts via SSH + wp eval-file (mirroring how the audit
 *      script touches WP). This is the next PR after 2c.
 *
 * Until that follow-up lands, you can flag a handful of existing card
 * posts as is_personal_collection=true via WP admin to smoke-test the
 * /collection page rendering.
 *
 * Usage:
 *   node scripts/shop/build-collection-import.mjs
 *   node scripts/shop/build-collection-import.mjs --in=path/to/source.txt --out=path/to/out.json
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const VINCENT_REPO = path.resolve(REPO_ROOT, '../vincentragosta.io');

const inArg = process.argv.find((a) => a.startsWith('--in='));
const outArg = process.argv.find((a) => a.startsWith('--out='));
const IN_PATH = inArg
    ? inArg.split('=')[1]
    : path.join(VINCENT_REPO, 'tmp/card-updates.txt');
const OUT_PATH = outArg
    ? outArg.split('=')[1]
    : path.join(VINCENT_REPO, 'tmp/collection-import.json');

/**
 * Parse one freeform card line into a normalized record. Returns null
 * for lines that aren't card entries (headers, separators, blank).
 *
 * Recognized shapes (loose — the curator fills in gaps in Sheets later):
 *   - "Charizard Base Set 4/102"
 *   - "Hitmonchan Base Set 7/102 (Shadowless)"
 *   - "Machamp Base Set 8/102 (First Edition)"
 *   - "Ancient Mew Promo (movie promo)"
 *   - "Pichu Neo Genesis 12/111"
 *   - "Mewtwo promo (movie promo 14)"
 */
export function parseCardLine(rawLine) {
    if (typeof rawLine !== 'string') return null;
    const trimmed = rawLine.trim();
    // Only lines starting with a list marker are card entries — bare
    // headings like "Personal Collection (Not For Sale)" or "Japanese
    // Cards" intentionally don't have markers and should be skipped.
    if (!/^[-•*]\s+/.test(trimmed)) return null;
    const line = trimmed.replace(/^[-•*]\s+/, '');
    if (!line || line.includes(':')) return null;

    // Strip + capture parenthetical at the end (variant / promo flag / etc).
    let variant = null;
    let stripped = line;
    const parenMatch = line.match(/\s*\(([^)]+)\)\s*$/);
    if (parenMatch) {
        variant = normalizeVariant(parenMatch[1]);
        stripped = line.slice(0, parenMatch.index).trim();
    }

    // Pull off a trailing card number (e.g. "4/102", "12/111", "SWSH076").
    let cardNumber = '';
    const numberMatch = stripped.match(/\s+([A-Za-z]*\d+(?:\/\d+)?)\s*$/);
    if (numberMatch) {
        cardNumber = numberMatch[1];
        stripped = stripped.slice(0, numberMatch.index).trim();
    }

    // What's left is "<Card Name> <Set Name>". Heuristically split on
    // the LAST occurrence of a set-name marker we recognize (very loose
    // — the curator confirms in Sheets). When in doubt, dump the
    // whole remainder into setName and leave cardName blank for manual
    // disambiguation.
    const { cardName, setName } = splitNameAndSet(stripped);

    if (!cardName && !setName) return null;

    return {
        cardName,
        setName,
        cardNumber,
        variant,
        language: 'English',
        rawLine,
    };
}

const KNOWN_SETS = [
    'Base Set 2',
    'Base Set',
    'Jungle',
    'Fossil',
    'Team Rocket',
    'Gym Heroes',
    'Gym Challenge',
    'Neo Genesis',
    'Neo Discovery',
    'Neo Revelation',
    'Neo Destiny',
    'Legendary Collection',
    'Promo',
];

export function splitNameAndSet(input) {
    if (!input) return { cardName: '', setName: '' };
    for (const set of KNOWN_SETS) {
        // Case-insensitive whole-word match on the set name as a suffix
        // (or anywhere in the string — pull off the rightmost occurrence
        // so "Dark Charizard Team Rocket" splits cleanly).
        const re = new RegExp(`\\b${set.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i');
        const m = input.match(re);
        if (m) {
            const before = input.slice(0, m.index).trim();
            const after = input.slice(m.index + m[0].length).trim();
            const name = before;
            // If there's content after the set name (rare), append it as
            // a parenthetical-like trailer to setName for manual review.
            const setLabel = after ? `${set} ${after}`.trim() : set;
            return { cardName: name, setName: setLabel };
        }
    }
    // No known set marker — assume the whole remainder is the card name
    // and leave setName blank for manual fill-in.
    return { cardName: input.trim(), setName: '' };
}

export function normalizeVariant(raw) {
    if (!raw) return null;
    const t = raw.toLowerCase().trim();
    if (t.includes('shadowless')) return 'shadowless';
    if (t.includes('first edition') || t.includes('1st edition')) return 'first-edition';
    if (t.includes('movie promo')) return 'movie-promo';
    if (t.includes('promo')) return 'promo';
    if (t.includes('full art')) return 'full-art';
    if (t.includes('alternate art') || t.includes('alt art')) return 'alternate-art';
    if (t.includes('secret')) return 'secret';
    if (t.includes('rainbow')) return 'rainbow';
    return raw.trim();
}

function main() {
    if (!fs.existsSync(IN_PATH)) {
        console.error(`Input file not found: ${IN_PATH}`);
        process.exit(1);
    }

    const lines = fs.readFileSync(IN_PATH, 'utf8').split(/\r?\n/);
    const records = [];
    const skipped = [];

    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const record = parseCardLine(trimmed);
        if (record) {
            records.push(record);
        } else {
            skipped.push(trimmed);
        }
    }

    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(records, null, 2) + '\n');

    console.log(`Parsed ${records.length} card record(s) → ${OUT_PATH}`);
    if (skipped.length) {
        console.log(`Skipped ${skipped.length} non-card line(s) (headers, separators):`);
        for (const s of skipped) console.log(`  - ${s}`);
    }

    const noSet = records.filter((r) => !r.setName).length;
    const noNumber = records.filter((r) => !r.cardNumber).length;
    if (noSet || noNumber) {
        console.log('');
        console.log(
            `Heads-up: ${noSet} record(s) have no set name and ${noNumber} have no card number — those will need manual fill-in once you paste into Sheets.`,
        );
    }
}

// Only run main() when executed directly (not when imported by tests).
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}
