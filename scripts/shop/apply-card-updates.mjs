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
 * Two formats supported:
 *
 * 1. Em-dash form (original):
 *      "Light Toxtricity #SWSH137 — SWSH: Sword & Shield Promo Cards (bump to 3)"
 *      "Onix GX — Hidden Fates (bump to 2)"
 *      "Mimikyu (Delta Species) #SWSH136 — SWSH: ... (bump to 3)"
 *
 * 2. Vintage-natural form (matches operator's freehand style for WOTC sets):
 *      "Switch Base Set 95/102 (increase stock by 1)"
 *      "Eevee Jungle 51/64 (increase stock by 1, and change price to $20)"
 *      "Switch Base Set 95/102 (update stock to 2)"
 *      "Drowzee Team Rocket 54/82 First Edition (bump to 3)"
 *
 *    Same vintage-set-inline + slash-number tokenization used by
 *    parseNewCard. "increase stock by N" is incremental (resolved
 *    against the current sheet value at apply time); "update stock
 *    to N" / "bump to N" are absolute.
 *
 * Returns:
 *   { name, variant, number, setName,
 *     stockOp: { type: 'absolute' | 'delta', value: Int },
 *     newPrice: '$X' | null }
 */
function parseStockBump(line) {
  // Try em-dash form first (cheap regex; bail to natural form if no match).
  const oldM = line.match(/^(.+?)(?:\s+#(\S+))?\s+—\s+(.+?)\s+\((bump to|update stock to) (\d+)\)$/);
  if (oldM) {
    let name = oldM[1].trim();
    let variant = '';
    const variantMatch = name.match(/^(.+?)\s+\(([^)]+)\)$/);
    if (variantMatch) {
      name = variantMatch[1].trim();
      variant = variantMatch[2].trim();
    }
    return {
      name,
      variant,
      number: (oldM[2] || '').trim(),
      setName: oldM[3].trim(),
      stockOp: { type: 'absolute', value: parseInt(oldM[5], 10) },
      newPrice: null,
    };
  }

  // Vintage-natural form: shares the trailing-paren + vintage-set + number
  // tokenization with parseNewCard.
  const trail = line.match(/\(([^)]+)\)\s*$/);
  if (!trail) return null;
  const head = line.slice(0, trail.index).trim();
  const body = trail[1];

  let stockOp = null;
  let newPrice = null;
  for (const part of body.split(',').map((s) => s.trim())) {
    let m;
    m = part.match(/^(?:and\s+)?increase stock by (\d+)$/i);
    if (m) { stockOp = { type: 'delta', value: parseInt(m[1], 10) }; continue; }
    m = part.match(/^(?:and\s+)?(?:update stock to|bump to) (\d+)$/i);
    if (m) { stockOp = { type: 'absolute', value: parseInt(m[1], 10) }; continue; }
    m = part.match(/^(?:and\s+)?change price to \$?(\d+(?:\.\d+)?)$/i);
    if (m) { newPrice = `$${m[1]}`; continue; }
  }
  if (!stockOp) return null;

  // Now parse name + (optional First Edition variant) + (optional vintage
  // set) + number from `head`. Same logic as parseNewCard.
  let rest = head;
  let variant = '';
  if (/\bFirst Edition\b/i.test(rest)) {
    variant = 'First Edition';
    rest = rest.replace(/\s+First Edition\s*/i, ' ').trim();
  }

  let setName = '';
  for (const set of VINTAGE_SET_NAMES) {
    const setRegex = new RegExp(`\\s+${set.replace(/\s+/g, '\\s+')}(?=\\s+\\d|\\s*$)`, 'i');
    const m = rest.match(setRegex);
    if (m) {
      setName = set;
      rest = rest.slice(0, m.index).trim() + ' ' + rest.slice(m.index + m[0].length);
      rest = rest.trim();
      break;
    }
  }

  let cardNumber = '';
  const slashMatch = rest.match(/\s+([A-Za-z0-9]+\/[A-Za-z0-9]+)$/);
  if (slashMatch) {
    cardNumber = slashMatch[1].replace(/SSV/g, 'SV');
    rest = rest.slice(0, slashMatch.index).trim();
  } else {
    const twoToken = rest.match(/\s+([A-Za-z]+(?:\s+[a-z]+)?)\s+(\d+)$/);
    const singleToken = rest.match(/\s+([A-Z]+\d+)$/);
    if (twoToken) {
      cardNumber = twoToken[2];
      rest = rest.slice(0, twoToken.index).trim();
    } else if (singleToken) {
      cardNumber = singleToken[1];
      rest = rest.slice(0, singleToken.index).trim();
    }
  }

  return {
    name: rest,
    variant,
    number: cardNumber,
    setName,
    stockOp,
    newPrice,
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
 * Vintage WOTC set names (1999-2000 era). Operator commonly drops the
 * set name inline between card name and number, e.g.:
 *   "Omanyte Fossil 52/62 (price $10)"
 *   "Energy Retrieval Base Set 2 110/130 (price $10)"
 *   "Charmander Team Rocket 50/82 (price $15)"
 *
 * Listed longest-first so multi-word sets ("Base Set 2") win over
 * shorter prefixes ("Base Set") during regex match.
 */
const VINTAGE_SET_NAMES = [
  'Base Set 2',
  'Gym Challenge',
  'Gym Heroes',
  'Team Rocket',
  'Base Set',
  'Jungle',
  'Fossil',
];

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
 *   "Omanyte Fossil 52/62 (price $10)" ← vintage set name inline → col I
 *   "Koffing Team Rocket 58/82 First Edition (price $20)" ← variant → col K
 */
function parseNewCard(line) {
  // 0. Normalize known typos before any tokenization.
  line = line.replace(/Team Tocket/gi, 'Team Rocket');

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

  // 2b. Extract a "First Edition" variant marker (col K).
  let variant = '';
  if (/\bFirst Edition\b/i.test(rest)) {
    variant = 'First Edition';
    rest = rest.replace(/\s+First Edition\s*/i, ' ').trim();
  }

  // 2c. Extract a vintage WOTC set name inline (between card name and
  //     number). Captured to setName for col I; the regex strips it
  //     out of `rest` so step 3 can extract the numeric tail cleanly.
  let setName = '';
  for (const set of VINTAGE_SET_NAMES) {
    const setRegex = new RegExp(`\\s+${set.replace(/\s+/g, '\\s+')}(?=\\s+\\d|\\s*$)`, 'i');
    const m = rest.match(setRegex);
    if (m) {
      setName = set;
      rest = rest.slice(0, m.index).trim() + ' ' + rest.slice(m.index + m[0].length);
      rest = rest.trim();
      break;
    }
  }

  // 3. Extract card number / set tokens from the right.
  //    Cases handled (right-to-left):
  //      a) "<a>/<b>"           e.g., "107/114" or "SV10/SV94" or "52/62"
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

  return { name: rest, setName, variant, cardNumber, setCode, price, stock };
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
    range: `${SHEET_NAME}!A2:U`,
  });
  const rows = dataRes.data.values || [];
  console.log(`  Sheet rows: ${rows.length}\n`);

  // ─── Update Stock ────────────────────────────────────────────────────────
  console.log(`=== Update Stock (planned) ===`);
  const stockOps = []; // { rowNumber, newStock, newPrice? }
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
      // Resolve delta against the current sheet value. Strip non-digit
      // chars so any stray formatting in col G can't poison the math.
      // (Stock col moved F→G in the 2026-05-25 schema.)
      const currentRaw = (rows[m.index][6] || '0').toString();
      const currentStock = parseInt(currentRaw.replace(/[^0-9-]/g, ''), 10) || 0;
      const newStock = target.stockOp.type === 'delta'
        ? currentStock + target.stockOp.value
        : target.stockOp.value;

      stockOps.push({ rowNumber: sheetRow, newStock, newPrice: target.newPrice });

      if (VERBOSE) {
        const stockNote = target.stockOp.type === 'delta'
          ? `stock ${currentStock} → ${newStock} (+${target.stockOp.value})`
          : `stock → ${newStock}`;
        const priceNote = target.newPrice ? `, price → ${target.newPrice}` : '';
        console.log(`  ✓ row ${sheetRow}: ${m.name} | ${stockNote}${priceNote}`);
      }
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
  const newRows = []; // raw row arrays A..U (A-U schema, 2026-05-25)
  let newUnparsed = 0;
  for (const line of sections['New Cards']) {
    const parsed = parseNewCard(line);
    if (!parsed) {
      console.log(`  ⚠ unparseable: ${line}`);
      newUnparsed++;
      continue;
    }
    // Build a 21-cell row (A-U). Only fill the columns we have data for.
    // BIN Price (col F) is left blank — populated by a separate flow.
    const row = new Array(21).fill('');
    row[0] = parsed.name;          // A
    row[4] = parsed.price;         // E Auction Price
    row[6] = String(parsed.stock); // G Stock          (was F)
    row[8] = parsed.cardNumber;    // I Card Number    (was H)
    row[9] = parsed.setName;       // J Set Name       (was I)
    row[10] = parsed.setCode;      // K Set Code       (was J)
    row[11] = parsed.variant;      // L Variant        (was K)
    newRows.push(row);
    console.log(`  ✓ ${parsed.name.padEnd(28)} | num=${parsed.cardNumber.padEnd(8)} | set=${(parsed.setName || '').padEnd(14)} | variant=${(parsed.variant || '').padEnd(14)} | price=${parsed.price.padEnd(5)} | stock=${parsed.stock}`);
  }
  console.log(`  Total: ${newRows.length} to append, ${newUnparsed} unparseable\n`);

  if (!APPLY) {
    console.log(`📋 DRY-RUN — pass --apply to execute these changes against the Singles sheet.`);
    return;
  }

  // ─── EXECUTE ─────────────────────────────────────────────────────────────
  console.log(`🚀 APPLYING changes...\n`);

  // 1) Stock updates — batch update column G by row number, plus optional
  //    Auction Price (col E) when an "and change price to $X" clause was
  //    parsed. (Stock col moved F→G in the 2026-05-25 schema.)
  if (stockOps.length) {
    const data = [];
    for (const op of stockOps) {
      data.push({
        range: `${SHEET_NAME}!G${op.rowNumber}`,
        values: [[String(op.newStock)]],
      });
      if (op.newPrice) {
        data.push({
          range: `${SHEET_NAME}!E${op.rowNumber}`,
          values: [[op.newPrice]],
        });
      }
    }
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: SPREADSHEET_ID,
      requestBody: { valueInputOption: 'RAW', data },
    });
    const priceCount = stockOps.filter((op) => op.newPrice).length;
    console.log(`  ✓ Updated stock on ${stockOps.length} row(s)${priceCount ? `, including ${priceCount} price change(s)` : ''}.`);
  }

  // 2) Append new cards as a contiguous block at the bottom.
  if (newRows.length) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: SPREADSHEET_ID,
      range: `${SHEET_NAME}!A:U`,
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
