/**
 * Enrich the Singles tab via the Pokemon TCG API.
 *
 * Assumes the sheet has been migrated to the A-T schema (see
 * scripts/shop/migrate-singles-schema.js). For each row, queries
 * api.pokemontcg.io with parsed Card Name + Card Number and fills
 * the still-blank enrichment slots:
 *
 *   I  Set Name        (only if blank — preserves manual overrides)
 *   J  Set Code        (only if blank)
 *   L  Rarity          (normalized to one of: common, uncommon, rare,
 *                        holo-rare, ultra-rare, secret, promo)
 *   O  Image URL
 *   P  Release Year
 *   Q  Artist
 *   R  Pokemon TCG API ID (e.g. "base1-4")
 *
 * Idempotent — skips rows that are already fully enriched. Logs
 * unmatched rows so they can be hand-corrected.
 *
 * Usage:
 *   node scripts/shop/enrich-singles.js --dry-run
 *   node scripts/shop/enrich-singles.js
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';
const API_BASE = 'https://api.pokemontcg.io/v2';
const THROTTLE_MS = 400; // free tier = ~30 req/min; keep us well under
const API_KEY = process.env.POKEMON_TCG_API_KEY || '';
const MAX_RETRIES = 3;

const DRY_RUN = process.argv.includes('--dry-run');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : Infinity;

// Column indices for the A-T schema.
const COL = {
    A: 0, // Card Name
    H: 7, // Card Number
    I: 8, // Set Name
    J: 9, // Set Code
    K: 10, // Variant
    L: 11, // Rarity
    O: 14, // Image URL
    P: 15, // Release Year
    Q: 16, // Artist
    R: 17, // Pokemon TCG API ID
    T: 19, // Notes
};

const RARITY_MAP = {
    common: 'common',
    uncommon: 'uncommon',
    rare: 'rare',
    'rare holo': 'holo-rare',
    'rare holo ex': 'holo-rare',
    'rare holo gx': 'ultra-rare',
    'rare holo v': 'ultra-rare',
    'rare holo vmax': 'ultra-rare',
    'rare holo vstar': 'ultra-rare',
    'rare holo lv.x': 'ultra-rare',
    'rare ultra': 'ultra-rare',
    'rare secret': 'secret',
    'rare rainbow': 'secret',
    'rare shiny': 'ultra-rare',
    'rare shiny gx': 'ultra-rare',
    'rare shiny v': 'ultra-rare',
    'rare shining': 'ultra-rare',
    'rare prism star': 'ultra-rare',
    'rare break': 'ultra-rare',
    'rare ace': 'ultra-rare',
    'amazing rare': 'ultra-rare',
    'rare prime': 'ultra-rare',
    'rare holo star': 'ultra-rare',
    'rare radiant': 'ultra-rare',
    promo: 'promo',
    'rare promo': 'promo',
    'classic collection': 'secret',
    'illustration rare': 'secret',
    'special illustration rare': 'secret',
    'hyper rare': 'secret',
    'double rare': 'ultra-rare',
    'ultra rare': 'ultra-rare',
    'trainer gallery rare holo': 'holo-rare',
};

function normalizeRarity(apiRarity) {
    if (!apiRarity) return '';
    const key = apiRarity.toLowerCase().trim();
    return RARITY_MAP[key] || 'rare'; // safe fallback
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize a card-number string for Pokemon TCG API queries.
 *
 * The API stores promo numbers verbatim with the set prefix ("XY69",
 * "SWSH001") but set-card numbers without the total ("83" not "83/116").
 * We try the raw form first, then fall back to a letters-stripped
 * version for the odd set that uses the bare digits.
 */
function normalizeNumber(number) {
    if (!number) return null;

    // "83/116" → "83"; leave promo numbers like "XY69" intact.
    const raw = number.includes('/') ? number.split('/')[0] : number;

    // "XY69" → "69" fallback in case the API happens to use the stripped form
    const stripped = raw.replace(/^[A-Za-z]+/, '');

    return {
        raw,
        stripped: stripped || raw,
    };
}

/**
 * Strip trailing parenthetical content from a card name
 * ("Rapid Strike Urshifu VMAX (Alternate Art Secret)" → "Rapid Strike
 * Urshifu VMAX"). Also pulls out an embedded number if one appears in
 * the parens like "(146 Full Art)".
 */
function stripParensFromName(name) {
    let cleaned = name;
    let embeddedNumber = null;
    while (true) {
        const m = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(cleaned);
        if (!m) break;
        const inner = m[2].trim();
        // Detect number inside parens (e.g. "146 Full Art", "176")
        const numMatch = /^(\d+)(?:\s+.+)?$/.exec(inner);
        if (numMatch && !embeddedNumber) embeddedNumber = numMatch[1];
        cleaned = m[1].trim();
    }
    return { name: cleaned, embeddedNumber };
}

/**
 * Generate alternate spellings of a card name that the API might use.
 * The Pokemon TCG API hyphenates form suffixes (`Rayquaza EX` →
 * `Rayquaza-EX`, `Umbreon VMAX` → `Umbreon-VMAX`).
 */
function nameVariants(name) {
    const variants = [name];
    const HYPHEN_SUFFIXES = ['EX', 'GX', 'V', 'VMAX', 'VSTAR', 'BREAK', 'LV.X'];
    for (const suffix of HYPHEN_SUFFIXES) {
        const re = new RegExp('\\s+' + suffix.replace(/\./g, '\\.') + '\\b', 'g');
        if (re.test(name)) {
            const hyphenated = name.replace(re, '-' + suffix);
            if (!variants.includes(hyphenated)) variants.push(hyphenated);
        }
    }
    return variants;
}

/**
 * Build a Pokemon TCG API query. Prefers name + stripped number + set name.
 */
function buildQuery(name, number, setHint) {
    const parts = [];
    const safeName = name.replace(/"/g, '\\"');
    parts.push(`name:"${safeName}"`);

    if (number) {
        parts.push(`number:"${number}"`);
    }

    if (setHint) {
        // Use the distinctive part of the set hint (trim trailing " Promos" etc.)
        const safeSet = setHint.replace(/"/g, '\\"');
        parts.push(`set.name:"${safeSet}"`);
    }

    return parts.join(' ');
}

async function fetchCards(query) {
    const url = `${API_BASE}/cards?q=${encodeURIComponent(query)}&pageSize=10`;
    const headers = API_KEY ? { 'X-Api-Key': API_KEY } : {};

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const res = await fetch(url, { headers });
        if (res.ok) {
            const data = await res.json();
            return data.data || [];
        }
        if (res.status === 429) {
            const backoff = 2000 * (attempt + 1);
            await sleep(backoff);
            continue;
        }
        throw new Error(`Pokemon TCG API ${res.status}: ${await res.text()}`);
    }
    throw new Error(`Pokemon TCG API 429 after ${MAX_RETRIES} retries`);
}

/**
 * Strip the user's internal set prefix ("SWSH05: ", "SWSH09: ", etc.)
 * from the beginning of a set hint. The API uses bare set names.
 */
function cleanSetHint(hint) {
    if (!hint) return '';
    return hint.replace(/^[A-Z]+\d*:\s*/, '').trim();
}

function pickBestMatch(candidates, name, setHint) {
    if (!candidates.length) return null;

    // Exact (case-insensitive) name match preferred
    const exact = candidates.filter(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    const pool = exact.length ? exact : candidates;

    // If we have a set hint, prefer matches whose set name contains it
    if (setHint) {
        const setMatches = pool.filter((c) =>
            (c.set?.name || '').toLowerCase().includes(setHint.toLowerCase()),
        );
        if (setMatches.length) return setMatches[0];
    }

    // Otherwise the most-recent release wins
    return pool.slice().sort((a, b) => {
        const da = a.set?.releaseDate || '';
        const db = b.set?.releaseDate || '';
        return db.localeCompare(da);
    })[0];
}

async function main() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:T`,
    });

    const rows = res.data.values || [];
    if (!rows.length) {
        console.log('No rows.');
        return;
    }

    console.log(`Scanning ${rows.length} rows...${DRY_RUN ? ' [dry-run]' : ''}\n`);

    const updates = [];
    const logs = {
        enriched: 0,
        alreadyComplete: 0,
        noMatch: [],
        apiError: [],
    };

    let processed = 0;
    for (let i = 0; i < rows.length; i++) {
        if (processed >= LIMIT) break;
        const row = rows[i];
        const sheetRow = i + 2;

        const name = (row[COL.A] || '').trim();
        const number = (row[COL.H] || '').trim();
        const rawSetHint = (row[COL.I] || '').trim();
        const setHint = cleanSetHint(rawSetHint);

        if (!name) continue;

        // Skip fully-enriched rows
        const rarity = (row[COL.L] || '').trim();
        const image = (row[COL.O] || '').trim();
        const year = (row[COL.P] || '').trim();
        const artist = (row[COL.Q] || '').trim();
        const apiId = (row[COL.R] || '').trim();
        if (rarity && image && year && artist && apiId) {
            logs.alreadyComplete++;
            continue;
        }

        // Build a cascading list of queries from most-specific to most-permissive
        const cleaned = stripParensFromName(name);
        const searchName = cleaned.name || name;
        const searchNumber = number || cleaned.embeddedNumber || '';
        const norm = normalizeNumber(searchNumber);
        const variants = nameVariants(searchName);
        const queryAttempts = [];

        // Most specific: name variant + number + set
        for (const v of variants) {
            if (norm && setHint) queryAttempts.push(buildQuery(v, norm.raw, setHint));
        }
        // name variant + number (raw and stripped)
        for (const v of variants) {
            if (norm) queryAttempts.push(buildQuery(v, norm.raw, null));
        }
        for (const v of variants) {
            if (norm && norm.stripped !== norm.raw) {
                queryAttempts.push(buildQuery(v, norm.stripped, null));
            }
        }
        // name variant + set (no number)
        for (const v of variants) {
            if (setHint) queryAttempts.push(buildQuery(v, null, setHint));
        }
        // Bare name variant
        for (const v of variants) {
            queryAttempts.push(buildQuery(v, null, null));
        }

        let candidates = [];
        for (const q of queryAttempts) {
            try {
                candidates = await fetchCards(q);
            } catch (e) {
                logs.apiError.push({ row: sheetRow, name, error: e.message });
                candidates = [];
            }
            await sleep(THROTTLE_MS);
            if (candidates.length) break;
        }

        const match = pickBestMatch(candidates, name, setHint);
        if (!match) {
            logs.noMatch.push({ row: sheetRow, name, number, setHint });
            continue;
        }

        // Build cell updates — only fill blanks (preserve manual edits)
        const apiSetName = match.set?.name || '';
        const apiSetId = match.set?.id || '';
        const apiRarity = normalizeRarity(match.rarity);
        const apiImage = match.images?.large || match.images?.small || '';
        const apiYear = match.set?.releaseDate ? match.set.releaseDate.slice(0, 4) : '';
        const apiArtist = match.artist || '';
        const apiCardId = match.id || '';

        const writes = {};
        if (!setHint && apiSetName) writes.I = apiSetName;
        if (!(row[COL.J] || '').trim() && apiSetId) writes.J = apiSetId;
        if (!rarity && apiRarity) writes.L = apiRarity;
        if (!image && apiImage) writes.O = apiImage;
        if (!year && apiYear) writes.P = apiYear;
        if (!artist && apiArtist) writes.Q = apiArtist;
        if (!apiId && apiCardId) writes.R = apiCardId;

        for (const [col, value] of Object.entries(writes)) {
            updates.push({
                range: `${SHEET_NAME}!${col}${sheetRow}`,
                values: [[value]],
            });
        }

        logs.enriched++;
        processed++;
        const summary = [
            writes.I ? `set="${writes.I}"` : null,
            writes.L ? `rarity=${writes.L}` : null,
            writes.P ? `year=${writes.P}` : null,
            writes.Q ? `artist="${writes.Q}"` : null,
        ].filter(Boolean).join(' ');
        console.log(`  Row ${sheetRow}: ${name}${number ? ' #' + number : ''} → ${summary}`);
    }

    console.log(`\n=== Summary ===`);
    console.log(`  enriched:         ${logs.enriched}`);
    console.log(`  already complete: ${logs.alreadyComplete}`);
    console.log(`  no-match:         ${logs.noMatch.length}`);
    console.log(`  API errors:       ${logs.apiError.length}`);
    console.log(`  cell writes:      ${updates.length}`);

    if (logs.noMatch.length) {
        console.log('\n=== No match (manual review) ===');
        logs.noMatch.slice(0, 30).forEach((r) =>
            console.log(`  Row ${r.row}: ${r.name}${r.number ? ' #' + r.number : ''} (set hint: "${r.setHint}")`),
        );
        if (logs.noMatch.length > 30) {
            console.log(`  ... and ${logs.noMatch.length - 30} more`);
        }
    }

    if (logs.apiError.length) {
        console.log('\n=== API errors ===');
        logs.apiError.slice(0, 10).forEach((r) =>
            console.log(`  Row ${r.row}: ${r.name} — ${r.error}`),
        );
    }

    if (DRY_RUN) {
        console.log(`\n[dry-run] No changes written.`);
        return;
    }

    if (!updates.length) {
        console.log('\nNothing to write.');
        return;
    }

    console.log(`\nWriting ${updates.length} cell update(s) in batches...`);
    // Chunk at 500 ranges per batch to stay comfortably under API limits
    const CHUNK = 500;
    for (let i = 0; i < updates.length; i += CHUNK) {
        const chunk = updates.slice(i, i + CHUNK);
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { valueInputOption: 'RAW', data: chunk },
        });
        console.log(`  ✓ wrote batch ${Math.floor(i / CHUNK) + 1} (${chunk.length} cells)`);
    }
    console.log(`\n✓ Enrichment complete.`);
}

main().catch((err) => {
    console.error('Enrichment failed:', err.message);
    process.exit(1);
});
