/**
 * Build a Whatnot bulk-import CSV containing the 149 vintage cards whose
 * WP attachments were swapped to Pokellector scans. The user manually
 * removes the vintage rows from Whatnot before importing this file.
 *
 * Source schema: tmp/whatnot-cards-import-2026-05-15.csv (501 rows).
 * For each WP card in results-enriched.json:
 *   1. Find the matching row in the existing CSV by normalized title
 *      (name, number, set; excluding "(First Edition)" variants).
 *   2. Replace the "Image URL 1" column with the new WP source_url.
 *   3. Emit the row to the new CSV.
 *
 * Output: tmp/whatnot-vintage-reimport-2026-05-19.csv
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.HOME, 'Projects/vinnyrags/websites');
const SOURCE_CSV = path.join(ROOT, 'tmp/whatnot-cards-import-2026-05-15.csv');
const RESULTS_PATH = path.join(ROOT, 'tmp/vintage-fix/results-enriched.json');
const OUT_CSV = path.join(ROOT, 'tmp/whatnot-vintage-reimport-2026-05-19.csv');

// Tiny CSV parser — handles RFC 4180 quoted fields, commas in fields,
// and escaped quotes ("").
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"' && text[i + 1] === '"') {
                field += '"';
                i++;
            } else if (c === '"') {
                inQuotes = false;
            } else {
                field += c;
            }
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else if (c === '\r') { /* skip */ }
            else field += c;
        }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function csvEscape(s) {
    if (s == null) return '';
    const str = String(s);
    if (/[",\n]/.test(str)) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function writeCsv(rows) {
    return rows.map(r => r.map(csvEscape).join(',')).join('\n');
}

function normalize(s) {
    return String(s || '')
        .replace(/&#8217;|&#x2019;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/[‘’]/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

// Parse a CSV title like "Charmeleon #24/102 — Base Set" into
// { name, number, total, set } for matching.
function parseCsvTitle(title) {
    const m = title.match(/^(.+?)\s+#?(\d+[A-Z]?)(?:\/(\d+))?\s*[—-]\s*(.+)$/);
    if (!m) return null;
    return {
        name: m[1].trim(),
        number: m[2],
        total: m[3] || null,
        set: m[4].trim(),
        isFirstEdition: /\(First Edition\)/i.test(m[1]),
    };
}

const VINTAGE_SETS = new Set([
    'Base Set', 'Base Set 2', 'Jungle', 'Fossil',
    'Team Rocket', 'Gym Heroes', 'Gym Challenge',
]);

async function main() {
    const sourceText = fs.readFileSync(SOURCE_CSV, 'utf8');
    const rows = parseCsv(sourceText);
    const header = rows[0];
    const dataRows = rows.slice(1);

    const titleIdx = header.indexOf('Title');
    const image1Idx = header.indexOf('Image URL 1');
    if (titleIdx === -1 || image1Idx === -1) {
        throw new Error(`Expected columns "Title" and "Image URL 1" not found`);
    }
    console.log(`CSV columns: ${header.length}, data rows: ${dataRows.length}`);
    console.log(`Title col: ${titleIdx}, Image URL 1 col: ${image1Idx}`);

    const results = JSON.parse(fs.readFileSync(RESULTS_PATH, 'utf8'));
    console.log(`WP cards to re-image: ${results.length}`);

    // Index CSV rows by (normalized name, number, set), excluding
    // "(First Edition)" variants which the WP fix never touched.
    const byKey = new Map();
    const bySetNumber = new Map();
    for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const title = row[titleIdx] || '';
        const parsed = parseCsvTitle(title);
        if (!parsed) continue;
        if (!VINTAGE_SETS.has(parsed.set)) continue;
        if (parsed.isFirstEdition) continue;
        const key = `${normalize(parsed.set)}|${parsed.number}|${normalize(parsed.name)}`;
        byKey.set(key, { rowIdx: i, row, parsed, title });
        const sn = `${normalize(parsed.set)}|${parsed.number}`;
        if (!bySetNumber.has(sn)) bySetNumber.set(sn, []);
        bySetNumber.get(sn).push({ rowIdx: i, row, parsed, title });
    }
    console.log(`Vintage rows (non-1stEd) in source CSV: ${byKey.size}`);

    const matched = [];
    const fallbackMatched = [];
    const unmatched = [];

    for (const card of results) {
        // Reuse the parsed (name, number, set) from cards.json. The WP
        // title isn't always em-dash form so we re-derive the name.
        const setName = card.set;
        const number = card.number;
        // Extract name from WP title — strip set, number, em-dashes.
        let wpName = card.title
            .replace(/&#8217;|&#x2019;/g, "'")
            .replace(/&amp;/g, '&')
            .replace(/[‘’]/g, "'")
            .trim();
        // em-dash form first
        let m = wpName.match(/^(.+?)\s+#?\d+(?:\/\d+)?\s*[—-]\s*(.+)$/);
        if (m && m[2].trim() === setName) {
            wpName = m[1].trim();
        } else {
            // natural form
            const escapedSet = setName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const re = new RegExp(`^(.+?)\\s+${escapedSet}\\s+\\d+(?:/\\d+)?$`);
            m = wpName.match(re);
            if (m) wpName = m[1].trim();
        }

        const primaryKey = `${normalize(setName)}|${number}|${normalize(wpName)}`;
        const direct = byKey.get(primaryKey);
        if (direct) {
            matched.push({ card, wpName, hit: direct });
            continue;
        }
        const sn = `${normalize(setName)}|${number}`;
        const fb = bySetNumber.get(sn);
        if (fb && fb.length === 1) {
            fallbackMatched.push({ card, wpName, hit: fb[0], csvName: fb[0].parsed.name });
            continue;
        }
        unmatched.push({ card, wpName });
    }

    console.log();
    console.log(`exact-name matches: ${matched.length}`);
    console.log(`fallback matches:   ${fallbackMatched.length}  (CSV name differs from WP name)`);
    console.log(`unmatched:          ${unmatched.length}  (no CSV row — will need manual creation)`);

    if (fallbackMatched.length) {
        console.log('\nFallback matches (verify these):');
        for (const m of fallbackMatched) {
            console.log(`  - WP "${m.wpName}" -> CSV "${m.csvName}"  (${m.card.set} ${m.card.number}/${m.card.total})`);
        }
    }
    if (unmatched.length) {
        console.log('\nUnmatched (excluded from new CSV — manual creation needed):');
        for (const u of unmatched) {
            console.log(`  - WP #${u.card.id}: "${u.wpName}"  ${u.card.set} ${u.card.number}/${u.card.total}`);
        }
    }

    // Build the new CSV. Header + each matched row with Image URL 1
    // swapped. Dedupe by (set, number, name) — WP has a handful of
    // duplicate-title cards (e.g. both "Lapras Fossil 10/62" and
    // "Lapras #10/62 — Fossil" exist as separate posts). Keeping one
    // CSV row per unique card avoids Whatnot SKU collisions.
    const outRows = [header.slice()];
    const seenKeys = new Set();
    const duplicates = [];
    for (const { card, hit } of [...matched, ...fallbackMatched]) {
        // Dedupe by the matched CSV row index. Two WP cards that mapped
        // to the same CSV row are duplicate WP entries (e.g. both
        // "Lapras Fossil 10/62" and "Lapras #10/62 — Fossil" exist).
        // Different variants — like Staryu vs Staryu (Shadowless) at
        // the same set+number — match different CSV rows so they're
        // kept separately.
        const dedupeKey = `csvrow:${hit.rowIdx}`;
        if (seenKeys.has(dedupeKey)) {
            duplicates.push({ wpId: card.id, title: card.title });
            continue;
        }
        seenKeys.add(dedupeKey);
        const newRow = hit.row.slice();
        newRow[image1Idx] = card.new_source_url;
        outRows.push(newRow);
    }
    fs.writeFileSync(OUT_CSV, writeCsv(outRows) + '\n');
    console.log(`\nWrote ${outRows.length - 1} rows to ${OUT_CSV}`);
    if (duplicates.length) {
        console.log(`\nDeduped ${duplicates.length} WP duplicates (kept first occurrence):`);
        for (const d of duplicates) console.log(`  - WP #${d.wpId}: "${d.title}"`);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
