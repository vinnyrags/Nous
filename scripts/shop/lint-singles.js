/**
 * Lint the Singles sheet before pushing to Stripe.
 *
 * Catches the data-entry classes of bug we hit during the first ~340 cards:
 *   1. Required cells missing (name, price, stock, number, set name)
 *   2. Variant column K using set names / unknown labels
 *   3. R (API ID) doesn't resolve in pokemontcg.io
 *   4. R's set doesn't match column J (set code) — common when
 *      "SM Base Set" gets a Promo (smp) ID
 *   5. R's printed number doesn't match column H — common when H still
 *      has a game-series tag ("XY"/"SM") instead of a real number
 *   6. K-flavored rows pointing at a non-K entry
 *      ("Alternate Full Art" → swsh5-154 instead of swsh5-155)
 *
 * Doesn't touch the sheet — read-only.
 *
 * Usage:
 *   node scripts/shop/lint-singles.js                 # all checks, exit 1 if any errors
 *   node scripts/shop/lint-singles.js --warn-only     # exit 0 even on errors
 *   node scripts/shop/lint-singles.js --row=42        # lint one row
 *   node scripts/shop/lint-singles.js --quiet         # suppress per-row OK lines
 *
 * Hook into the pipeline (recommended):
 *   make lint-singles && make push-cards
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';

const args = process.argv.slice(2);
const WARN_ONLY = args.includes('--warn-only');
const QUIET = args.includes('--quiet');
const ROW_ARG = args.find((a) => a.startsWith('--row='));
const ONLY_ROW = ROW_ARG ? parseInt(ROW_ARG.split('=')[1], 10) : null;

const COL = {
    A: 0, B: 1, C: 2, D: 3, E: 4,
    F: 5, G: 6, H: 7, I: 8, J: 9,
    K: 10, L: 11, M: 12, N: 13, O: 14,
    P: 15, Q: 16, R: 17, S: 18, T: 19,
};

// Recognized variant labels. Anything outside this set gets a warning so
// the operator can either fix the typo or extend the list.
const KNOWN_VARIANTS = new Set([
    '',
    'Full Art',
    'Alternate Full Art',
    'Secret',
    'Secret Full Art',
    'Alternate Art Secret',
    'Trainer Gallery',
    'Cosmos Holo',
    'Holo Common',
    'Shiny',
    'Shining',
    'Prerelease',
    'Promo',
    'Delta Species',
    'Special Illustration',
    'Illustration Rare',
]);

function setIdFromApiId(apiId) {
    if (!apiId || !apiId.includes('-')) return null;
    return apiId.slice(0, apiId.lastIndexOf('-'));
}

function normalizeNumber(num) {
    // "60/98" → "60"; "033/167" → "33"; "SWSH076" stays.
    if (!num) return '';
    let n = num.trim();
    if (n.includes('/')) n = n.split('/')[0].trim();
    // Strip leading zeros from purely-numeric forms; preserve letter prefixes.
    if (/^\d+$/.test(n)) n = String(parseInt(n, 10));
    return n;
}

/**
 * Compare a sheet set-name against an API set-name with loose tokenization.
 * Both "XY Promos" and "XY Black Star Promos" should align since they
 * describe the same set; "Blister Exclusives" should NOT align with
 * "Plasma Freeze". Strategy: take the meaningful tokens (non-stop-word,
 * length ≥ 3) from each side and require the shorter set to be a subset
 * of the longer.
 */
function setNamesAlign(a, b) {
    const stop = new Set(['set', 'and', 'the', 'of']);
    // NFKD strips combining marks: "Pokémon" → "Pokemon".
    const stripDiacritics = (s) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    const expand = (s) => SET_NAME_ALIASES.get(stripDiacritics(s).toLowerCase().trim()) || s;
    const tokenize = (s) =>
        stripDiacritics(expand(s))
            .toLowerCase()
            .replace(/[:—–\-_/&]+/g, ' ')
            .split(/\s+/)
            .map((t) => t.replace(/[^a-z0-9]/g, ''))
            .filter((t) => t.length >= 3 && !stop.has(t));
    const A = new Set(tokenize(a));
    const B = new Set(tokenize(b));
    if (A.size === 0 || B.size === 0) return true; // can't tell — don't warn
    const [small, big] = A.size <= B.size ? [A, B] : [B, A];
    let overlap = 0;
    for (const t of small) if (big.has(t)) overlap++;
    return overlap === small.size;
}

function isAltFlavored(variant) {
    return /(alternate|alt\s*art|alt\s*full)/i.test(variant);
}

const ULTRA = new Set(['Rare Ultra']);
const SECRET = new Set([
    'Rare Secret',
    'Rare Rainbow',
    'Rare Shiny',
    'Rare Shiny GX',
    'Rare Rainbow GX',
    'Hyper Rare',
    'Special Illustration Rare',
    'Illustration Rare',
]);

function altTier(variant) {
    if (/(secret|rainbow|gold|hyper|illustration)/i.test(variant)) return 'secret';
    return 'ultra';
}

async function fetchSet(setId) {
    // Single set query, retry once on 429 with backoff. Returns array.
    for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch('https://api.pokemontcg.io/v2/cards?q=set.id:' + encodeURIComponent(setId) + '&pageSize=250');
        if (res.ok) return (await res.json()).data || [];
        if (res.status === 429 && attempt === 0) {
            await new Promise((r) => setTimeout(r, 2500));
            continue;
        }
        throw new Error('API ' + res.status + ' for set ' + setId);
    }
}

// Known colloquial set-name aliases. Keep small — only add when a real
// row uses a label the API doesn't recognize verbatim.
const SET_NAME_ALIASES = new Map([
    ['sm base set', 'sun & moon'],
    ['xy base set', 'xy'],
    ['bw base set', 'black & white'],
    ['swsh: sword & shield promo cards', 'swsh black star promos'],
    ['xy promos', 'xy black star promos'],
    ['sm promos', 'sm black star promos'],
]);

async function main() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:T`,
    });
    const rows = res.data.values || [];

    let errorCount = 0;
    let warnCount = 0;
    const setCache = new Map(); // setId → cards[]

    // Pre-fetch every distinct set referenced by column R. Way fewer API
    // hits than fetching each card individually — 30-50 calls instead of
    // 339 — and avoids the 429 rate-limit spam.
    const allSetIds = new Set();
    for (const row of rows) {
        const apiId = (row[COL.R] || '').trim();
        const setId = setIdFromApiId(apiId);
        if (setId) allSetIds.add(setId);
    }
    console.log(`Pre-fetching ${allSetIds.size} distinct set(s)...`);
    let setIdx = 0;
    for (const setId of allSetIds) {
        setIdx++;
        process.stdout.write(`  [${setIdx}/${allSetIds.size}] ${setId}... `);
        try {
            const cards = await fetchSet(setId);
            setCache.set(setId, cards);
            console.log(`${cards.length} cards`);
        } catch (err) {
            console.log(`FAIL — ${err.message}`);
            setCache.set(setId, []);
        }
        // Pokemon TCG API allows 30 req/min unauthenticated. Pace at ~1/s.
        await new Promise((r) => setTimeout(r, 1100));
    }
    console.log();
    const cardLookup = (apiId) => {
        const setId = setIdFromApiId(apiId);
        if (!setId) return null;
        const set = setCache.get(setId) || [];
        return set.find((c) => c.id === apiId) || null;
    };

    for (let i = 0; i < rows.length; i++) {
        const sheetRow = i + 2;
        if (ONLY_ROW && sheetRow !== ONLY_ROW) continue;
        const row = rows[i];

        const name = (row[COL.A] || '').trim();
        const price = (row[COL.E] || '').trim();
        const stock = (row[COL.F] || '').trim();
        const number = (row[COL.H] || '').trim();
        const setName = (row[COL.I] || '').trim();
        const setCode = (row[COL.J] || '').trim();
        const variant = (row[COL.K] || '').trim();
        const apiId = (row[COL.R] || '').trim();

        const issues = [];

        // 1. Required cells
        if (!name)    issues.push({ sev: 'error', msg: 'A (name) is empty' });
        if (!price)   issues.push({ sev: 'error', msg: 'E (price) is empty' });
        if (!stock)   issues.push({ sev: 'error', msg: 'F (stock) is empty' });
        if (!number)  issues.push({ sev: 'warn',  msg: 'H (card number) is empty — matching may pick wrong API entry' });
        if (!setName) issues.push({ sev: 'warn',  msg: 'I (set name) is empty — matching may pick wrong set' });

        // 2. Variant label sanity
        if (variant && !KNOWN_VARIANTS.has(variant)) {
            issues.push({ sev: 'warn', msg: `K (variant) = "${variant}" is not a known label; review for typo or extend KNOWN_VARIANTS in lint-singles.js` });
        }

        // 3-6 require an API ID. Skip if blank (will be filled by enrich).
        if (!apiId) {
            issues.push({ sev: 'info', msg: 'R (API ID) blank — run enrich-singles to fill' });
        } else {
            // 3. R resolves (via the pre-fetched set cache)
            const card = cardLookup(apiId);
            if (!card) {
                issues.push({ sev: 'error', msg: `R=${apiId} does not exist in pokemontcg.io (or its set failed to fetch)` });
            } else {
                // 5. Number match (loose — allow "60" vs "60/98" forms)
                const apiNum = (card.number || '').toString();
                const sheetNumNorm = normalizeNumber(number);
                if (sheetNumNorm && apiNum && apiNum.toLowerCase() !== sheetNumNorm.toLowerCase()) {
                    issues.push({ sev: 'warn', msg: `H=${number} but R=${apiId} prints as #${apiNum}` });
                }

                // 4. Set rough match — compare normalized tokens, not raw strings
                if (setName && card.set.name && !setNamesAlign(setName, card.set.name)) {
                    issues.push({ sev: 'warn', msg: `I="${setName}" but R=${apiId} is from "${card.set.name}"` });
                }

                // 6. Alt-flavored row pointing at non-alt entry
                if (isAltFlavored(variant)) {
                    const setId = setIdFromApiId(apiId);
                    const setCards = setCache.get(setId) || [];
                    const tier = altTier(variant);
                    const tierSet = tier === 'ultra' ? ULTRA : SECRET;
                    const sameNameSameTier = setCards
                        .filter((c) => c.name.toLowerCase().replace(/-(gx|ex|v|vmax|vstar)\b/g, ' $1').replace(/\s+/g, ' ').trim() ===
                                       (card.name || '').toLowerCase().replace(/-(gx|ex|v|vmax|vstar)\b/g, ' $1').replace(/\s+/g, ' ').trim())
                        .filter((c) => tierSet.has(c.rarity || ''))
                        .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));
                    if (sameNameSameTier.length >= 2 && sameNameSameTier[0].id === apiId) {
                        const expected = sameNameSameTier[1];
                        issues.push({ sev: 'error', msg: `K="${variant}" but R=${apiId} is the FIRST ${tier}-tier entry; expected ${expected.id} (#${expected.number})` });
                    }
                }
            }
        }

        if (issues.length === 0) {
            if (!QUIET) console.log(`  ✓ row ${sheetRow}: ${name}${variant ? ' — ' + variant : ''}`);
            continue;
        }

        const hasError = issues.some((x) => x.sev === 'error');
        const tag = hasError ? '✗' : '⚠';
        console.log(`${tag} row ${sheetRow}: ${name}${variant ? ' — ' + variant : ''}`);
        for (const issue of issues) {
            const prefix = issue.sev === 'error' ? '    error:' : (issue.sev === 'warn' ? '    warn: ' : '    info: ');
            console.log(prefix + ' ' + issue.msg);
            if (issue.sev === 'error') errorCount++;
            else if (issue.sev === 'warn') warnCount++;
        }
    }

    console.log(`\n${errorCount} error(s), ${warnCount} warning(s).`);
    if (errorCount > 0 && !WARN_ONLY) process.exit(1);
}

main().catch((err) => {
    console.error('Lint failed:', err.stack || err.message);
    process.exit(1);
});
