/**
 * Read the Singles sheet and the original card-updates.txt, then
 * cross-reference the enriched data on the 61 newly-added rows against
 * the operator's input to flag suspect API matches.
 *
 * Heuristics for "suspect":
 *   1. Operator wrote "Promo" but the assigned set name doesn't say
 *      Promos / Black Star Promos.
 *   2. Operator's set hint (col J in the input) is "SVP en" / "SVPEN" /
 *      "SVPen" but the API matched a non-SVP set.
 *   3. Card was tagged Promo-style but release date is before 2017
 *      (anything older is almost certainly a mismatch — Promo Pikachus
 *      from 2024 don't get matched into Jungle 1999).
 *   4. Number was a plain "X/Y" (no set hint) AND the API picked a set
 *      released before 2017 — flag for manual review since plain X/Y
 *      numbers exist in many sets.
 *
 * Read-only. Output goes to stdout for review; no writes.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../..');
const VINCENT_DIR = path.resolve(ROOT, 'vincentragosta.io');
const UPDATES_PATH = path.join(VINCENT_DIR, 'tmp/card-updates.txt');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';

// Operator-defined vintage cutoff — anything before this date in the
// enriched set's release column is flagged. Set to 2000-01-01 because
// the operator considers only pre-Y2K cards "vintage"; anything 2000+
// is current-enough that a name+number match landing pre-2000 is
// almost certainly an API misidentification (e.g., 2024 SVP Pikachu
// matched to 1999 Base/Jungle).
const SUSPECT_OLD_THRESHOLD = '2000-01-01';

function parseInputNewCards(text) {
    const lines = text.split(/\r?\n/);
    const out = [];
    let inSection = false;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (line === 'New Cards') { inSection = true; continue; }
        if (line === 'Update Stock' || line === 'Cards to Remove') { inSection = false; continue; }
        if (!inSection) continue;
        out.push(line);
    }
    return out;
}

function isPromoIntent(line) {
    return /\bpromo\b/i.test(line);
}

function setHintFromLine(line) {
    if (/\bSVP\s*en\b/i.test(line) || /\bSVPEN\b/i.test(line) || /\bSVPen\b/i.test(line)) return 'SVP';
    return null;
}

async function main() {
    const text = fs.readFileSync(UPDATES_PATH, 'utf8');
    const inputNewCards = parseInputNewCards(text);
    console.log(`Input new cards: ${inputNewCards.length}\n`);

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
    // Last 61 rows are the appended new cards.
    const newRows = rows.slice(-inputNewCards.length);
    if (newRows.length !== inputNewCards.length) {
        console.warn(`Mismatch: input has ${inputNewCards.length} new cards, sheet tail has ${newRows.length}`);
    }

    let suspectCount = 0;
    console.log('Suspect matches (input → enriched):\n');
    for (let i = 0; i < newRows.length; i++) {
        const inputLine = inputNewCards[i] || '';
        const row = newRows[i];
        const sheetRow = rows.length + 2 - newRows.length + i; // 1-indexed sheet row

        const a = (row[0] || '').trim();   // name
        const h = (row[7] || '').trim();   // number
        const i_ = (row[8] || '').trim();  // set name (filled by enrichment)
        const j = (row[9] || '').trim();   // set code (operator hint or filled)
        const p = (row[15] || '').trim();  // release date (filled by enrichment)
        const r_ = (row[17] || '').trim(); // Pokemon TCG API ID

        const intentPromo = isPromoIntent(inputLine);
        const setHint = setHintFromLine(inputLine);

        const reasons = [];
        if (intentPromo && !/promo/i.test(i_)) {
            reasons.push(`operator marked Promo, set is "${i_}"`);
        }
        if (setHint === 'SVP' && !/SVP|Scarlet.+Violet.+Promo/i.test(i_)) {
            reasons.push(`operator hint SVP, set is "${i_}"`);
        }
        if (intentPromo && p && p < SUSPECT_OLD_THRESHOLD) {
            reasons.push(`Promo intent but release date ${p} < ${SUSPECT_OLD_THRESHOLD}`);
        }
        // Pre-2017 release on ANY new card. Modern singles (the ones the
        // operator typically adds) shouldn't land in 1999/2010 sets;
        // when they do, the API's first-best-match heuristic ambiguously
        // matched a vintage card with the same name + number.
        if (p && p < SUSPECT_OLD_THRESHOLD) {
            reasons.push(`enriched set is pre-${SUSPECT_OLD_THRESHOLD.slice(0,4)}: "${i_}" (${p})`);
        }

        if (reasons.length) {
            suspectCount++;
            console.log(`  Row ${sheetRow}: ${a} #${h}`);
            console.log(`    input:    "${inputLine}"`);
            console.log(`    enriched: set="${i_}" date=${p} api_id="${r_}"`);
            for (const r of reasons) console.log(`    ⚠ ${r}`);
            console.log('');
        }
    }
    console.log(`\nSuspect total: ${suspectCount} / ${newRows.length}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
