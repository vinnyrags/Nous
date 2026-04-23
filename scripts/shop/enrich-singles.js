/**
 * Enrich the Singles tab via the Pokemon TCG API.
 *
 * For each row that's missing Set Name / Set Code / Card Number / Rarity /
 * Image URL / Artist / Release Year, query api.pokemontcg.io, pick the
 * best match, and write the values back. Idempotent — skips rows that
 * already have every enrichable field populated.
 *
 * Only Pokemon is supported today. Non-Pokemon cards (Yu-Gi-Oh, Magic,
 * One Piece) are logged and left untouched. See the plan for next steps.
 *
 * Usage: node scripts/shop/enrich-singles.js [--dry-run]
 *
 * Columns expected: A Name | B Price | C Category | D Stock | E Cost |
 *                   F Sale Price | G Image URL | H Language | I Game |
 *                   J Set Name | K Set Code | L Set Number | M Rarity |
 *                   N Variant | O Release Year | P Artist | Q Stripe ID |
 *                   R Notes
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';
const API_BASE = 'https://api.pokemontcg.io/v2';
const THROTTLE_MS = 200;
const API_KEY = process.env.POKEMON_TCG_API_KEY || '';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchCards(name) {
    const url = `${API_BASE}/cards?q=name:"${encodeURIComponent(name)}"`;
    const headers = API_KEY ? { 'X-Api-Key': API_KEY } : {};
    const res = await fetch(url, { headers });
    if (!res.ok) {
        throw new Error(`Pokemon TCG API ${res.status}: ${await res.text()}`);
    }
    const data = await res.json();
    return data.data || [];
}

function pickBestMatch(candidates, name) {
    if (!candidates.length) return null;

    const exact = candidates.filter(
        (c) => c.name.toLowerCase() === name.toLowerCase(),
    );
    const pool = exact.length ? exact : candidates;

    return pool.slice().sort((a, b) => {
        const da = a.set?.releaseDate || '';
        const db = b.set?.releaseDate || '';
        return db.localeCompare(da); // most recent first
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
        range: `${SHEET_NAME}!A2:R`,
    });

    const rows = res.data.values || [];
    if (!rows.length) {
        console.log('No rows found in the Singles tab.');
        return;
    }

    console.log(`Scanning ${rows.length} row(s) for enrichment...${DRY_RUN ? ' [dry-run]' : ''}\n`);

    const updates = []; // { range, values }
    const logs = { enriched: 0, skipped: 0, missing: [], nonPokemon: [] };

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sheetRowNumber = i + 2;

        const [
            name, _price, _category, _stock, _cost, _sale,
            imageUrl, _language, game, setName, setCode, cardNumber,
            rarity, _variant, releaseYear, artist,
        ] = row;

        if (!name) continue;

        // Already complete — skip
        const alreadyComplete =
            imageUrl && setName && setCode && cardNumber && rarity && releaseYear && artist;
        if (alreadyComplete) {
            logs.skipped++;
            continue;
        }

        const isPokemon = !game || game.trim().toLowerCase() === 'pokemon';
        if (!isPokemon) {
            logs.nonPokemon.push(`${name} (${game})`);
            continue;
        }

        let candidates = [];
        try {
            candidates = await fetchCards(name.trim());
        } catch (e) {
            console.log(`  Row ${sheetRowNumber}: API error for "${name}" — ${e.message}`);
            await sleep(THROTTLE_MS);
            continue;
        }

        const match = pickBestMatch(candidates, name.trim());
        await sleep(THROTTLE_MS);

        if (!match) {
            logs.missing.push(name);
            console.log(`  Row ${sheetRowNumber}: no match for "${name}"`);
            continue;
        }

        // Assemble values per-column to only fill blanks (preserve manual edits)
        const cells = {
            G: imageUrl || match.images?.large || match.images?.small || '',
            I: game || 'pokemon',
            J: setName || match.set?.name || '',
            K: setCode || match.set?.id || '',
            L: cardNumber || (match.number ? `${match.number}/${match.set?.printedTotal || match.set?.total || ''}`.replace(/\/$/, '') : ''),
            M: rarity || (match.rarity || '').toLowerCase().replace(/\s+/g, '-'),
            O: releaseYear || (match.set?.releaseDate ? match.set.releaseDate.slice(0, 4) : ''),
            P: artist || match.artist || '',
        };

        // Only push updates for cells that are blank (preserve manual edits)
        for (const [col, value] of Object.entries(cells)) {
            if (!value) continue;
            const existing = row[columnIndex(col)];
            if (existing && String(existing).trim() !== '') continue;
            updates.push({
                range: `${SHEET_NAME}!${col}${sheetRowNumber}`,
                values: [[value]],
            });
        }

        logs.enriched++;
        const info = [cells.J, cells.L, cells.M, cells.O].filter(Boolean).join(' | ');
        console.log(`  Row ${sheetRowNumber}: ${name} → ${info}`);
    }

    console.log(`\nSummary: ${logs.enriched} enriched, ${logs.skipped} already complete, ${logs.missing.length} no-match, ${logs.nonPokemon.length} non-Pokemon (skipped).`);

    if (logs.missing.length) {
        console.log('\nNo match (manual review required):');
        logs.missing.forEach((n) => console.log(`  - ${n}`));
    }
    if (logs.nonPokemon.length) {
        console.log('\nNon-Pokemon cards (enrichment not supported yet):');
        logs.nonPokemon.forEach((n) => console.log(`  - ${n}`));
    }

    if (DRY_RUN) {
        console.log(`\n[dry-run] Would write ${updates.length} cell(s).`);
        return;
    }

    if (updates.length) {
        console.log(`\nWriting ${updates.length} cell update(s)...`);
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                valueInputOption: 'RAW',
                data: updates,
            },
        });
        console.log('✓ Enrichment written.');
    } else {
        console.log('\nNothing to write — all rows already complete or unmatchable.');
    }
}

function columnIndex(letter) {
    return letter.toUpperCase().charCodeAt(0) - 'A'.charCodeAt(0);
}

main().catch((err) => {
    console.error('Enrichment failed:', err.message);
    process.exit(1);
});
