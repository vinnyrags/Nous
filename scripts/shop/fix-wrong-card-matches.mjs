/**
 * Fix the 5 cards from the 2026-05-04 batch where enrich-singles
 * picked the wrong API match. Queries the Pokemon TCG API with
 * precise filters per card, then writes corrected values directly
 * to the Singles sheet (cols I, J, L, O, P, Q, R) so the next
 * push-cards + pull-cards-production pipeline propagates the fix
 * to Stripe and WP.
 *
 * Targets:
 *   1. Row 341 — Pikachu SVP en 027  → svp (Scarlet & Violet Promos)
 *   2. Row 350 — Starmie BREAK 32/108 → unique by name (one-of-a-kind)
 *   3. Row 351 — Machamp BREAK 60/108 → same
 *   4. Row 378 — Galarian Moltres SWSH125 → swshp (SWSH Promos)
 *   5. Row 396 — Eevee 48/68          → sm115 (Hidden Fates)
 *
 * Default --dry-run; pass --apply to write.
 */

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';
const APPLY = process.argv.includes('--apply');

// Manually-curated, narrow Pokemon TCG API queries.
// Each entry's `query` is the `q` param value; the lookup picks the
// first card returned — narrow enough that any result is THE result.
// Starmie BREAK and Machamp BREAK were initially flagged as wrong — but
// the Pokemon TCG API confirms both ARE genuinely from Evolutions
// (xy12-32 and xy12-60, rarity "Rare BREAK"). My "Evolutions has no
// BREAK cards" assumption was factually wrong; Evolutions includes
// BREAK reprints. Removed from the fix list.
const FIXES = [
  {
    row: 341,
    label: 'Pikachu SVP en 027',
    query: 'name:Pikachu number:27 set.id:svp', // API uses unpadded number
  },
  {
    row: 378,
    label: 'Galarian Moltres SWSH125',
    query: 'name:"Galarian Moltres" number:SWSH125',
    nameOverride: 'Galarian Moltres',
  },
  {
    row: 396,
    label: 'Eevee 48/68 (Hidden Fates)',
    query: 'name:Eevee number:48 set.id:sm115',
  },
];

async function searchTcgApi(query) {
  const url = `https://api.pokemontcg.io/v2/cards?q=${encodeURIComponent(query)}&pageSize=5`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${res.status}: ${url}`);
  const data = await res.json();
  return data.data || [];
}

function rarityFromCard(card) {
  // Match the existing enrich-singles convention: lower-kebab.
  if (!card.rarity) return '';
  return card.rarity.toLowerCase().replace(/\s+/g, '-');
}

function summarizeCard(c) {
  return `${c.id} ${c.set?.name || '?'} | num=${c.number} | rarity=${c.rarity || '?'} | date=${c.set?.releaseDate || '?'} | artist=${c.artist || '?'}`;
}

async function main() {
  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: APPLY
      ? ['https://www.googleapis.com/auth/spreadsheets']
      : ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const writeData = [];
  for (const fix of FIXES) {
    console.log(`\n--- Row ${fix.row}: ${fix.label} ---`);
    console.log(`  query: q=${fix.query}`);
    let cards;
    try {
      cards = await searchTcgApi(fix.query);
    } catch (e) {
      console.log(`  ✗ API error: ${e.message}`);
      continue;
    }
    if (cards.length === 0) {
      console.log(`  ✗ no candidates from API`);
      continue;
    }
    console.log(`  ${cards.length} candidate(s):`);
    for (const c of cards.slice(0, 3)) console.log(`    - ${summarizeCard(c)}`);
    const best = cards[0];
    console.log(`  → using: ${best.id} (${best.set?.name})`);

    // Build cell writes. Columns:
    //   I (8)  set name
    //   J (9)  set code (use set.ptcgoCode if available, else set.id)
    //   L (11) rarity
    //   O (14) image URL (large preferred)
    //   P (15) release date
    //   Q (16) artist
    //   R (17) Pokemon TCG API ID
    const setCode = best.set?.ptcgoCode || best.set?.id || '';
    const imageUrl = best.images?.large || best.images?.small || '';
    const writes = [
      { col: 'I', value: best.set?.name || '' },
      { col: 'J', value: setCode },
      { col: 'L', value: rarityFromCard(best) },
      { col: 'O', value: imageUrl },
      { col: 'P', value: best.set?.releaseDate || '' },
      { col: 'Q', value: best.artist || '' },
      { col: 'R', value: best.id || '' },
    ];

    if (fix.nameOverride) {
      writes.push({ col: 'A', value: fix.nameOverride });
    }

    for (const w of writes) {
      writeData.push({
        range: `${SHEET_NAME}!${w.col}${fix.row}`,
        values: [[w.value]],
      });
    }
  }

  console.log(`\n=== ${writeData.length} cell write(s) prepared ===`);
  if (!APPLY) {
    console.log(`📋 DRY-RUN — pass --apply to commit.`);
    return;
  }

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      valueInputOption: 'RAW',
      data: writeData,
    },
  });
  console.log(`✓ Wrote ${writeData.length} cells.`);
  console.log(`Next: make push-cards  →  make pull-cards-production  →  flush Next.js image cache.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
