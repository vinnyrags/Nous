/**
 * One-shot processor for tmp/card-updates.txt → Singles sheet.
 *
 * Reads the freeform-text update file, parses three sections (Update
 * Stock / Cards to Remove / New Cards), and applies the changes to the
 * Singles tab. Defaults to --dry-run; pass --apply to execute.
 *
 * Match strategy:
 *   - Update Stock: name (col A) + card number (col H, optional) + set
 *     name (col I). Refuses to match if multiple rows hit (caller fixes
 *     ambiguity) or zero rows hit.
 *   - Cards to Remove: name + set name + price (col E) — the "$20
 *     variant" suffix in the input disambiguates by price.
 *   - New Cards: appends a new row with col A (name), E (price), F
 *     (stock — defaulting to 1 when not specified), H (card number,
 *     best-effort regex), J (set code, best-effort).
 *
 * Normalizations:
 *   - "SVPEN" → "SVP en" (operator-confirmed canonical form)
 *   - "SSV94" → "SV94" (typo)
 *
 * Usage:
 *   node scripts/shop/apply-card-updates.mjs              # dry-run
 *   node scripts/shop/apply-card-updates.mjs --apply      # write
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { google } from 'googleapis';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname is .../websites/Nous/scripts/shop; ROOT walks up to .../websites
const ROOT = path.resolve(__dirname, '../../..');
const VINCENT_DIR = path.resolve(ROOT, 'vincentragosta.io');
const UPDATES_PATH = path.join(VINCENT_DIR, 'tmp/card-updates.txt');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';

const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

// ---------------------------------------------------------------------------
// Parsing the freeform update file
// ---------------------------------------------------------------------------

function parseUpdates(text) {
  const lines = text.split(/\r?\n/);
  const sections = { 'Update Stock': [], 'Cards to Remove': [], 'New Cards': [] };
  let current = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (sections[line] !== undefined) { current = line; continue; }
    if (!current) continue;
    sections[current].push(line);
  }
  return sections;
}

/**
 * "Light Toxtricity #SWSH137 — SWSH: Sword & Shield Promo Cards (bump to 3)"
 * "Onix GX — Hidden Fates (bump to 2)"  (no #NUMBER)
 * "Mimikyu (Delta Species) #SWSH136 — SWSH: Sword & Shield Promo Cards (bump to 3)"
 *   → name="Mimikyu", variant="Delta Species" (variants live in col K)
 */
function parseStockBump(line) {
  const m = line.match(/^(.+?)(?:\s+#(\S+))?\s+—\s+(.+?)\s+\(bump to (\d+)\)$/);
  if (!m) return null;
  let name = m[1].trim();
  let variant = '';
  const variantMatch = name.match(/^(.+?)\s+\(([^)]+)\)$/);
  if (variantMatch) {
    name = variantMatch[1].trim();
    variant = variantMatch[2].trim();
  }
  return {
    name,
    variant,
    number: (m[2] || '').trim(),
    setName: m[3].trim(),
    stock: parseInt(m[4], 10),
  };
}

/**
 * "Leafeon V (Full Art) — SWSH07: Evolving Skies ($20 variant)"
 * Match key: name (without parenthetical), set, price.
 */
function parseRemoval(line) {
  const m = line.match(/^(.+?)(?:\s+\([^)]+\))?\s+—\s+(.+?)\s+\(\$(\d+(?:\.\d+)?)\s+variant\)$/);
  if (!m) return null;
  return {
    name: m[1].trim(),
    setName: m[2].trim(),
    price: `$${m[3]}`,
  };
}

/**
 * Free-form name + optional number/set + price + optional stock.
 * Examples:
 *   "Volcanion EX 107/114 (price $15)"
 *   "Pikachu SVPEN 027 Promo (price $30)"
 *   "Miraidon SVP en 013 Promo (price $10)"
 *   "Moltres & Zapdos & Articuno SM210 promo (price: $160, stock: 20)"
 *   "Detective Pikachu SM190 ($10)"
 *   "Quagsire SV10/SV94 (price $25, stock: 3)"
 *   "Kartana SV33/SSV94 (price $10)"   ← SSV94 → SV94
 */
function parseNewCard(line) {
  // 1. Strip + parse trailing "(...)" pricing block
  const trail = line.match(/\(([^)]+)\)\s*$/);
  if (!trail) return null;
  const head = line.slice(0, trail.index).trim();
  const body = trail[1];

  let price = null;
  let stock = 1;
  for (const part of body.split(',').map((s) => s.trim())) {
    const priceMatch = part.match(/^(?:price\s*:?\s*)?\$?(\d+(?:\.\d+)?)$/i);
    const stockMatch = part.match(/^stock\s*:?\s*(\d+)$/i);
    if (priceMatch) price = `$${priceMatch[1]}`;
    else if (stockMatch) stock = parseInt(stockMatch[1], 10);
  }
  if (price === null) return null;

  // 2. Drop a trailing "Promo" / "promo"
  let rest = head.replace(/\s+promo$/i, '').trim();

  // 3. Extract card number / set tokens from the right.
  //    Cases handled (right-to-left):
  //      a) "<a>/<b>"           e.g., "107/114" or "SV10/SV94"
  //      b) two-token "X N" where X is uppercase code with optional
  //         lowercase suffix and N is digits — "SVP en 013", "SVPEN 027",
  //         "SVPen 014"
  //      c) single-token "ABC123" — "SWSH028", "SM84"
  //
  //    Once captured: cardNumber → col H, setCode → col J (when
  //    derivable; left blank otherwise so enrich-singles can fill).
  let cardNumber = '';
  let setCode = '';

  const slashMatch = rest.match(/\s+([A-Za-z0-9]+\/[A-Za-z0-9]+)$/);
  if (slashMatch) {
    cardNumber = slashMatch[1].replace(/SSV/g, 'SV'); // SSV → SV typo
    rest = rest.slice(0, slashMatch.index).trim();
  } else {
    // two-token set+number, allowing mixed case and spaces:
    //   "SVP en 013", "SVPen 027", "SVPEN 027"
    const twoToken = rest.match(/\s+([A-Za-z]+(?:\s+[a-z]+)?)\s+(\d+)$/);
    const singleToken = rest.match(/\s+([A-Z]+\d+)$/);
    if (twoToken) {
      const codeRaw = twoToken[1];
      const num = twoToken[2];
      // Normalize SVPEN/SVPen → SVP en
      setCode = codeRaw.replace(/^SVP(EN|en)$/i, 'SVP en');
      cardNumber = num;
      rest = rest.slice(0, twoToken.index).trim();
    } else if (singleToken) {
      // "SWSH010", "SM06", etc. — this is the card number (col H).
      // The set code (col J) is a different value (e.g., "SWSD" for
      // SWSH promos, not "SWSH010"); leave J empty and let
      // enrich-singles fill it via the Pokemon TCG API.
      cardNumber = singleToken[1];
      rest = rest.slice(0, singleToken.index).trim();
    }
  }

  return { name: rest, cardNumber, setCode, price, stock };
}

// ---------------------------------------------------------------------------
// Sheet ops
// ---------------------------------------------------------------------------

function findStockMatch(rows, target) {
  return rows
    .map((r, i) => ({
      index: i,
      name: (r[0] || '').trim(),
      number: (r[7] || '').trim(),
      set: (r[8] || '').trim(),
      variant: (r[10] || '').trim(),
    }))
    .filter((r) => r.name.toLowerCase() === target.name.toLowerCase()
      && (target.number ? r.number === target.number : r.number === '')
      && r.set === target.setName
      && (target.variant ? r.variant.toLowerCase() === target.variant.toLowerCase() : true));
}

function findRemovalMatch(rows, target) {
  return rows
    .map((r, i) => ({ index: i, name: (r[0] || '').trim(), set: (r[8] || '').trim(), price: (r[4] || '').trim() }))
    .filter((r) => r.name.toLowerCase() === target.name.toLowerCase()
      && r.set === target.setName
      && r.price === target.price);
}

async function getSheetId(sheets) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets(properties(sheetId,title))' });
  const tab = meta.data.sheets.find((s) => s.properties.title === SHEET_NAME);
  if (!tab) throw new Error(`Sheet "${SHEET_NAME}" not found`);
  return tab.properties.sheetId;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const text = fs.readFileSync(UPDATES_PATH, 'utf8');
  const sections = parseUpdates(text);

  console.log(`\n=== Parsed sections ===`);
  console.log(`  Update Stock: ${sections['Update Stock'].length}`);
  console.log(`  Cards to Remove: ${sections['Cards to Remove'].length}`);
  console.log(`  New Cards: ${sections['New Cards'].length}`);

  const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: APPLY ? ['https://www.googleapis.com/auth/spreadsheets'] : ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });

  const dataRes = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SHEET_NAME}!A2:T`,
  });
  const rows = dataRes.data.values || [];
  console.log(`  Sheet rows: ${rows.length}\n`);

  // ─── Update Stock ────────────────────────────────────────────────────────
  console.log(`=== Update Stock (planned) ===`);
  const stockOps = []; // { rowNumber: 1-indexed sheet row, newStock }
  let stockUnmatched = 0;
  let stockAmbiguous = 0;
  for (const line of sections['Update Stock']) {
    const target = parseStockBump(line);
    if (!target) {
      console.log(`  ⚠ unparseable: ${line}`);
      stockUnmatched++;
      continue;
    }
    const matches = findStockMatch(rows, target);
    if (matches.length === 0) {
      console.log(`  ✗ no match: ${target.name} #${target.number || '(none)'} — ${target.setName}`);
      stockUnmatched++;
    } else if (matches.length > 1) {
      console.log(`  ✗ ambiguous (${matches.length} matches): ${target.name}`);
      stockAmbiguous++;
    } else {
      const m = matches[0];
      const sheetRow = m.index + 2;
      stockOps.push({ rowNumber: sheetRow, newStock: target.stock });
      if (VERBOSE) console.log(`  ✓ row ${sheetRow}: ${m.name} → stock ${target.stock}`);
    }
  }
  console.log(`  Total: ${stockOps.length} matched, ${stockUnmatched} unmatched, ${stockAmbiguous} ambiguous\n`);

  // ─── Cards to Remove ─────────────────────────────────────────────────────
  console.log(`=== Cards to Remove (planned) ===`);
  const removalRows = []; // 1-indexed sheet rows
  for (const line of sections['Cards to Remove']) {
    const target = parseRemoval(line);
    if (!target) {
      console.log(`  ⚠ unparseable: ${line}`);
      continue;
    }
    const matches = findRemovalMatch(rows, target);
    if (matches.length === 0) {
      console.log(`  ✗ no match: ${target.name} — ${target.setName} ${target.price}`);
    } else if (matches.length > 1) {
      console.log(`  ✗ ambiguous (${matches.length}): ${target.name} ${target.price}`);
    } else {
      const m = matches[0];
      const sheetRow = m.index + 2;
      removalRows.push(sheetRow);
      console.log(`  ✓ row ${sheetRow}: ${m.name} (${m.price}) — will delete`);
    }
  }
  console.log(`  Total: ${removalRows.length} to delete\n`);

  // ─── New Cards ───────────────────────────────────────────────────────────
  console.log(`=== New Cards (planned) ===`);
  const newRows = []; // raw row arrays A..T
  let newUnparsed = 0;
  for (const line of sections['New Cards']) {
    const parsed = parseNewCard(line);
    if (!parsed) {
      console.log(`  ⚠ unparseable: ${line}`);
      newUnparsed++;
      continue;
    }
    // Build a 20-cell row. Only fill the columns we have data for.
    const row = new Array(20).fill('');
    row[0] = parsed.name;        // A
    row[4] = parsed.price;       // E
    row[5] = String(parsed.stock); // F
    row[7] = parsed.cardNumber;  // H
    row[9] = parsed.setCode;     // J
    newRows.push(row);
    console.log(`  ✓ ${parsed.name.padEnd(35)} | num=${parsed.cardNumber.padEnd(10)} | code=${parsed.setCode.padEnd(10)} | price=${parsed.price.padEnd(6)} | stock=${parsed.stock}`);
  }
  console.log(`  Total: ${newRows.length} to append, ${newUnparsed} unparseable\n`);

  if (!APPLY) {
    console.log(`📋 DRY-RUN — pass --apply to execute these changes against the Singles sheet.`);
    return;
  }

  // ─── EXECUTE ─────────────────────────────────────────────────────────────
  console.log(`🚀 APPLYING changes...\n`);

  // 1) Stock updates — batch update column F by row number.
  if (stockOps.length) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        valueInputOption: 'RAW',
        data: stockOps.map((op) => ({
          range: `${SHEET_NAME}!F${op.rowNumber}`,
          values: [[String(op.newStock)]],
        })),
      },
    });
    console.log(`  ✓ Updated stock on ${stockOps.length} row(s).`);
  }

  // 2) Append new cards as a contiguous block at the bottom.
  if (newRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:T`,
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: newRows },
    });
    console.log(`  ✓ Appended ${newRows.length} new card row(s).`);
  }

  // 3) Deletions — delete rows by sheet row index, descending so later
  //    deletions don't shift earlier indices.
  if (removalRows.length) {
    const sheetId = await getSheetId(sheets);
    const sortedDesc = removalRows.slice().sort((a, b) => b - a);
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: {
        requests: sortedDesc.map((row) => ({
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: row - 1, // zero-indexed
              endIndex: row,
            },
          },
        })),
      },
    });
    console.log(`  ✓ Deleted ${removalRows.length} row(s).`);
  }

  console.log(`\n✅ Done. Singles tab updated.`);
  console.log(`   Next: make enrich-singles  →  make sync-cards  →  flush Next.js image cache.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
