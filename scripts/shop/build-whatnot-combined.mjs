/**
 * Build a combined Whatnot import CSV: the Pokémon BIN-show CSV + the YGO CSV
 * merged into one file, all listings sorted ascending by Price (a single
 * low→high queue for a mixed-game show).
 *
 * Reads the two same-dated CSVs from vincentragosta.io/tmp:
 *   whatnot-bin-show-import-{date}.csv   (built by build-whatnot-full-import --bin-show)
 *   whatnot-yugioh-import-{date}.csv     (built by build-whatnot-yugioh)
 * and writes:
 *   whatnot-combined-import-{date}.csv
 *
 * Both inputs share the identical Whatnot header (asserted). Price is column 7
 * (index 6). Original data lines are preserved verbatim — only reordered — so
 * no re-quoting/escaping risk.
 *
 * Usage: node scripts/shop/build-whatnot-combined.mjs [--date=YYYY-MM-DD]
 */
import fs from 'node:fs';
import path from 'node:path';

const TMP = path.resolve(process.env.HOME, 'Projects/vinnyrags/personal/vincentragosta.io/tmp');
const dateArg = process.argv.find((a) => a.startsWith('--date='));
const DATE = dateArg ? dateArg.split('=')[1] : new Date().toISOString().slice(0, 10);

const POKEMON = path.join(TMP, `whatnot-bin-show-import-${DATE}.csv`);
const YGO = path.join(TMP, `whatnot-yugioh-import-${DATE}.csv`);
const OUT = path.join(TMP, `whatnot-combined-import-${DATE}.csv`);
const PRICE_COL = 6; // 0-based index of "Price"

// Minimal CSV field parser (quoted fields, escaped "" quotes; no embedded
// newlines — true for these single-line listings). Used only to read Price.
function priceOf(line) {
  const fields = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { fields.push(cur); cur = ''; }
    else cur += ch;
  }
  fields.push(cur);
  return parseFloat((fields[PRICE_COL] || '').replace(/[^0-9.]/g, '')) || 0;
}

const readLines = (p) => {
  if (!fs.existsSync(p)) { console.error(`Missing: ${p}`); process.exit(1); }
  return fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.length);
};

const pk = readLines(POKEMON);
const yg = readLines(YGO);
if (pk[0] !== yg[0]) { console.error('Header mismatch between the two CSVs — aborting.'); process.exit(1); }

const header = pk[0];
const data = [...pk.slice(1), ...yg.slice(1)];
data.sort((a, b) => priceOf(a) - priceOf(b));

fs.writeFileSync(OUT, [header, ...data].join('\n') + '\n');
console.log(`Wrote ${data.length} combined listings → ${OUT}`);
console.log(`  Pokémon: ${pk.length - 1} · YGO: ${yg.length - 1} · price range $${priceOf(data[0])}–$${priceOf(data[data.length - 1])}`);
