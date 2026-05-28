/**
 * Build a Whatnot bulk-import CSV containing every in-stock card + product
 * in WP. Replaces the entire Whatnot inventory in one pass — the operator
 * deletes the existing Whatnot listings before importing.
 *
 * Source: /tmp/inventory.json (exported from WP via wp eval-file).
 *
 * Modes:
 *   default               Every in-stock item as Buy it Now, WP query order.
 *                         Output: tmp/whatnot-full-import-{date}.csv
 *   --auction             Type=Auction (Price becomes starting bid), rows
 *                         sorted ascending by Price so a 10s-auction show
 *                         queue warms up cheap and climaxes on chase cards.
 *                         Also appends the PERMANENT_BIN_PRODUCT_IDS as a
 *                         trailing Buy it Now block (mixed-Type CSV) so one
 *                         pre-show import restores the always-on shop too —
 *                         do NOT also import the permanent-bin CSV or those
 *                         11 items double up.
 *                         Output: tmp/whatnot-auction-import-{date}.csv
 *   --permanent-bin-only  Only PERMANENT_BIN_PRODUCT_IDS as BIN — uploaded
 *                         post-show so the shop has passive listings while
 *                         not streaming.
 *                         Output: tmp/whatnot-permanent-bin-import-{date}.csv
 *   --skus=id1,id2,...     Ad-hoc subset — only those WP post IDs. Drops the
 *                          generic quick-pick rows and the permanent-BIN block.
 *                          Combine with --auction for auction-type rows (e.g.
 *                          dropping a freshly-added set onto Whatnot without
 *                          re-uploading the whole catalog).
 *                          Output: tmp/whatnot-{mode}-subset-import-{date}.csv
 *   --post-stream-bin     Same selection as --auction (cards + named sealed,
 *                         skips permanent-BIN), but Type=Buy it Now and card
 *                         prices use the tiered BIN markup ($1→$5; <$65→+$5;
 *                         ≥$65→+$10). Named sealed keep their single price.
 *                         Uploaded post-stream for unsold auction items.
 *                         Output: tmp/whatnot-post-stream-bin-import-{date}.csv
 *
 * Shipping profile rules:
 *   card                              -> "0-1 oz"
 *   product (single booster pack)     -> "1-3 oz"
 *   product (everything else)         -> "1 lb"
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.HOME, 'Projects/vinnyrags/websites');
const INVENTORY = '/tmp/inventory.json';
const today = new Date().toISOString().slice(0, 10);

// Modes:
//   default                  All in-stock items as Buy it Now.
//   --auction                Type=Auction, sorted ascending by Price,
//                            excludes PERMANENT_BIN_PRODUCT_IDS.
//   --permanent-bin-only     Only the PERMANENT_BIN_PRODUCT_IDS as BIN —
//                            the always-on shop CSV uploaded post-show to
//                            keep passive sales running between streams.
const IS_AUCTION = process.argv.includes('--auction');
const IS_PERMANENT_BIN_ONLY = process.argv.includes('--permanent-bin-only');
const IS_POST_STREAM_BIN = process.argv.includes('--post-stream-bin');
const LISTING_TYPE = IS_AUCTION ? 'Auction' : 'Buy it Now';

// --skus=id1,id2,... restricts output to those WP post IDs only — an ad-hoc
// subset import for dropping a freshly-added batch onto Whatnot without
// re-uploading the whole catalog. Suppresses the generic quick-pick rows and
// the permanent-BIN trailing block (those belong only to a full pre-show
// import). Combines with --auction for auction-type rows; otherwise BIN.
const SKUS_ARG = process.argv.find((a) => a.startsWith('--skus='));
const ONLY_SKUS = SKUS_ARG
    ? new Set(SKUS_ARG.split('=')[1].split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite))
    : null;

let outSuffix = 'full';
if (IS_AUCTION) outSuffix = 'auction';
else if (IS_PERMANENT_BIN_ONLY) outSuffix = 'permanent-bin';
else if (IS_POST_STREAM_BIN) outSuffix = 'post-stream-bin';
if (ONLY_SKUS) outSuffix += '-subset';
const OUT_CSV = path.join(ROOT, `tmp/whatnot-${outSuffix}-import-${today}.csv`);

// Tiered BIN markup over Auction Price. Matches the formula used to
// populate column F in the Singles sheet so the generated CSV stays in
// sync with sheet values without reading the sheet directly. Applied
// only to cards in --post-stream-bin mode; named sealed products use
// their single price unchanged.
//
// Rule (updated 2026-05-26): anything under $5 floors to a flat $5 (no
// +$5 added) — keeps cheap commons shippable without an outsized markup.
// $5–$64 gets +$5, $65+ gets +$10.
function tieredBinFromAuction(auctionDollars) {
    if (auctionDollars < 5) return 5;
    if (auctionDollars < 65) return auctionDollars + 5;
    return auctionDollars + 10;
}

// WP product IDs that stay BIN-only forever — never auctioned. Sealed
// products curated for permanent passive shop inventory (Pokemon booster
// packs, JPN sealed boxes, poster collection, Pikachu VMAX figure, and
// the Weiss Schwarz anime catalog).
//
// Update this set when a product changes classification. The auction
// build skips these; the --permanent-bin-only build emits only these.
const PERMANENT_BIN_PRODUCT_IDS = new Set([
    4889, // Pokemon Celebrations Premium Figure Collection Pikachu VMAX
    4909, // Pokemon Lost Origin Booster Pack
    4911, // Pokemon Astral Radiance Booster Pack
    4913, // Weiss Schwarz Is it Wrong to Try to Pick Up Girls in a Dungeon?
    4915, // Weiss Schwarz Tokyo Revengers
    4923, // Pokemon Scarlet & Violet Prismatic Evolutions Poster Collection
    4925, // Weiss Schwarz Ms Kobayashi Dragon Maid
    4927, // Pokemon Triple Beat
    4929, // Pokemon Dark Fantasma
    4931, // Pokemon Snow Hazard
    4933, // Weiss Schwarz JoJo's Bizarre Adventure Golden Wind
]);

// Product IDs that get the lighter "1-3 oz" profile (single booster packs).
// Everything else in post_type=product gets "1 lb".
const LIGHT_PRODUCT_IDS = new Set([
    4911, // Pokemon Astral Radiance Booster Pack
    4909, // Pokemon Lost Origin Booster Pack
]);

// Generic "quick pick" filler auctions — high-quantity placeholder listings
// at fixed price points the operator fires off mid-show without prepping a
// per-card listing. Auction-mode only; they sort in by Price with the rest.
// Images are branded $2/$5/$10/$15/$20/$25 graphics hosted in WP media.
const GENERIC_AUCTION_ROWS = [
    {
        price: 2,
        sku: 'QUICK-2',
        title: 'itzenzoTTV $2 Quick Auction — Pokémon Single',
        image: 'https://vincentragosta.io/wp-content/uploads/2026/05/quick-auction-2.png',
    },
    {
        price: 5,
        sku: 'QUICK-5',
        title: 'itzenzoTTV $5 Quick Auction — Pokémon Single',
        image: 'https://vincentragosta.io/wp-content/uploads/2026/05/quick-auction-5.png',
    },
    {
        price: 10,
        sku: 'QUICK-10',
        title: 'itzenzoTTV $10 Quick Auction — Pokémon Single',
        image: 'https://vincentragosta.io/wp-content/uploads/2026/05/quick-auction-10.png',
    },
    {
        price: 15,
        sku: 'QUICK-15',
        title: 'itzenzoTTV $15 Quick Auction — Pokémon Single',
        image: 'https://vincentragosta.io/wp-content/uploads/2026/05/quick-auction-15.png',
    },
    {
        price: 20,
        sku: 'QUICK-20',
        title: 'itzenzoTTV $20 Quick Auction — Pokémon Single',
        image: 'https://vincentragosta.io/wp-content/uploads/2026/05/quick-auction-20.png',
    },
    {
        price: 25,
        sku: 'QUICK-25',
        title: 'itzenzoTTV $25 Quick Auction — Pokémon Single',
        image: 'https://vincentragosta.io/wp-content/uploads/2026/05/quick-auction-25.png',
    },
];

function buildGenericAuctionRow({ price, sku, title, image }) {
    return {
        Category: 'Trading Card Games',
        'Sub Category': 'Pokémon Cards',
        Title: title,
        Description:
            `Quick-pick Pokémon single-card auction with a $${price} starting bid — ` +
            `the exact card is shown live on stream at auction time. Near Mint unless ` +
            `stated. Ships in a penny sleeve + hard plastic toploader inside a bubble ` +
            `mailer with tracking. Smoke-free environment, packed within 1-2 business ` +
            `days of payment.`,
        Quantity: '1000',
        Type: 'Auction',
        Price: String(price),
        'Shipping Profile': '0-1 oz',
        Offerable: 'TRUE',
        Hazmat: 'Not Hazmat',
        Condition: 'Near Mint',
        'Cost Per Item': '',
        SKU: sku,
        'Image URL 1': image,
    };
}

const HEADER = [
    'Category', 'Sub Category', 'Title', 'Description', 'Quantity', 'Type',
    'Price', 'Shipping Profile', 'Offerable', 'Hazmat', 'Condition',
    'Cost Per Item', 'SKU',
    'Image URL 1', 'Image URL 2', 'Image URL 3', 'Image URL 4',
    'Image URL 5', 'Image URL 6', 'Image URL 7', 'Image URL 8',
];

function csvEscape(s) {
    if (s == null) return '';
    const str = String(s);
    if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
    return str;
}

function priceFromMeta(price) {
    // Whatnot requires positive integers — round half-up. Subcent prices
    // like $99.99 become 100, $149.99 → 150. This is a strict requirement
    // of the bulk-import CSV; non-integers fail validation.
    if (!price) return '';
    const cleaned = String(price).replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    if (!Number.isFinite(num) || num < 1) return '';
    return String(Math.round(num));
}

// Whatnot's Trading Card Games category enforces a small subcategory
// enum. Anything outside the enum (e.g. "Other TCG Products") fails
// CSV validation. "Pokémon Cards" is the only subcategory we've
// confirmed Whatnot accepts in our uploads, so every product falls
// back to it — the operator can re-tag any Weiss Schwarz / etc.
// listings via the Whatnot UI after import. Caller still passes
// title in case we expand the enum mapping later.
function inferProductSubcategory(_title) {
    return 'Pokémon Cards';
}

function titleCase(s) {
    return String(s || '').replace(/(^|[-\s])([a-z])/g,
        (_, p, c) => p + c.toUpperCase()).replace(/-/g, ' ');
}

function conditionLabel(slug) {
    const map = {
        'near-mint': 'Near Mint',
        'lightly-played': 'Lightly Played',
        'moderately-played': 'Moderately Played',
        'heavily-played': 'Heavily Played',
        damaged: 'Damaged',
    };
    return map[slug] || 'Near Mint';
}

function buildCardRow(item) {
    const m = item.meta || {};
    const setName = m.set_name || '';
    const cardNumber = m.card_number || '';
    const rarity = titleCase(m.rarity || 'Unknown');
    const language = m.language || 'English';
    const artist = m.artist || '';
    const condition = conditionLabel(m.condition);
    const title = item.title;
    const desc = (
        `Pokémon TCG single card ${m.card_name || ''} #${cardNumber} from the ${setName} set. ` +
        `Set: ${setName}. Card Number: ${cardNumber}. ` +
        `Language: ${language}. Rarity: ${rarity}. ` +
        (artist ? `Illustrator: ${artist}. ` : '') +
        `Condition: ${condition}. ` +
        `See images for full visual assessment — buyer is welcome to message with any condition questions before purchase. ` +
        `Ships in a penny sleeve + hard plastic toploader inside a bubble mailer with tracking. ` +
        `Smoke-free environment, packed within 1-2 business days of payment.`
    );
    // In --post-stream-bin mode, card price is the tiered BIN markup over
    // the Auction Price stored in WP. Other modes use the WP price as-is.
    let priceCell = priceFromMeta(m.price);
    if (IS_POST_STREAM_BIN && priceCell) {
        priceCell = String(tieredBinFromAuction(parseInt(priceCell, 10)));
    }

    return {
        Category: 'Trading Card Games',
        'Sub Category': 'Pokémon Cards',
        Title: title,
        Description: desc,
        Quantity: m.stock_quantity || '1',
        Type: IS_POST_STREAM_BIN ? 'Buy it Now' : LISTING_TYPE,
        Price: priceCell,
        'Shipping Profile': '0-1 oz',
        Offerable: 'TRUE',
        Hazmat: 'Not Hazmat',
        Condition: condition,
        'Cost Per Item': '',
        SKU: String(item.id),
        'Image URL 1': item.image || '',
    };
}

function buildProductRow(item) {
    const m = item.meta || {};
    const title = item.title;
    const shippingProfile = LIGHT_PRODUCT_IDS.has(item.id) ? '1-3 oz' : '1 lb';
    const desc = (
        `${title}. ` +
        `Sealed product, factory condition. ` +
        `See images for full visual assessment. ` +
        `Smoke-free environment, packed within 1-2 business days of payment.`
    );
    return {
        Category: 'Trading Card Games',
        'Sub Category': inferProductSubcategory(title),
        Title: title,
        Description: desc,
        Quantity: m.stock_quantity || '1',
        // Named sealed products keep their single price under both auction
        // and post-stream-BIN modes (no BIN markup — the col-B price is
        // already the BIN-style price for sealed inventory).
        Type: IS_POST_STREAM_BIN ? 'Buy it Now' : LISTING_TYPE,
        Price: priceFromMeta(m.price),
        'Shipping Profile': shippingProfile,
        Offerable: 'TRUE',
        Hazmat: 'Not Hazmat',
        Condition: 'New',
        'Cost Per Item': '',
        SKU: String(item.id),
        'Image URL 1': item.image || '',
    };
}

async function main() {
    const inv = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
    const builtRows = [];
    // Permanent-BIN items ride along in the auction CSV as a trailing
    // Buy it Now block so one pre-show import restores the always-on shop
    // alongside the auctions (no separate permanent-BIN upload needed).
    const permanentRows = [];
    let cardCount = 0, productCount = 0, permanentCount = 0;
    const skipped = [];
    const fallbackSubcategory = [];
    const roundedPrices = [];

    for (const item of inv) {
        // --skus subset: drop everything not in the requested ID set before
        // any other handling so the skipped log only reflects subset items.
        if (ONLY_SKUS && !ONLY_SKUS.has(item.id)) continue;
        if (!item.image) {
            skipped.push({ id: item.id, title: item.title, reason: 'no image' });
            continue;
        }
        const isPermanentBin = item.post_type === 'product'
            && PERMANENT_BIN_PRODUCT_IDS.has(item.id);
        // Post-stream BIN excludes the permanent items (already live on the
        // shop). The auction CSV INCLUDES them as a trailing Buy it Now block
        // (handled at push time below) so a single pre-show import restores
        // the always-on shop together with the auctions.
        if (IS_POST_STREAM_BIN && isPermanentBin) {
            skipped.push({ id: item.id, title: item.title, reason: 'permanent-BIN (already on shop, excluded from post-stream BIN)' });
            continue;
        }
        if (IS_PERMANENT_BIN_ONLY && !isPermanentBin) {
            continue;
        }
        const row = item.post_type === 'card'
            ? buildCardRow(item)
            : buildProductRow(item);
        if (!row.Price) {
            skipped.push({ id: item.id, title: item.title, reason: 'no price' });
            continue;
        }
        // Surface anything Whatnot will require manual cleanup on:
        // non-Pokemon products forced to the Pokémon Cards subcategory,
        // and prices that were rounded away from their WP source value.
        if (item.post_type === 'product' && !/pok[eé]mon/i.test(item.title)) {
            fallbackSubcategory.push({ id: item.id, title: item.title });
        }
        const wpPrice = parseFloat(String((item.meta || {}).price || '').replace(/[^0-9.]/g, ''));
        if (Number.isFinite(wpPrice) && wpPrice % 1 !== 0) {
            roundedPrices.push({ id: item.id, title: item.title, from: wpPrice, to: row.Price });
        }
        // In auction mode, permanent-BIN items become a trailing Buy it Now
        // block rather than entries in the ascending-price auction queue.
        if (IS_AUCTION && isPermanentBin) {
            row.Type = 'Buy it Now';
            permanentRows.push(row);
            permanentCount++;
        } else {
            builtRows.push(row);
            if (item.post_type === 'card') cardCount++;
            else productCount++;
        }
    }

    // Generic quick-pick filler auctions — auction CSV only. Appended before
    // the sort so they slot into the ascending-price queue naturally.
    let genericCount = 0;
    if (IS_AUCTION && !ONLY_SKUS) {
        for (const g of GENERIC_AUCTION_ROWS) {
            builtRows.push(buildGenericAuctionRow(g));
            genericCount++;
        }
    }

    // Auction shows run cheap → expensive so the chat warms up on $1 commons
    // and the energy climaxes on chase cards. Post-stream BIN uses the same
    // ascending sort for consistency between the two CSV uploads — easier
    // to scan and match rows across files. Default BIN mode keeps WP order.
    if (IS_AUCTION || IS_POST_STREAM_BIN) {
        builtRows.sort((a, b) => Number(a.Price) - Number(b.Price));
    }

    // Permanent-BIN block (auction CSV only) trails the sorted auction queue,
    // sorted by price among themselves, kept as Buy it Now.
    permanentRows.sort((a, b) => Number(a.Price) - Number(b.Price));
    const finalRows = [...builtRows, ...permanentRows];

    const rows = [HEADER, ...finalRows.map(r => HEADER.map(h => r[h] ?? ''))];
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    fs.writeFileSync(OUT_CSV, csv + '\n');

    const typeLabel = IS_POST_STREAM_BIN ? 'Buy it Now (BIN markup applied)' : LISTING_TYPE;
    const sortNote = (IS_AUCTION || IS_POST_STREAM_BIN) ? ', sorted ascending by Price' : '';
    console.log(`Wrote ${rows.length - 1} rows to ${OUT_CSV} (Type=${typeLabel}${sortNote})`);
    console.log(`  cards:    ${cardCount}`);
    console.log(`  products: ${productCount}`);
    if (ONLY_SKUS) {
        const emittedIds = new Set(finalRows.map((r) => parseInt(r.SKU, 10)));
        const missing = [...ONLY_SKUS].filter((id) => !emittedIds.has(id));
        console.log(`  subset filter: ${emittedIds.size}/${ONLY_SKUS.size} requested SKUs emitted`);
        if (missing.length) console.log(`  ⚠ requested but NOT emitted (out of stock / no image / not in inventory): ${missing.join(', ')}`);
    }
    if (genericCount) console.log(`  generic quick-pick auctions: ${genericCount}`);
    if (permanentCount) console.log(`  permanent-BIN items (trailing Buy it Now block): ${permanentCount}`);
    if (skipped.length) {
        console.log(`\nSkipped ${skipped.length}:`);
        for (const s of skipped) console.log(`  - #${s.id} (${s.reason}): ${s.title}`);
    }
    if (fallbackSubcategory.length) {
        console.log(`\nNon-Pokemon products forced to "Pokémon Cards" subcategory (re-tag on Whatnot UI):`);
        for (const f of fallbackSubcategory) console.log(`  - #${f.id}: ${f.title}`);
    }
    if (roundedPrices.length) {
        console.log(`\nPrices rounded to integer (Whatnot requirement):`);
        for (const r of roundedPrices) console.log(`  - #${r.id}: $${r.from} → ${r.to} — ${r.title}`);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
