/**
 * Update column O (Image URL) in the Singles sheet for the 149 vintage
 * cards whose WP attachments were just swapped to Pokellector scans.
 *
 * Input: tmp/vintage-fix/results-enriched.json (cardId, title, set,
 *        number, new_attachment_id, new_source_url).
 *
 * Match strategy: (Card Name, Card Number, Set Name) — case-insensitive,
 * apostrophe-normalized — restricted to rows where the Variant column
 * is empty (Unlimited). This protects the "Drowzee #54/82 — Team Rocket"
 * 1st Edition row, which lives at variant="First Edition".
 *
 * Modes:
 *   default     dry-run preview, prints what would change
 *   --apply     commit batchUpdate against the Singles sheet
 *
 * Doesn't touch any column other than O. Reports unmatched WP cards
 * for separate follow-up.
 */

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const RESULTS_PATH = path.join(
    process.env.HOME,
    'Projects/vinnyrags/websites/tmp/vintage-fix/results-enriched.json',
);
const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';
const APPLY = process.argv.includes('--apply');

const SET_ALIASES = {
    // The WP card #6036 has the wrong-name title "Giovanni's Mewtwo"
    // (the actual Gym Challenge #14 card is "Rocket's Mewtwo"). When
    // the primary name match misses, we'll look it up via the sheet's
    // variant.
};

function normalize(s) {
    if (!s) return '';
    return String(s)
        .replace(/&#8217;|&#x2019;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function parseTitle(card) {
    // The cards.json audit already extracted set + number. Strip those
    // out of the title to derive the Card Name.
    const setName = card.set;
    const number = card.number;
    let title = (card.title || '')
        .replace(/&#8217;|&#x2019;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/[‘’]/g, "'")
        .trim();

    // Em-dash form: "Charmeleon #24/102 — Base Set"
    let m = title.match(/^(.+?)\s+#?\d+(?:\/\d+)?\s*[—-]\s*(.+)$/);
    if (m && m[2].trim() === setName) return m[1].trim();

    // Vintage natural form: "Wigglytuff Base Set 2 19/130"
    if (title.endsWith(`/${card.total}`) || title.includes(setName)) {
        const escapedSet = setName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`^(.+?)\\s+${escapedSet}\\s+\\d+(?:/\\d+)?$`);
        m = title.match(re);
        if (m) return m[1].trim();
    }

    // Fallback: strip the trailing set + number however it appears.
    return title
        .replace(new RegExp(`\\s*${setName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`), '')
        .replace(/\s*#?\d+(?:\/\d+)?\s*[—-]?\s*$/, '')
        .replace(/\s*#?\d+(?:\/\d+)?\s*$/, '')
        .trim();
}

async function main() {
    const enriched = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
    console.log(APPLY ? '[APPLY MODE]' : '[DRY RUN]');
    console.log(`Cards to consider: ${enriched.length}`);

    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const scopes = APPLY
        ? ['https://www.googleapis.com/auth/spreadsheets']
        : ['https://www.googleapis.com/auth/spreadsheets.readonly'];
    const auth = new google.auth.GoogleAuth({ credentials, scopes });
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A2:T`,
    });
    const rows = res.data.values || [];

    // A-T schema (2026-05-29: TCGPlayer cols removed, Collectr added at C):
    //   row[0]=name  row[7]=number  row[8]=set  row[10]=variant  row[14]=image
    // Build an index: (set, number, name) -> {rowNumber, currentImage}
    // Skip rows with non-empty Variant column (1st Editions etc.).
    const byKey = new Map();
    rows.forEach((row, i) => {
        const rowNum = i + 2;
        const name = row[0];
        const number = row[7];
        const set = row[8];
        const variant = row[10];
        const image = row[14] || '';
        if (variant && variant.trim()) return; // skip 1st Editions
        const key = `${normalize(set)}|${number}|${normalize(name)}`;
        if (!byKey.has(key)) byKey.set(key, []);
        byKey.get(key).push({ rowNum, name, number, set, image });
    });

    // Also build a (set, number) index for fallback when names differ.
    const bySetNumber = new Map();
    rows.forEach((row, i) => {
        const rowNum = i + 2;
        const variant = row[10];
        const number = row[7];
        const set = row[8];
        if (variant && variant.trim()) return;
        const key = `${normalize(set)}|${number}`;
        if (!bySetNumber.has(key)) bySetNumber.set(key, []);
        bySetNumber.get(key).push({ rowNum, name: row[0], number, set, image: row[14] || '' });
    });

    const updates = [];
    const ambiguous = [];
    const unmatched = [];
    const nameMismatches = [];

    for (const card of enriched) {
        const wpName = parseTitle(card);
        const numberStr = card.total ? `${card.number}/${card.total}` : card.number;
        const setName = card.set;
        const primaryKey = `${normalize(setName)}|${numberStr}|${normalize(wpName)}`;
        let matchSet = byKey.get(primaryKey);

        // Fallback: (set, number) only — only safe if exactly one row.
        if (!matchSet || matchSet.length === 0) {
            const fallback = bySetNumber.get(`${normalize(setName)}|${numberStr}`);
            if (fallback && fallback.length === 1) {
                matchSet = fallback;
                nameMismatches.push({
                    wpId: card.id,
                    wpName,
                    sheetName: fallback[0].name,
                    setName,
                    numberStr,
                });
            }
        }

        if (!matchSet || matchSet.length === 0) {
            unmatched.push({ wpId: card.id, wpName, setName, numberStr });
            continue;
        }
        if (matchSet.length > 1) {
            ambiguous.push({
                wpId: card.id,
                wpName,
                setName,
                numberStr,
                rows: matchSet.map(m => `row ${m.rowNum} "${m.name}"`),
            });
            continue;
        }
        const target = matchSet[0];
        if (target.image === card.new_source_url) continue; // already correct
        updates.push({
            range: `${SHEET_NAME}!O${target.rowNum}`,
            values: [[card.new_source_url]],
            _meta: { row: target.rowNum, name: target.name, oldImage: target.image, newImage: card.new_source_url },
        });
    }

    console.log();
    console.log(`would update:     ${updates.length}`);
    console.log(`name mismatches:  ${nameMismatches.length}  (WP name != sheet name, matched by set+number)`);
    console.log(`unmatched:        ${unmatched.length}  (no sheet row for this card)`);
    console.log(`ambiguous:        ${ambiguous.length}  (multiple sheet candidates)`);

    if (nameMismatches.length) {
        console.log('\nName mismatches (verify these are correct):');
        for (const n of nameMismatches) {
            console.log(`  - WP #${n.wpId}: "${n.wpName}" -> sheet says "${n.sheetName}"  (${n.setName} ${n.numberStr})`);
        }
    }
    if (unmatched.length) {
        console.log('\nUnmatched (no sheet row to update):');
        for (const u of unmatched) {
            console.log(`  - WP #${u.wpId}: "${u.wpName}"  ${u.setName} ${u.numberStr}`);
        }
    }
    if (ambiguous.length) {
        console.log('\nAmbiguous (skipped to avoid wrong update):');
        for (const a of ambiguous) {
            console.log(`  - WP #${a.wpId}: "${a.wpName}"  ${a.setName} ${a.numberStr}`);
            for (const r of a.rows) console.log(`      ${r}`);
        }
    }

    if (!APPLY) {
        console.log('\nDry-run complete. Re-run with --apply to commit sheet writes.');
        return;
    }

    // batchUpdate — Google caps at ~1000 ranges per request; well under that.
    const chunked = [];
    for (let i = 0; i < updates.length; i += 100) chunked.push(updates.slice(i, i + 100));
    let written = 0;
    for (const chunk of chunked) {
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                valueInputOption: 'RAW',
                data: chunk.map(u => ({ range: u.range, values: u.values })),
            },
        });
        written += chunk.length;
        console.log(`  wrote chunk: ${written}/${updates.length}`);
    }
    console.log(`\nApplied ${written} updates to col O.`);
}

main().catch(e => { console.error(e); process.exit(1); });
