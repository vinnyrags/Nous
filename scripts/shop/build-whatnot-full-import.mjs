/**
 * Build a Whatnot bulk-import CSV containing every in-stock card + product
 * in WP. Replaces the entire Whatnot inventory in one pass — the operator
 * deletes the existing Whatnot listings before importing.
 *
 * Source: /tmp/inventory.json (exported from WP via wp eval-file).
 *
 * Shipping profile rules:
 *   card                              -> "0-1 oz"
 *   product (single booster pack)     -> "1-3 oz"
 *   product (everything else)         -> "1 lb"
 *
 * Output: tmp/whatnot-full-import-{date}.csv
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.env.HOME, 'Projects/vinnyrags/websites');
const INVENTORY = '/tmp/inventory.json';
const today = new Date().toISOString().slice(0, 10);
const OUT_CSV = path.join(ROOT, `tmp/whatnot-full-import-${today}.csv`);

// Product IDs that get the lighter "1-3 oz" profile (single booster packs).
// Everything else in post_type=product gets "1 lb".
const LIGHT_PRODUCT_IDS = new Set([
    4911, // Pokemon Astral Radiance Booster Pack
    4909, // Pokemon Lost Origin Booster Pack
]);

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
    // Stored as "$15.00" — strip leading "$" and trailing ".00" if int.
    if (!price) return '';
    const cleaned = String(price).replace(/[^0-9.]/g, '');
    const num = parseFloat(cleaned);
    if (!Number.isFinite(num)) return '';
    return num % 1 === 0 ? String(num) : num.toFixed(2);
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
    return {
        Category: 'Trading Card Games',
        'Sub Category': 'Pokémon Cards',
        Title: title,
        Description: desc,
        Quantity: m.stock_quantity || '1',
        Type: 'Buy it Now',
        Price: priceFromMeta(m.price),
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
    // Most products are Pokémon-related but a few are Weiss Schwarz —
    // keep sub-category as "Pokémon Cards" when "Pokemon" appears in
    // the title, fall back to a generic value otherwise.
    const isPokemon = /pok[eé]mon/i.test(title);
    const shippingProfile = LIGHT_PRODUCT_IDS.has(item.id) ? '1-3 oz' : '1 lb';
    const desc = (
        `${title}. ` +
        `Sealed product, factory condition. ` +
        `See images for full visual assessment. ` +
        `Smoke-free environment, packed within 1-2 business days of payment.`
    );
    return {
        Category: 'Trading Card Games',
        'Sub Category': isPokemon ? 'Pokémon Cards' : 'Other TCG Products',
        Title: title,
        Description: desc,
        Quantity: m.stock_quantity || '1',
        Type: 'Buy it Now',
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
    const rows = [HEADER];
    let cardCount = 0, productCount = 0, skipped = [];

    for (const item of inv) {
        if (!item.image) {
            skipped.push({ id: item.id, title: item.title, reason: 'no image' });
            continue;
        }
        const row = item.post_type === 'card'
            ? buildCardRow(item)
            : buildProductRow(item);
        if (!row.Price) {
            skipped.push({ id: item.id, title: item.title, reason: 'no price' });
            continue;
        }
        rows.push(HEADER.map(h => row[h] ?? ''));
        if (item.post_type === 'card') cardCount++;
        else productCount++;
    }

    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\n');
    fs.writeFileSync(OUT_CSV, csv + '\n');

    console.log(`Wrote ${rows.length - 1} rows to ${OUT_CSV}`);
    console.log(`  cards:    ${cardCount}`);
    console.log(`  products: ${productCount}`);
    if (skipped.length) {
        console.log(`\nSkipped ${skipped.length}:`);
        for (const s of skipped) console.log(`  - #${s.id} (${s.reason}): ${s.title}`);
    }
}

main().catch(e => { console.error(e); process.exit(1); });
