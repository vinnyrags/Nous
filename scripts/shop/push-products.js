/**
 * Push Products to Stripe from Google Sheets
 *
 * Reads the product catalog from Google Sheets and creates/updates
 * Stripe products with prices and metadata.
 *
 * Usage: node scripts/shop/push-products.js
 *
 * Columns: Name | Price | Category | Stock | Cost | Sale Price | Image URL | Language
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const Stripe = require('stripe');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Products';

// Stripe key from environment or wp-config-env.php
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || (() => {
    const envFile = path.join(__dirname, '../../wp-config-env.php');
    if (fs.existsSync(envFile)) {
        const content = fs.readFileSync(envFile, 'utf8');
        const match = content.match(/define\('STRIPE_SECRET_KEY',\s*'([^']+)'\)/);
        return match ? match[1] : '';
    }
    return '';
})();

if (!STRIPE_KEY) {
    console.error('Error: STRIPE_SECRET_KEY not found.');
    process.exit(1);
}

const stripe = new Stripe(STRIPE_KEY);

const args = process.argv.slice(2);
const CLEAN = args.includes('--clean');
const SHEET_OVERRIDE = args.find((a) => a.startsWith('--sheet='));
const ACTIVE_SHEET = SHEET_OVERRIDE ? SHEET_OVERRIDE.split('=')[1] : SHEET_NAME;

/**
 * Deactivate all existing Stripe products.
 */
async function cleanProducts() {
    console.log('Cleaning: deactivating all existing Stripe products...');
    let hasMore = true;
    let startingAfter = null;
    let count = 0;

    while (hasMore) {
        const params = { limit: 100, active: true };
        if (startingAfter) params.starting_after = startingAfter;

        const products = await stripe.products.list(params);

        for (const product of products.data) {
            await stripe.products.update(product.id, { active: false });
            console.log(`  Deactivated: ${product.name}`);
            count++;
            startingAfter = product.id;
        }

        hasMore = products.has_more;
    }

    console.log(`  ${count} product(s) deactivated.\n`);
}

async function main() {
    if (CLEAN) {
        await cleanProducts();
    }

    // Read Google Sheet
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ACTIVE_SHEET}!A2:H`,
    });

    const rows = res.data.values || [];

    if (!rows.length) {
        console.log('No products found in the sheet.');
        return;
    }

    console.log(`Found ${rows.length} product(s) in Google Sheets.\n`);

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of rows) {
        const [name, priceStr, category, stockStr, costStr, salePriceStr, imageUrl, language] = row;

        if (!name || !priceStr) {
            console.log(`  Skipping row — missing name or price`);
            skipped++;
            continue;
        }

        const priceAmount = Math.round(parseFloat(priceStr) * 100);
        if (isNaN(priceAmount) || priceAmount <= 0) {
            console.log(`  Skipping ${name} — invalid price: ${priceStr}`);
            skipped++;
            continue;
        }

        // Build metadata
        const metadata = {};
        if (category) metadata.category = category.toLowerCase().trim();
        if (stockStr) metadata.stock = stockStr.trim();
        if (costStr) metadata.cost = costStr.trim();
        if (language) metadata.language = language.trim();

        // Check if product already exists in Stripe (by name)
        const existing = await stripe.products.search({
            query: `name~"${name.replace(/"/g, '\\"')}"`,
        });

        const existingProduct = existing.data.find(
            (p) => p.name.toLowerCase() === name.toLowerCase()
        );

        let product;
        let defaultPriceId;

        if (existingProduct) {
            // Update existing product
            const updateData = { metadata, active: true };
            if (imageUrl) updateData.images = [imageUrl.trim()];

            product = await stripe.products.update(existingProduct.id, updateData);

            // Check if default price matches
            const currentPrice = existingProduct.default_price;
            if (currentPrice) {
                const priceObj = typeof currentPrice === 'string'
                    ? await stripe.prices.retrieve(currentPrice)
                    : currentPrice;

                if (priceObj.unit_amount === priceAmount) {
                    defaultPriceId = priceObj.id;
                } else {
                    // Price changed — create new price and set as default
                    const newPrice = await stripe.prices.create({
                        product: product.id,
                        unit_amount: priceAmount,
                        currency: 'usd',
                    });
                    await stripe.products.update(product.id, {
                        default_price: newPrice.id,
                    });
                    defaultPriceId = newPrice.id;
                    console.log(`    Price updated: $${(priceAmount / 100).toFixed(2)}`);
                }
            }

            const info = [category, language, stockStr ? `stock:${stockStr}` : ''].filter(Boolean);
            console.log(`  Updated: ${name}${info.length ? ` [${info.join(', ')}]` : ''}`);
            updated++;
        } else {
            // Create new product
            const createData = {
                name,
                metadata,
                default_price_data: {
                    unit_amount: priceAmount,
                    currency: 'usd',
                },
            };
            if (imageUrl) createData.images = [imageUrl.trim()];

            product = await stripe.products.create(createData);
            defaultPriceId = product.default_price;

            const info = [category, language, stockStr ? `stock:${stockStr}` : ''].filter(Boolean);
            console.log(`  Created: ${name} ($${(priceAmount / 100).toFixed(2)})${info.length ? ` [${info.join(', ')}]` : ''}`);
            created++;
        }

        // Handle sale price
        const salePriceAmount = salePriceStr ? Math.round(parseFloat(salePriceStr) * 100) : 0;

        if (salePriceAmount > 0) {
            // Check if a sale price already exists with this amount
            const prices = await stripe.prices.list({
                product: product.id,
                active: true,
                limit: 10,
            });

            let salePriceObj = prices.data.find(
                (p) => p.unit_amount === salePriceAmount && p.id !== defaultPriceId
            );

            if (!salePriceObj) {
                salePriceObj = await stripe.prices.create({
                    product: product.id,
                    unit_amount: salePriceAmount,
                    currency: 'usd',
                });
                console.log(`    Sale price created: $${(salePriceAmount / 100).toFixed(2)}`);
            }

            // Set sale_price_id metadata
            await stripe.products.update(product.id, {
                metadata: { ...metadata, sale_price_id: salePriceObj.id },
            });
            console.log(`    Sale active: $${(salePriceAmount / 100).toFixed(2)}`);
        } else if (existingProduct) {
            // No sale price in sheet — clear sale_price_id if it was set
            const currentMeta = existingProduct.metadata || {};
            if (currentMeta.sale_price_id) {
                await stripe.products.update(product.id, {
                    metadata: { ...metadata, sale_price_id: '' },
                });
                console.log(`    Sale ended`);
            }
        }
    }

    console.log(`\nDone: ${created} created, ${updated} updated, ${skipped} skipped.`);
}

main().catch(console.error);
