/**
 * Audit alternate-art rows in the Singles sheet for incorrect Pokemon TCG
 * API IDs (column R).
 *
 * When variant column K contains "Alternate" / "Alt Art", column R should
 * point to the alternate-art entry — typically the second (or higher-
 * numbered) duplicate of the same name within the matching rarity tier.
 *
 * If column R instead points at the regular Full Art (or the regular
 * VMAX/V), push-cards.js will hand Stripe the wrong image URL, and
 * pull-cards.php will sideload the wrong artwork to WP. The user observed
 * this with Tyranitar V (Alternate Full Art) → swsh5-154 (regular Full Art)
 * and Rapid Strike Urshifu VMAX (Alternate Art Secret) → swsh5-88 (regular
 * VMAX); both should point at the alternate-art entry instead.
 *
 * Detection rules:
 *   - Trigger when row K matches /alternate|alt\s*art|alt\s*full/i
 *   - Pick rarity tier from the K label:
 *       contains "secret"  → match Rare Secret / Rare Rainbow / etc.
 *       contains "rainbow" → match Rare Rainbow
 *       contains "gold"    → match Rare Rainbow (gold prints share the tier)
 *       else (default for "Alternate Full Art") → match Rare Ultra
 *   - Among API entries in the same set with the same exact name AND
 *     a rarity in the chosen tier, pick the alt:
 *       2 entries → take entries[1] (the higher-numbered)
 *       3+ entries → also take entries[1] (the first alt; pull-cards
 *         users with multi-alt sets like Origin/Lost should run again)
 *       1 entry  → can't determine; report and skip
 *
 * Usage:
 *   node scripts/shop/audit-alt-art-ids.js                    # dry-run, full report
 *   node scripts/shop/audit-alt-art-ids.js --apply            # write corrections
 *   node scripts/shop/audit-alt-art-ids.js --row=42           # audit one row only
 *   node scripts/shop/audit-alt-art-ids.js --quiet            # suppress per-row OK lines
 *
 * Column layout (post-migration A-T): see scripts/shop/push-cards.js header.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const QUIET = args.includes('--quiet');
const ROW_ARG = args.find((a) => a.startsWith('--row='));
const ONLY_ROW = ROW_ARG ? parseInt(ROW_ARG.split('=')[1], 10) : null;

const COL = {
    A: 0, B: 1, C: 2, D: 3, E: 4,
    F: 5, G: 6, H: 7, I: 8, J: 9,
    K: 10, L: 11, M: 12, N: 13, O: 14,
    P: 15, Q: 16, R: 17, S: 18, T: 19,
};

// Standard Full Art rarity tier for Pokemon V / VMAX / GX.
const ULTRA_RARITIES = new Set(['Rare Ultra']);

// Above-set-total "secret rare" tier (rainbow, hyper, illustration). Does
// NOT include regular Rare Holo VMAX / Rare Holo V — those are the
// non-secret prints. Including them would let the regular #88-style entries
// pollute the alt-art candidate pool.
const SECRET_RARITIES = new Set([
    'Rare Secret',
    'Rare Rainbow',
    'Rare Shiny',
    'Rare Shiny GX',
    'Rare Rainbow GX',
    'Hyper Rare',
    'Special Illustration Rare',
    'Illustration Rare',
]);

function classifyVariant(variantLabel) {
    const v = variantLabel.toLowerCase();
    if (!/(alternate|alt\s*art|alt\s*full)/.test(v)) return null;
    if (/(secret|rainbow|gold|hyper|illustration)/.test(v)) return 'secret';
    return 'ultra';
}

/**
 * Normalize a card name for cross-source comparison.
 *
 * The Pokemon TCG API stores tags hyphenated ("Gardevoir & Sylveon-GX",
 * "Pikachu-EX") while the user's sheet typically writes them with a space
 * ("Gardevoir & Sylveon GX"). Lowercase + replace runs of dashes/whitespace
 * with a single space. Don't strip dashes inside names like "Wo-Chien"
 * — only the dash directly before a known tag suffix.
 */
function normalizeName(name) {
    return name
        .toLowerCase()
        .replace(/-(gx|ex|v|vmax|vstar|vunion)\b/g, ' $1')
        .replace(/\s+/g, ' ')
        .trim();
}

function isOffenderEligible(rarity, tier) {
    if (tier === 'ultra') return ULTRA_RARITIES.has(rarity);
    if (tier === 'secret') return SECRET_RARITIES.has(rarity);
    return false;
}

function setIdFromApiId(apiId) {
    if (!apiId || !apiId.includes('-')) return null;
    return apiId.slice(0, apiId.lastIndexOf('-'));
}

async function fetchSetCards(setId) {
    const url = `https://api.pokemontcg.io/v2/cards?q=set.id:${encodeURIComponent(setId)}&pageSize=250&orderBy=number`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API ${res.status} for ${setId}: ${await res.text()}`);
    const json = await res.json();
    return json.data || [];
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

    // Identify candidate rows.
    const candidates = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sheetRow = i + 2;
        if (ONLY_ROW && sheetRow !== ONLY_ROW) continue;

        const name = (row[COL.A] || '').trim();
        const variant = (row[COL.K] || '').trim();
        const apiId = (row[COL.R] || '').trim();
        if (!name || !variant || !apiId) continue;

        const tier = classifyVariant(variant);
        if (!tier) continue;

        const setId = setIdFromApiId(apiId);
        if (!setId) continue;

        candidates.push({ sheetRow, name, variant, apiId, setId, tier });
    }

    console.log(`Scanning ${rows.length} rows; ${candidates.length} alt-flavored candidate(s)${APPLY ? '' : ' [dry-run]'}.\n`);

    if (!candidates.length) return;

    // Group by setId so we hit the API once per set.
    const setIds = [...new Set(candidates.map((c) => c.setId))];
    const setCache = {};
    for (const setId of setIds) {
        try {
            setCache[setId] = await fetchSetCards(setId);
        } catch (err) {
            console.error(`  ! failed to fetch set ${setId}: ${err.message}`);
            setCache[setId] = [];
        }
    }

    const updates = []; // { sheetRow, apiId }
    let okCount = 0;
    let unresolvedCount = 0;

    for (const c of candidates) {
        const setCards = setCache[c.setId] || [];
        const targetName = normalizeName(c.name);
        const matches = setCards
            .filter((card) => normalizeName(card.name) === targetName)
            .filter((card) => isOffenderEligible(card.rarity || '', c.tier))
            .sort((a, b) => parseInt(a.number, 10) - parseInt(b.number, 10));

        if (matches.length === 0) {
            console.log(`  row ${c.sheetRow}: ${c.name} — ${c.variant}`);
            console.log(`    ! no API match for tier=${c.tier} in ${c.setId}; current=${c.apiId}; skipping`);
            unresolvedCount++;
            continue;
        }
        if (matches.length === 1) {
            // Single candidate. Could still be wrong if current points elsewhere,
            // but with only one option there's no "alt" to pick.
            const only = matches[0];
            if (only.id !== c.apiId) {
                console.log(`  row ${c.sheetRow}: ${c.name} — ${c.variant}`);
                console.log(`    ? only one ${c.tier}-tier match (${only.id}); current=${c.apiId}`);
                console.log(`      → would set R=${only.id} (verify manually)`);
                updates.push({ sheetRow: c.sheetRow, apiId: only.id, name: c.name, variant: c.variant, from: c.apiId });
            } else if (!QUIET) {
                console.log(`  row ${c.sheetRow}: ${c.name} — ${c.variant}: OK (only ${c.tier} entry, already ${c.apiId})`);
            }
            continue;
        }

        // 2+ matches → expected alt is the second (first higher-numbered duplicate).
        const expected = matches[1];
        if (expected.id === c.apiId) {
            okCount++;
            if (!QUIET) {
                console.log(`  row ${c.sheetRow}: ${c.name} — ${c.variant}: OK (${c.apiId})`);
            }
            continue;
        }

        console.log(`  row ${c.sheetRow}: ${c.name} — ${c.variant}`);
        console.log(`    current R = ${c.apiId}`);
        console.log(`    expected  = ${expected.id}  (${expected.rarity}, ${expected.images.large})`);
        console.log(`    candidates in tier (${c.tier}):`);
        matches.forEach((m, idx) => {
            const marker = m.id === expected.id ? ' ← expected' : (m.id === c.apiId ? ' ← current' : '');
            console.log(`      [${idx}] ${m.id} #${m.number} ${m.rarity}${marker}`);
        });
        updates.push({ sheetRow: c.sheetRow, apiId: expected.id, name: c.name, variant: c.variant, from: c.apiId });
    }

    console.log(`\nSummary: ${okCount} OK, ${updates.length} need update, ${unresolvedCount} unresolved.`);

    if (!updates.length) return;
    if (!APPLY) {
        console.log(`\nDry-run only. Re-run with --apply to write column R for ${updates.length} row(s).`);
        return;
    }

    console.log(`\nWriting ${updates.length} update(s)...`);
    const data = updates.map((u) => ({
        range: `${SHEET_NAME}!R${u.sheetRow}`,
        values: [[u.apiId]],
    }));
    await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            valueInputOption: 'RAW',
            data,
        },
    });
    console.log(`✓ Wrote column R for ${updates.length} row(s).`);
    console.log('\nNext steps:');
    console.log('  1. node scripts/shop/enrich-singles.js --variants-only --dry-run    # refresh image URL + rarity for these rows');
    console.log('  2. node scripts/shop/enrich-singles.js --variants-only              # apply');
    console.log('  3. cd ../../../vincentragosta.io && make push-cards && make pull-cards-production');
}

main().catch((err) => {
    console.error('Audit failed:', err.stack || err.message);
    process.exit(1);
});
