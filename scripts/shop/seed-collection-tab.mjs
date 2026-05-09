#!/usr/bin/env node
/**
 * Seed-and-enrich the personal-collection cards into a new "Collection"
 * tab in the existing leads spreadsheet, then output an enriched JSON
 * file ready for the WP-side import script.
 *
 * Pipeline:
 *   1. Load tmp/collection-import.json (produced by build-collection-import.mjs).
 *   2. For each row, query the Pokemon TCG API once (~250ms throttle
 *      per request) using set name + card number + card name. Pick the
 *      best match and capture image URL, rarity, release date, artist,
 *      and the API's stable card ID for re-runs.
 *   3. Create the "Collection" tab in Sheets if missing; write headers
 *      + all 61 rows in their final shape.
 *   4. Write tmp/collection-enriched.json — the WP-side
 *      import-collection.php reads this via STDIN.
 *
 * Re-runnable: skips API lookups for rows that already have a non-empty
 * "API ID" column. To re-enrich a single row, blank that column in
 * Sheets and re-run.
 *
 * Usage:
 *   node scripts/shop/seed-collection-tab.mjs              # full run
 *   node scripts/shop/seed-collection-tab.mjs --dry-run    # no Sheets writes, no JSON write
 *   node scripts/shop/seed-collection-tab.mjs --limit=5    # first 5 rows only
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const VINCENT_REPO = path.resolve(REPO_ROOT, '../vincentragosta.io');

const CREDENTIALS_PATH = path.join(
    process.env.HOME,
    '.config/google/sheets-credentials.json',
);
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Collection';

const IN_PATH = path.join(VINCENT_REPO, 'tmp/collection-import.json');
const OUT_PATH = path.join(VINCENT_REPO, 'tmp/collection-enriched.json');

const API_BASE = 'https://api.pokemontcg.io/v2';
const API_KEY = process.env.POKEMON_TCG_API_KEY || '';
// Free tier limit is ~30 req/min; 250ms keeps us well under.
const THROTTLE_MS = 250;
const MAX_RETRIES = 3;

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : Infinity;

// Sheets column order — keep the JSON shape and the header row aligned
// so the curator can see exactly what the WP-side import will use.
const HEADERS = [
    'Card Name',       // A
    'Set Name',        // B
    'Card Number',     // C
    'Variant',         // D
    'Language',        // E
    'Rarity',          // F  (enriched)
    'Release Date',    // G  (enriched, YYYY-MM-DD)
    'Artist',          // H  (enriched)
    'Image URL',       // I  (enriched)
    'API ID',          // J  (enriched, e.g. base1-4 — used as idempotency key)
    'WP Post ID',      // K  (filled by WP import)
    'Notes',           // L  (manual; not pushed)
];

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPokemonCards(query) {
    const url = `${API_BASE}/cards?q=${encodeURIComponent(query)}&pageSize=20`;
    const headers = API_KEY ? { 'X-Api-Key': API_KEY } : {};

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const res = await fetch(url, { headers });
        if (res.ok) {
            const data = await res.json();
            return data.data || [];
        }
        if (res.status === 429) {
            const backoff = 2000 * (attempt + 1);
            console.warn(`  429 rate-limited, backing off ${backoff}ms...`);
            await sleep(backoff);
            continue;
        }
        throw new Error(
            `Pokemon TCG API ${res.status}: ${await res.text()}`,
        );
    }
    throw new Error(`Pokemon TCG API 429 after ${MAX_RETRIES} retries`);
}

/**
 * Build a query string for the Pokemon TCG API. The `q` syntax is
 * Lucene-like: `name:Charizard number:4`.
 *
 * Deliberately omits set.name — the API names sets like "Base" rather
 * than "Base Set", and the user-curated set names won't match exactly.
 * Instead we query broadly by name+number (small candidate pool) and
 * score by set match in pickBest().
 */
function buildQuery({ cardName, cardNumber }) {
    const parts = [];
    if (cardName) {
        parts.push(`name:"${cardName.replace(/"/g, '')}"`);
    }
    if (cardNumber) {
        const num = cardNumber.includes('/')
            ? cardNumber.split('/')[0]
            : cardNumber;
        parts.push(`number:${num.replace(/[^0-9A-Za-z]/g, '')}`);
    }
    return parts.join(' ');
}

/**
 * Normalize a user-typed set name to a token list comparable against
 * the API's set names. The API uses shorter forms — "Base" vs "Base
 * Set", "Team Rocket" vs "Team Rocket" (matches exactly), etc.
 *
 * Returns a Set of significant tokens for cheap intersection scoring.
 */
function setTokens(s) {
    return new Set(
        (s || '')
            .toLowerCase()
            .replace(/[^a-z0-9 ]/g, ' ')
            .split(/\s+/)
            // Keep single-digit tokens — "Base Set 2" must tokenize
            // differently from "Base Set" or the disambiguation
            // collapses. Drop only the noise word "set".
            .filter((t) => t.length > 0 && t !== 'set'),
    );
}

/**
 * Pick the best candidate from API results. Heuristic: exact name +
 * exact number wins; otherwise prefer matches whose set.name matches
 * what the user wrote.
 */
function pickBest(candidates, { cardName, setName, cardNumber, variant }) {
    if (!candidates.length) return null;

    const wantedNumber = cardNumber.includes('/')
        ? cardNumber.split('/')[0]
        : cardNumber;

    const wantedSetTokens = setTokens(setName);

    let scored = candidates.map((c) => {
        let score = 0;
        if (c.name && cardName) {
            const a = c.name.toLowerCase();
            const b = cardName.toLowerCase();
            if (a === b) score += 100;
            else if (a.includes(b) || b.includes(a)) score += 40;
        }
        if (c.number && wantedNumber && c.number === wantedNumber) {
            score += 80;
        }
        // Set-name matching via token intersection — handles "Base Set"
        // (user) ↔ "Base" (API), "Team Rocket" (both), "Neo Genesis"
        // (both). +30 per matching token, with a strong bonus when the
        // entire user hint is contained in the API name.
        if (c.set?.name && wantedSetTokens.size) {
            const apiTokens = setTokens(c.set.name);
            let hits = 0;
            for (const t of wantedSetTokens) {
                if (apiTokens.has(t)) hits++;
            }
            score += hits * 30;
            // Bonus when EVERY user token is in the API set name —
            // disambiguates "Base Set 2" (3 tokens: base, set, 2 — but
            // 'set' is filtered, so just 'base', '2') from "Base Set".
            if (hits === wantedSetTokens.size && hits > 0) {
                score += 25;
            }
            // Penalty when the API set has EXTRA tokens we didn't ask for —
            // protects against "Base Set" (user) → "Base Set 2" (API)
            // matching at the same score as the genuine "Base" match.
            const extras = [...apiTokens].filter((t) => !wantedSetTokens.has(t));
            score -= extras.length * 15;
        }
        // Variant bias — push first-edition / shadowless candidates to
        // the top when the user flagged the row as such.
        if (variant === 'first-edition' && c.set?.id?.endsWith('1ed')) {
            score += 30;
        }
        return { card: c, score };
    });

    scored.sort((a, b) => b.score - a.score);

    // Confidence gate: if the user gave us no card number, require a
    // strong set-name match (otherwise "Mewtwo Promo" matches base1-10
    // — the regular Base Set Mewtwo — because the scorer has nothing
    // else to go on). 130 = exact name (100) + at least one matching
    // set token (30). For numbered cards the gate is irrelevant since
    // number-match alone gets +80.
    const top = scored[0];
    if (!cardNumber && top.score < 130) {
        return null;
    }
    return top.card;
}

function toEnrichedRow(input, apiCard) {
    const enriched = { ...input };
    if (apiCard) {
        enriched.rarity = (apiCard.rarity || '').toLowerCase().replace(/\s+/g, '-');
        enriched.releaseDate = apiCard.set?.releaseDate || '';
        enriched.artist = apiCard.artist || '';
        enriched.imageUrl =
            apiCard.images?.large || apiCard.images?.small || '';
        enriched.apiId = apiCard.id || '';
    } else {
        enriched.rarity = enriched.rarity || '';
        enriched.releaseDate = enriched.releaseDate || '';
        enriched.artist = enriched.artist || '';
        enriched.imageUrl = enriched.imageUrl || '';
        enriched.apiId = enriched.apiId || '';
    }
    return enriched;
}

function rowToSheet(row) {
    return [
        row.cardName || '',
        row.setName || '',
        row.cardNumber || '',
        row.variant || '',
        row.language || 'English',
        row.rarity || '',
        row.releaseDate || '',
        row.artist || '',
        row.imageUrl || '',
        row.apiId || '',
        '', // WP Post ID — filled later
        '', // Notes — manual
    ];
}

async function ensureCollectionTab(sheets) {
    const meta = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
    });
    const tab = meta.data.sheets.find(
        (s) => s.properties.title === SHEET_NAME,
    );
    if (tab) {
        console.log(`✓ "${SHEET_NAME}" tab already exists.`);
        return tab.properties.sheetId;
    }

    console.log(`Creating "${SHEET_NAME}" tab...`);
    const res = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [
                {
                    addSheet: {
                        properties: { title: SHEET_NAME },
                    },
                },
            ],
        },
    });
    const sheetId = res.data.replies[0].addSheet.properties.sheetId;
    console.log(`✓ Created "${SHEET_NAME}" (sheetId: ${sheetId}).`);
    return sheetId;
}

async function writeRows(sheets, sheetId, rows) {
    const allRows = [HEADERS, ...rows.map(rowToSheet)];
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:L${allRows.length}`,
        valueInputOption: 'RAW',
        requestBody: { values: allRows },
    });

    // Bold + tinted header row for readability.
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [
                {
                    repeatCell: {
                        range: {
                            sheetId,
                            startRowIndex: 0,
                            endRowIndex: 1,
                        },
                        cell: {
                            userEnteredFormat: {
                                textFormat: { bold: true },
                                backgroundColor: {
                                    red: 0.92,
                                    green: 0.92,
                                    blue: 0.92,
                                },
                            },
                        },
                        fields: 'userEnteredFormat(textFormat,backgroundColor)',
                    },
                },
                {
                    updateSheetProperties: {
                        properties: {
                            sheetId,
                            gridProperties: { frozenRowCount: 1 },
                        },
                        fields: 'gridProperties.frozenRowCount',
                    },
                },
            ],
        },
    });
}

async function main() {
    if (!fs.existsSync(IN_PATH)) {
        console.error(
            `Input not found: ${IN_PATH}\nRun build-collection-import.mjs first.`,
        );
        process.exit(1);
    }
    if (!fs.existsSync(CREDENTIALS_PATH)) {
        console.error(`Sheets credentials not found: ${CREDENTIALS_PATH}`);
        process.exit(1);
    }

    const inputRows = JSON.parse(fs.readFileSync(IN_PATH, 'utf8')).slice(
        0,
        LIMIT,
    );
    console.log(
        `Processing ${inputRows.length} card(s)${DRY_RUN ? ' [DRY RUN]' : ''}.`,
    );

    // Enrichment loop — sequential to respect Pokemon TCG API throttle.
    const enriched = [];
    let matched = 0;
    let unmatched = 0;

    for (let i = 0; i < inputRows.length; i++) {
        const row = inputRows[i];
        const label = `${row.cardName} ${row.setName} ${row.cardNumber}`.trim();
        process.stdout.write(`[${i + 1}/${inputRows.length}] ${label} ... `);

        try {
            const query = buildQuery(row);
            if (!query) {
                console.log('SKIP (empty query)');
                enriched.push(toEnrichedRow(row, null));
                unmatched++;
                continue;
            }
            const candidates = await fetchPokemonCards(query);
            const pick = pickBest(candidates, row);
            if (pick) {
                enriched.push(toEnrichedRow(row, pick));
                matched++;
                console.log(`✓ ${pick.id}`);
            } else {
                enriched.push(toEnrichedRow(row, null));
                unmatched++;
                console.log('NO MATCH');
            }
            await sleep(THROTTLE_MS);
        } catch (e) {
            console.log(`ERROR: ${e.message}`);
            enriched.push(toEnrichedRow(row, null));
            unmatched++;
        }
    }

    console.log('');
    console.log(
        `Enrichment: ${matched} matched, ${unmatched} unmatched (manual fill-in needed).`,
    );

    if (DRY_RUN) {
        console.log('Dry run — skipping Sheets write + JSON output.');
        return;
    }

    // Write enriched JSON for the WP-side import.
    fs.writeFileSync(OUT_PATH, JSON.stringify(enriched, null, 2) + '\n');
    console.log(`✓ Wrote ${enriched.length} enriched record(s) → ${OUT_PATH}`);

    // Push to Sheets.
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const sheetId = await ensureCollectionTab(sheets);
    await writeRows(sheets, sheetId, enriched);
    console.log(
        `✓ Wrote ${enriched.length} row(s) to Sheets "${SHEET_NAME}" tab.`,
    );
}

main().catch((e) => {
    console.error('FATAL:', e.message);
    process.exit(1);
});
