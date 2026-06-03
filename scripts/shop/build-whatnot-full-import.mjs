/**
 * Build a Whatnot bulk-import CSV containing every in-stock card + product
 * in WP. Replaces the entire Whatnot inventory in one pass — the operator
 * deletes the existing Whatnot listings before importing.
 *
 * Source: /tmp/inventory.json (exported from WP via wp eval-file).
 *
 * Card pricing (joined to the Singles sheet by Stripe product ID):
 *   - Auction Price Override (col G), when a row has one, REPLACES both
 *     prices: --auction uses it as the starting bid, and every BIN mode
 *     prices it at ceil(override × 0.95) — the override, 5% off, rounded up.
 *   - With no override, BIN modes price from the maintained BIN Price (col E:
 *     $5 floor, tiered markup, manual per-card overrides) and --auction uses
 *     the maintained Auction Price (col D) read straight from the sheet (WP's
 *     price meta can lag the sheet between syncs; sheet is the source of truth).
 *   - Red-filled sheet rows are "do not sell" and are dropped from every CSV.
 *     (SOLD rows are dark grey and already vanish via stock = 0 upstream.)
 * Named sealed products aren't in the sheet and keep their single price in
 * all modes.
 *
 * Modes:
 *   default               Every in-stock item as Buy it Now (cards at sheet
 *                         BIN price, col E), WP query order.
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
 *   --exclude-skus=id,...  Drop these WP post IDs from the output (inverse of
 *                          --skus). Applies under every mode. Supplements the
 *                          automatic red-row exclusion — for products or for
 *                          red rows whose col-S Stripe id is blank (unmatchable
 *                          by join).
 *   --post-stream-bin     Same selection as --auction (cards + named sealed,
 *                         skips permanent-BIN), Type=Buy it Now, cards at the
 *                         sheet BIN price (col E). Sorted ascending by Price.
 *                         Uploaded post-stream for unsold auction items.
 *                         Output: tmp/whatnot-post-stream-bin-import-{date}.csv
 *   --bin-show            BIN-format live show: every in-stock card as Buy it
 *                         Now priced at its EFFECTIVE AUCTION price (col G
 *                         override, else col D — NOT the col-E BIN price, no
 *                         markup/discount), every in-stock product as Buy it
 *                         Now at its normal price (permanent-BIN items ride in
 *                         the main queue, not a trailing block), PLUS the
 *                         generic quick-pick rows kept as Type=Auction. Whole
 *                         CSV sorted ascending by Price so the show flows
 *                         cheap → chase like an auction night.
 *                         Output: tmp/whatnot-bin-show-import-{date}.csv
 *
 * Shipping profile rules:
 *   card                              -> "0-1 oz"
 *   product (single booster pack)     -> "1-3 oz"
 *   product (everything else)         -> "1 lb"
 */

import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const ROOT = path.resolve(process.env.HOME, 'Projects/vinnyrags/websites');
const INVENTORY = '/tmp/inventory.json';
const today = new Date().toISOString().slice(0, 10);

// Singles sheet column map (0-indexed within A2:T):
//   D(3) Auction Price · E(4) BIN Price · G(6) Auction Price Override
//   S(18) Stripe Product ID — the join key (== WP `stripe_product_id`).
//
// Pricing source of truth:
//   • Auction starting bid = the WP/Stripe Auction Price (col D), UNLESS the
//     row has an Auction Price Override (col G) — then col G wins.
//   • Buy-it-Now = the maintained BIN Price (col E: $5 floor, tiered markup,
//     ~26 manual per-card overrides), UNLESS the row has a col-G override, in
//     which case BIN = ceil(override × 0.95) (the override, 5% off, rounded up
//     to a whole dollar).
//   • Red-filled rows are "do not sell" and drop out of every CSV. (SOLD rows
//     are dark grey and already vanish via stock = 0 in the WP export upstream.)
// We join by Stripe product ID (sheet col S == WP `stripe_product_id` meta,
// carried in inventory.json).
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');

// Populated in main() from the Singles sheet, keyed by Stripe product ID.
let AUCTION_BY_STRIPE = new Map();     // col D → float auction-price dollars
let BIN_PRICE_BY_STRIPE = new Map();   // col E → integer BIN dollars
let OVERRIDE_BY_STRIPE = new Map();    // col G → float auction-override dollars
let DO_NOT_SELL_STRIPE = new Set();    // red-filled rows — excluded everywhere
let OVERRIDE_APPLIED = 0;              // count of emitted cards priced off col G

// A row is "do not sell" when its fill is red-dominant: red clearly above both
// green and blue, with green ≈ blue. The green ≈ blue guard keeps orange/brown/
// yellow highlights (which have green ≫ blue) and the grey SOLD rows (equal
// channels) from tripping it. Robust across light-red → saturated-red shades.
function isRedFill(color) {
    if (!color) return false;
    const r = color.red ?? 0, g = color.green ?? 0, b = color.blue ?? 0;
    return r >= 0.4 && (r - g) > 0.15 && (r - b) > 0.15 && Math.abs(g - b) < 0.18;
}

async function loadSheetData() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });
    // Need cell fill colors (red-row detection) alongside values, so pull the
    // grid rather than just values: formattedValue for the data cells plus
    // effectiveFormat background color, which resolves the rendered color
    // regardless of how it was set.
    const res = await sheets.spreadsheets.get({
        spreadsheetId: SPREADSHEET_ID,
        ranges: ['Singles!A2:T'],
        includeGridData: true,
        fields: 'sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor,effectiveFormat.backgroundColorStyle)',
    });
    const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData || [];
    const auction = new Map(), bin = new Map(), override = new Map(), doNotSell = new Set();
    let redCount = 0, redNoStripe = 0;
    for (const row of rowData) {
        const cells = row.values || [];
        const text = (i) => (cells[i]?.formattedValue || '').trim();
        const num = (i) => parseFloat(text(i).replace(/[^0-9.]/g, ''));
        const stripeId = text(18);                  // col S (Stripe Product ID)
        if (!text(0) && !stripeId) continue;        // skip fully-blank trailing rows

        // Red fill on any cell across the row = do-not-sell.
        const isRed = cells.some((c) => {
            const ef = c?.effectiveFormat;
            return isRedFill(ef?.backgroundColorStyle?.rgbColor || ef?.backgroundColor);
        });
        if (isRed) {
            redCount++;
            if (stripeId) doNotSell.add(stripeId);
            else redNoStripe++;
        }

        if (!stripeId) continue;
        const aucVal = num(3);                      // col D (Auction Price)
        if (Number.isFinite(aucVal) && aucVal > 0) auction.set(stripeId, aucVal);
        const binVal = num(4);                      // col E (BIN Price)
        if (Number.isFinite(binVal) && binVal > 0) bin.set(stripeId, Math.round(binVal));
        const ovrVal = num(6);                       // col G (Auction Price Override)
        if (Number.isFinite(ovrVal) && ovrVal > 0) override.set(stripeId, ovrVal);
    }
    return { auction, bin, override, doNotSell, redCount, redNoStripe };
}

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
// BIN-format live show: cards as Buy it Now at their effective AUCTION price
// (col G override else col D), products as BIN at their normal price, generic
// quick-picks kept as real auctions. See the mode docs at the top of the file.
const IS_BIN_SHOW = process.argv.includes('--bin-show');
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

// --exclude-skus=id1,id2,... drops those WP post IDs from the output —
// the inverse of --skus. Used to omit cards the operator has flagged
// "do not sell" (e.g. red-highlighted rows in the Singles sheet) from an
// otherwise-complete BIN/auction CSV. Applies under every mode.
const EXCLUDE_ARG = process.argv.find((a) => a.startsWith('--exclude-skus='));
const EXCLUDE_SKUS = EXCLUDE_ARG
    ? new Set(EXCLUDE_ARG.split('=')[1].split(',').map((s) => parseInt(s.trim(), 10)).filter(Number.isFinite))
    : null;

let outSuffix = 'full';
if (IS_AUCTION) outSuffix = 'auction';
else if (IS_PERMANENT_BIN_ONLY) outSuffix = 'permanent-bin';
else if (IS_POST_STREAM_BIN) outSuffix = 'post-stream-bin';
else if (IS_BIN_SHOW) outSuffix = 'bin-show';
if (ONLY_SKUS) outSuffix += '-subset';
const OUT_CSV = path.join(ROOT, `tmp/whatnot-${outSuffix}-import-${today}.csv`);

// Tiered BIN markup over Auction Price. Matches the formula used to
// populate column E (BIN Price) in the Singles sheet, so a card with no
// sheet BIN lookup still gets a sane BIN. Fallback only — used when the
// sheet lookup misses; named sealed products use their single price unchanged.
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
// per-card listing. Included by --auction AND --bin-show (always Type=Auction,
// even in the otherwise-BIN show CSV); they sort in by Price with the rest.
// Images are branded $1–$35 graphics hosted in WP media (uploads/2026/05).
const GENERIC_AUCTION_ROWS = [
    {
        price: 1,
        sku: 'QUICK-1',
        title: 'itzenzoTTV $1 Quick Auction — Pokémon Single',
        image: 'https://vincentragosta.io/wp-content/uploads/2026/05/quick-auction-1.png',
    },
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
    {
        price: 30,
        sku: 'QUICK-30',
        title: 'itzenzoTTV $30 Quick Auction — Pokémon Single',
        image: 'https://vincentragosta.io/wp-content/uploads/2026/05/quick-auction-30.png',
    },
    {
        price: 35,
        sku: 'QUICK-35',
        title: 'itzenzoTTV $35 Quick Auction — Pokémon Single',
        image: 'https://vincentragosta.io/wp-content/uploads/2026/05/quick-auction-35.png',
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
    // Pricing (joined to the Singles sheet by Stripe product ID):
    //   Auction Price Override (col G), when set, REPLACES both prices:
    //     --auction → starting bid = the override.
    //     BIN modes → BIN = ceil(override × 0.95) (override, 5% off, whole $).
    //   With no override:
    //     --auction → the maintained Auction Price (col D) from the SHEET — the
    //                 source of truth. WP's price meta can lag the sheet between
    //                 syncs, so we read the sheet directly and fall back to WP
    //                 price only when the card isn't in the sheet.
    //     BIN modes → the sheet's maintained BIN Price (col E). Falls back to
    //                 the tiered formula over the auction price when the sheet
    //                 lookup misses (card not in sheet / blank stripe id /
    //                 sheet unavailable) so a BIN never ships at a sub-$5 bid.
    const sid = (m.stripe_product_id || '').trim();
    const override = sid ? OVERRIDE_BY_STRIPE.get(sid) : null;
    const sheetAuction = sid ? AUCTION_BY_STRIPE.get(sid) : null;
    const auctionBase = override ?? sheetAuction ?? m.price;
    if (override) OVERRIDE_APPLIED++;
    let priceCell;
    if (IS_AUCTION || IS_BIN_SHOW) {
        // --bin-show lists the card as Buy it Now at the EXACT effective
        // auction price (no col-E lookup, no ×0.95 discount) — same price
        // resolution as --auction, only the listing Type differs.
        priceCell = priceFromMeta(auctionBase);
    } else if (override) {
        priceCell = String(Math.max(1, Math.ceil(override * 0.95)));
    } else {
        const fromSheet = sid ? BIN_PRICE_BY_STRIPE.get(sid) : null;
        if (fromSheet) {
            priceCell = String(fromSheet);
        } else {
            const auction = priceFromMeta(auctionBase);
            priceCell = auction ? String(tieredBinFromAuction(parseInt(auction, 10))) : '';
        }
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

    // Pull the Singles sheet up front for EVERY mode now: it carries the BIN
    // prices (col E), the Auction Price Overrides (col G, which apply to both
    // auction and BIN), and the red "do not sell" rows. A sheet/credentials
    // failure is non-fatal — BIN falls back to the tiered formula, and
    // overrides + red-row exclusion simply don't apply (use --exclude-skus).
    try {
        const sheet = await loadSheetData();
        AUCTION_BY_STRIPE = sheet.auction;
        BIN_PRICE_BY_STRIPE = sheet.bin;
        OVERRIDE_BY_STRIPE = sheet.override;
        DO_NOT_SELL_STRIPE = sheet.doNotSell;
        console.log(`Singles sheet: ${sheet.auction.size} auction prices (col D), ${sheet.bin.size} BIN prices (col E), ${sheet.override.size} auction overrides (col G), ${sheet.doNotSell.size} red "do not sell" rows.`);
        if (sheet.redNoStripe) {
            console.warn(`  ⚠ ${sheet.redNoStripe} red row(s) have no Stripe Product ID (col S) — can't match them to inventory; drop by WP id via --exclude-skus if they're live.`);
        }
    } catch (e) {
        console.warn(`⚠ Could not load the Singles sheet (${e.message}); BIN falls back to the tiered formula, no overrides, no red-row exclusion.`);
    }

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
        // --exclude-skus: manual drop list by WP id. Supplements the automatic
        // red-row exclusion below — use it for products or for red rows whose
        // Stripe id (col S) is blank so they can't be matched by join.
        if (EXCLUDE_SKUS && EXCLUDE_SKUS.has(item.id)) {
            skipped.push({ id: item.id, title: item.title, reason: 'excluded (--exclude-skus)' });
            continue;
        }
        // Red "do not sell" rows in the Singles sheet (matched by Stripe
        // product ID) drop out of every CSV — auction and BIN alike.
        const itemStripeId = ((item.meta || {}).stripe_product_id || '').trim();
        if (itemStripeId && DO_NOT_SELL_STRIPE.has(itemStripeId)) {
            skipped.push({ id: item.id, title: item.title, reason: 'do not sell (red row in sheet)' });
            continue;
        }
        // Never list a sold-out item. The WP inventory export already filters
        // stock < 1, but guard here too so the builder stays correct against a
        // stale or differently-produced inventory.json. An absent/blank
        // stock_quantity is treated as in-stock (legacy rows default to 1);
        // only an explicit 0/negative is dropped.
        const stockRaw = (item.meta || {}).stock_quantity;
        if (stockRaw !== '' && stockRaw != null && parseInt(stockRaw, 10) < 1) {
            skipped.push({ id: item.id, title: item.title, reason: `out of stock (${stockRaw})` });
            continue;
        }
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

    // Generic quick-pick filler auctions — auction and bin-show CSVs. They
    // stay Type=Auction even in the BIN show (the operator still fires them
    // off as live auctions between BIN sales). Appended before the sort so
    // they slot into the ascending-price queue naturally.
    let genericCount = 0;
    if ((IS_AUCTION || IS_BIN_SHOW) && !ONLY_SKUS) {
        for (const g of GENERIC_AUCTION_ROWS) {
            builtRows.push(buildGenericAuctionRow(g));
            genericCount++;
        }
    }

    // Auction shows run cheap → expensive so the chat warms up on $1 commons
    // and the energy climaxes on chase cards. Post-stream BIN and the BIN
    // show use the same ascending sort for consistency — the BIN show flows
    // like an auction night, just with fixed prices. Default BIN mode keeps
    // WP order.
    if (IS_AUCTION || IS_POST_STREAM_BIN || IS_BIN_SHOW) {
        builtRows.sort((a, b) => Number(a.Price) - Number(b.Price));
    }

    // Permanent-BIN block (auction CSV only) trails the sorted auction queue,
    // sorted by price among themselves, kept as Buy it Now.
    permanentRows.sort((a, b) => Number(a.Price) - Number(b.Price));
    const finalRows = [...builtRows, ...permanentRows];

    const rows = [HEADER, ...finalRows.map(r => HEADER.map(h => r[h] ?? ''))];
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    fs.writeFileSync(OUT_CSV, csv + '\n');

    const typeLabel = IS_POST_STREAM_BIN ? 'Buy it Now (BIN markup applied)'
        : IS_BIN_SHOW ? 'Buy it Now @ effective auction price (+ quick-picks as Auction)'
        : LISTING_TYPE;
    const sortNote = (IS_AUCTION || IS_POST_STREAM_BIN || IS_BIN_SHOW) ? ', sorted ascending by Price' : '';
    console.log(`Wrote ${rows.length - 1} rows to ${OUT_CSV} (Type=${typeLabel}${sortNote})`);
    console.log(`  cards:    ${cardCount}`);
    console.log(`  products: ${productCount}`);
    if (OVERRIDE_APPLIED) {
        console.log(`  auction-price overrides applied (col G): ${OVERRIDE_APPLIED}`);
    }
    const redDropped = skipped.filter((s) => s.reason.startsWith('do not sell')).length;
    if (redDropped) {
        console.log(`  red "do not sell" rows excluded: ${redDropped} (listed under Skipped below)`);
    }
    if (ONLY_SKUS) {
        const emittedIds = new Set(finalRows.map((r) => parseInt(r.SKU, 10)));
        const missing = [...ONLY_SKUS].filter((id) => !emittedIds.has(id));
        console.log(`  subset filter: ${emittedIds.size}/${ONLY_SKUS.size} requested SKUs emitted`);
        if (missing.length) console.log(`  ⚠ requested but NOT emitted (out of stock / no image / not in inventory): ${missing.join(', ')}`);
    }
    if (genericCount) console.log(`  generic quick-pick auctions: ${genericCount}`);
    if (permanentCount) console.log(`  permanent-BIN items (trailing Buy it Now block): ${permanentCount}`);
    if (EXCLUDE_SKUS) {
        const dropped = skipped.filter((s) => s.reason.startsWith('excluded')).length;
        const notHit = [...EXCLUDE_SKUS].filter((id) => !inv.some((x) => x.id === id));
        console.log(`  excluded (--exclude-skus): ${dropped}/${EXCLUDE_SKUS.size} requested`);
        if (notHit.length) console.log(`  note: ${notHit.length} excluded SKU(s) weren't in inventory anyway (out of stock): ${notHit.join(', ')}`);
    }
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
