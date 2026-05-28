/**
 * Enrich Japanese cards in the Singles tab via TCGplayer's public catalog.
 *
 * The Pokemon TCG API (api.pokemontcg.io) and TCGdex both lack usable
 * per-card Japanese data — TCGdex has Japanese SET metadata (names,
 * release dates) but its Japanese card endpoints return empty, and
 * pokemontcg.io is English-only. TCGplayer's public mp-search API
 * (no key) DOES index Japanese cards under productLineName
 * "pokemon-japan", with the same English collector set names the sheet
 * uses (e.g. sheet "Eevee Heroes" → TCGplayer "S6a: Eevee Heroes"), and
 * its product-image CDN serves clean scans with no auth.
 *
 * For each targeted row this:
 *   - searches TCGplayer (productName = card name, line = pokemon-japan)
 *   - scores candidates by number + set-name match (number is decisive)
 *   - writes the still-blank enrichment slots:
 *       K  Set Code   (the "S6a" prefix parsed off TCGplayer's setName)
 *       M  Rarity     (TCGplayer rarity, normalized — often absent for JP)
 *       O  Language   ("Japanese")
 *       P  Image URL  (product-images.tcgplayer.com/fit-in/1500x1500/{id}.jpg)
 *       Q  Release    (set release date from TCGdex, best-effort)
 *       S  Ref ID     ("tcgp-{productId}" — provenance + idempotency marker)
 *
 * Release date and rarity are best-effort; the image is the point.
 * Idempotent: a row with column P already filled is skipped (unless --force).
 *
 * Usage:
 *   node scripts/shop/enrich-singles-japanese.mjs --dry-run
 *   node scripts/shop/enrich-singles-japanese.mjs
 *   node scripts/shop/enrich-singles-japanese.mjs --from=523 --to=668
 *   node scripts/shop/enrich-singles-japanese.mjs --row=534
 */

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';

const TCG_SEARCH = 'https://mp-search-api.tcgplayer.com/v1/search/request?q=%20&isList=true&mpfev=2042';
const TCG_IMAGE = (pid) => `https://product-images.tcgplayer.com/fit-in/1500x1500/${pid}.jpg`;
const TCGDEX_SET = (code) => `https://api.tcgdex.net/v2/ja/sets/${code}`;
const USER_AGENT =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const THROTTLE_MS = 350;

const DRY_RUN = process.argv.includes('--dry-run');
const FORCE = process.argv.includes('--force');
const arg = (name, def) => {
    const a = process.argv.find((x) => x.startsWith(`--${name}=`));
    return a ? parseInt(a.split('=')[1], 10) : def;
};
const FROM = arg('from', 523);
const TO = arg('to', 668);
const ONLY_ROW = arg('row', null);
// Matches scoring below this are logged but NOT written — guards against
// attaching a wrong image when the card name/number/set don't agree.
const MIN_SCORE = arg('min-score', 0);

// A-U schema (BIN Price inserted at F on 2026-05-25).
const COL = {
    A: 0, E: 4, F: 5, G: 6, I: 8, J: 9, K: 10,
    L: 11, M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19,
};

// TCGplayer JP rarity strings → our internal vocabulary (same target set
// used by enrich-singles.js). JP rarities are frequently absent in the
// search payload; we only write M when we actually get one.
const RARITY_MAP = {
    common: 'common',
    uncommon: 'uncommon',
    rare: 'rare',
    'holo rare': 'holo-rare',
    'double rare': 'ultra-rare',
    'ultra rare': 'ultra-rare',
    'super rare': 'ultra-rare',
    'special art rare': 'secret',
    'art rare': 'secret',
    'special rare': 'secret',
    'shiny rare': 'ultra-rare',
    'shiny super rare': 'secret',
    'hyper rare': 'secret',
    'secret rare': 'secret',
    'amazing rare': 'ultra-rare',
    'radiant rare': 'ultra-rare',
    'illustration rare': 'secret',
    'special illustration rare': 'secret',
    promo: 'promo',
    'rare holo': 'holo-rare',
};

function normalizeRarity(raw) {
    if (!raw) return '';
    const key = String(raw).toLowerCase().trim();
    return RARITY_MAP[key] || '';
}

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

/** "085/069" or "85" → "85" (before slash, leading zeros stripped). */
function normNum(n) {
    if (!n) return '';
    let s = String(n).trim();
    if (s.includes('/')) s = s.split('/')[0];
    s = s.replace(/^0+/, '');
    return s || '0';
}

/** Pull a number out of a TCGplayer productName like "Umbreon V - 085/069". */
function numberFromProductName(name) {
    const m = /\s-\s*(\d+[A-Za-z]?\/\d+|\d+)\s*$/.exec(name || '');
    return m ? m[1] : '';
}

/** Strip the " - 085/069" suffix and trailing variant noise from a productName. */
function cleanProductName(name) {
    return (name || '').replace(/\s-\s*\d+[A-Za-z]?\/?\d*\s*$/, '').trim();
}

/** Strip parenthetical variant text from a sheet card name. */
function baseName(name) {
    return (name || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
}

function normalizeName(s) {
    return (s || '')
        .toLowerCase()
        .replace(/[-'.,&]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

async function tcgSearch(cardName) {
    const body = JSON.stringify({
        algorithm: '',
        from: 0,
        size: 50,
        filters: {
            term: { productLineName: ['pokemon-japan'] },
            range: {},
            match: {},
        },
        context: { shippingCountry: 'US' },
    });
    // The free-text query goes in the URL `q`; rebuild it per card.
    const url = TCG_SEARCH.replace('q=%20', `q=${encodeURIComponent(cardName)}`);
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': USER_AGENT,
        },
        body,
    });
    if (!res.ok) throw new Error(`TCGplayer ${res.status}`);
    const data = await res.json();
    return data.results?.[0]?.results || [];
}

/**
 * Score a TCGplayer candidate against the sheet row. Number match is
 * decisive; set-name and card-name matches break ties and guard against
 * a same-number card from the wrong set.
 */
function scoreCandidate(cand, { name, number, setName }) {
    let score = 0;
    const ca = cand.customAttributes || {};
    const candNum = normNum(ca.number || numberFromProductName(cand.productName));
    const wantNum = normNum(number);

    if (wantNum && candNum) {
        if (candNum === wantNum) score += 100;
        else score -= 40; // wrong number is a strong negative
    }

    const candSet = (cand.setName || '').toLowerCase();
    const wantSet = (setName || '').toLowerCase();
    if (wantSet && candSet) {
        // TCGplayer prefixes "S6a: " — substring match handles it.
        if (candSet.includes(wantSet)) score += 60;
        else {
            // token overlap fallback
            const wt = new Set(wantSet.split(/\s+/).filter((w) => w.length > 2));
            const ct = candSet.split(/\s+/);
            const overlap = ct.filter((t) => wt.has(t)).length;
            score += overlap * 15;
            if (overlap === 0) score -= 20;
        }
    }

    const candName = normalizeName(cleanProductName(cand.productName));
    const wantName = normalizeName(name);
    if (candName === wantName) score += 50;
    else if (candName.includes(wantName) || wantName.includes(candName)) score += 25;
    else {
        const wt = new Set(wantName.split(/\s+/).filter(Boolean));
        const overlap = candName.split(/\s+/).filter((t) => wt.has(t)).length;
        score += overlap * 8;
    }

    // Penalize obvious non-singles (booster packs/boxes) that share a name token.
    if (/booster (pack|box)|booster$|deck$|box$|case$/i.test(cand.productName || '')) score -= 80;

    return score;
}

function pickBest(cands, ctx) {
    if (!cands.length) return null;
    const scored = cands
        .map((c) => ({ c, s: scoreCandidate(c, ctx) }))
        .sort((a, b) => b.s - a.s);
    const top = scored[0];
    return top && top.s > 0 ? { ...top.c, _score: top.s } : null;
}

const setDateCache = new Map();
async function setReleaseDate(setCode) {
    if (!setCode) return '';
    if (setDateCache.has(setCode)) return setDateCache.get(setCode);
    let date = '';
    try {
        const res = await fetch(TCGDEX_SET(setCode), { headers: { 'User-Agent': USER_AGENT } });
        if (res.ok) {
            const d = await res.json();
            date = (d.releaseDate || '').replace(/\//g, '-');
        }
    } catch {
        /* best-effort */
    }
    setDateCache.set(setCode, date);
    return date;
}

/** "S6a: Eevee Heroes" → "S6a". */
function setCodeFromTcgSetName(setName) {
    const m = /^([A-Za-z0-9.]+):\s*/.exec(setName || '');
    return m ? m[1] : '';
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
        range: `${SHEET_NAME}!A2:U`,
    });
    const rows = res.data.values || [];

    const updates = [];
    const logs = { enriched: 0, skipped: 0, noMatch: [], lowScore: [], belowGate: [] };

    for (let i = 0; i < rows.length; i++) {
        const sheetRow = i + 2;
        if (ONLY_ROW) {
            if (sheetRow !== ONLY_ROW) continue;
        } else if (sheetRow < FROM || sheetRow > TO) {
            continue;
        }

        const row = rows[i];
        const name = (row[COL.A] || '').trim();
        const number = (row[COL.I] || '').trim();
        const setName = (row[COL.J] || '').trim();
        const haveImage = (row[COL.P] || '').trim();
        if (!name) continue;
        if (haveImage && !FORCE) {
            logs.skipped++;
            continue;
        }

        let cands;
        try {
            cands = await tcgSearch(baseName(name));
        } catch (e) {
            logs.noMatch.push({ row: sheetRow, name, reason: e.message });
            await sleep(THROTTLE_MS);
            continue;
        }

        const match = pickBest(cands, { name: baseName(name), number, setName });
        await sleep(THROTTLE_MS);

        if (!match) {
            logs.noMatch.push({ row: sheetRow, name, number, setName });
            continue;
        }

        if (match._score < MIN_SCORE) {
            logs.belowGate.push({ row: sheetRow, name, number, setName, productName: match.productName, tcgSet: match.setName, score: match._score });
            console.log(`  Row ${sheetRow}: ${name} #${number} → SKIPPED (score ${match._score} < ${MIN_SCORE}) best guess "${match.productName}" [${match.setName}]`);
            continue;
        }

        const pid = Math.trunc(match.productId);
        const ca = match.customAttributes || {};
        const tcgSet = match.setName || '';
        const setCode = setCodeFromTcgSetName(tcgSet);
        const rarity = normalizeRarity(ca.rarity);
        const release = await setReleaseDate(setCode);
        await sleep(120);

        const writes = {};
        if ((FORCE || !(row[COL.P] || '').trim())) writes.P = TCG_IMAGE(pid);
        if (!(row[COL.K] || '').trim() && setCode) writes.K = setCode;
        if ((FORCE || !(row[COL.M] || '').trim()) && rarity) writes.M = rarity;
        if (!(row[COL.O] || '').trim()) writes.O = 'Japanese';
        if ((FORCE || !(row[COL.Q] || '').trim()) && release) writes.Q = release;
        if (!(row[COL.S] || '').trim()) writes.S = `tcgp-${pid}`;

        for (const [c, v] of Object.entries(writes)) {
            updates.push({ range: `${SHEET_NAME}!${c}${sheetRow}`, values: [[v]] });
        }

        logs.enriched++;
        const flag = match._score < 100 ? '  ⚠ low-score' : '';
        if (match._score < 100) logs.lowScore.push({ row: sheetRow, name, number, tcgSet, productName: match.productName, score: match._score });
        console.log(
            `  Row ${sheetRow}: ${name} #${number} → pid ${pid} | "${cleanProductName(match.productName)}" | ${tcgSet} | rarity=${rarity || '—'} | ${release || 'no-date'} | score ${match._score}${flag}`,
        );
    }

    console.log(`\n=== Summary ===`);
    console.log(`  enriched:  ${logs.enriched}`);
    console.log(`  skipped (already had image): ${logs.skipped}`);
    console.log(`  no-match:  ${logs.noMatch.length}`);
    console.log(`  below-gate (score < ${MIN_SCORE}, not written): ${logs.belowGate.length}`);
    console.log(`  low-score (<100, review): ${logs.lowScore.length}`);
    console.log(`  cell writes: ${updates.length}`);

    if (logs.noMatch.length) {
        console.log('\n=== No match (manual review) ===');
        logs.noMatch.forEach((r) => console.log(`  Row ${r.row}: ${r.name} #${r.number || ''} (set "${r.setName || ''}") ${r.reason || ''}`));
    }
    if (logs.lowScore.length) {
        console.log('\n=== Low-score matches (verify) ===');
        logs.lowScore.forEach((r) => console.log(`  Row ${r.row}: ${r.name} #${r.number} → "${r.productName}" [${r.tcgSet}] score ${r.score}`));
    }

    if (DRY_RUN) {
        console.log('\n[dry-run] No writes.');
        return;
    }
    if (!updates.length) {
        console.log('\nNothing to write.');
        return;
    }
    console.log(`\nWriting ${updates.length} cells...`);
    const CHUNK = 500;
    for (let i = 0; i < updates.length; i += CHUNK) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: { valueInputOption: 'RAW', data: updates.slice(i, i + CHUNK) },
        });
    }
    console.log('✓ Done.');
}

main().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
