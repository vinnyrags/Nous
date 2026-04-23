/**
 * Push Card Singles to Stripe from Google Sheets
 *
 * Reads the Singles tab from Google Sheets and creates/updates Stripe
 * products with card-specific metadata. Writes the Stripe Product ID
 * back to column Q so re-runs are idempotent.
 *
 * Every product created here is tagged with metadata.type = "card" so
 * pull-cards.php claims it and pull-products.php skips it.
 *
 * Usage: node scripts/shop/push-cards.js [--clean] [--sheet=Singles]
 *
 * Columns: A Name | B Price | C Category | D Stock | E Cost | F Sale Price
 *          G Image URL | H Language | I Game | J Set Name | K Set Code
 *          L Set Number | M Rarity | N Variant | O Release Year | P Artist
 *          Q Stripe Product ID (written back) | R Notes
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const Stripe = require('stripe');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Singles';

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
 * Deactivate all existing cards (metadata.type === "card") in Stripe.
 */
async function cleanCards() {
    console.log('Cleaning: deactivating all existing Stripe card products...');
    let hasMore = true;
    let startingAfter = null;
    let count = 0;

    while (hasMore) {
        const params = { limit: 100, active: true };
        if (startingAfter) params.starting_after = startingAfter;

        const products = await stripe.products.list(params);

        for (const product of products.data) {
            if ((product.metadata || {}).type === 'card') {
                await stripe.products.update(product.id, { active: false });
                console.log(`  Deactivated: ${product.name}`);
                count++;
            }
            startingAfter = product.id;
        }

        hasMore = products.has_more;
    }

    console.log(`  ${count} card(s) deactivated.\n`);
}

async function main() {
    if (CLEAN) {
        await cleanCards();
    }

    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const res = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${ACTIVE_SHEET}!A2:R`,
    });

    const rows = res.data.values || [];

    if (!rows.length) {
        console.log('No cards found in the sheet.');
        return;
    }

    console.log(`Found ${rows.length} card(s) in Google Sheets.\n`);

    const writebacks = []; // [{ rowIndex, productId }]

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const sheetRowNumber = i + 2; // rows start at row 2 in the sheet

        const [
            name, priceStr, category, stockStr, costStr, salePriceStr,
            imageUrl, language, game, setName, setCode, cardNumber,
            rarity, variant, releaseYear, artist, existingProductId, _notes,
        ] = row;

        if (!name || !priceStr) {
            console.log(`  Skipping row ${sheetRowNumber} — missing name or price`);
            skipped++;
            continue;
        }

        const priceAmount = Math.round(parseFloat(priceStr) * 100);
        if (isNaN(priceAmount) || priceAmount <= 0) {
            console.log(`  Skipping ${name} — invalid price: ${priceStr}`);
            skipped++;
            continue;
        }

        const metadata = { type: 'card' };
        if (category) metadata.category = category.toLowerCase().trim();
        if (stockStr) metadata.stock = stockStr.trim();
        if (costStr) metadata.cost = costStr.trim();
        if (language) metadata.language = language.trim();
        if (game) metadata.game = game.trim().toLowerCase();
        if (setName) metadata.set_name = setName.trim();
        if (setCode) metadata.set_code = setCode.trim();
        if (cardNumber) metadata.card_number = cardNumber.trim();
        if (rarity) metadata.rarity = rarity.trim().toLowerCase().replace(/\s+/g, '-');
        if (variant) metadata.variant = variant.trim().toLowerCase().replace(/\s+/g, '-');
        if (releaseYear) metadata.release_year = String(releaseYear).trim();
        if (artist) metadata.artist = artist.trim();
        if (imageUrl) metadata.image_url = imageUrl.trim();
        metadata.card_name = name.trim();

        // Find existing product — prefer the stored ID from column Q, fall back to name search
        let existingProduct = null;

        if (existingProductId) {
            try {
                const fetched = await stripe.products.retrieve(existingProductId.trim());
                if (fetched && !fetched.deleted) {
                    existingProduct = fetched;
                }
            } catch (e) {
                console.log(`    Warning: Stripe product ${existingProductId} not found, creating new.`);
            }
        }

        if (!existingProduct) {
            const search = await stripe.products.search({
                query: `name~"${name.replace(/"/g, '\\"')}" AND metadata['type']:'card'`,
            });
            existingProduct = search.data.find(
                (p) => p.name.toLowerCase() === name.toLowerCase()
            ) || null;
        }

        let product;
        let defaultPriceId;

        if (existingProduct) {
            const updateData = { metadata, active: true };
            if (imageUrl) updateData.images = [imageUrl.trim()];

            product = await stripe.products.update(existingProduct.id, updateData);

            const currentPrice = existingProduct.default_price;
            if (currentPrice) {
                const priceObj = typeof currentPrice === 'string'
                    ? await stripe.prices.retrieve(currentPrice)
                    : currentPrice;

                if (priceObj.unit_amount === priceAmount) {
                    defaultPriceId = priceObj.id;
                } else {
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

            const info = [setName, cardNumber, rarity, stockStr ? `stock:${stockStr}` : ''].filter(Boolean);
            console.log(`  Updated: ${name}${info.length ? ` [${info.join(', ')}]` : ''}`);
            updated++;
        } else {
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
            defaultPriceId = typeof product.default_price === 'string'
                ? product.default_price
                : product.default_price?.id;

            const info = [setName, cardNumber, rarity, stockStr ? `stock:${stockStr}` : ''].filter(Boolean);
            console.log(`  Created: ${name} ($${(priceAmount / 100).toFixed(2)})${info.length ? ` [${info.join(', ')}]` : ''}`);
            created++;
        }

        // Remember to write the product ID back to the sheet if it changed
        if (product && (!existingProductId || existingProductId.trim() !== product.id)) {
            writebacks.push({ rowIndex: sheetRowNumber, productId: product.id });
        }

        // Handle sale price
        const salePriceAmount = salePriceStr ? Math.round(parseFloat(salePriceStr) * 100) : 0;

        if (salePriceAmount > 0) {
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

            await stripe.products.update(product.id, {
                metadata: { ...metadata, sale_price_id: salePriceObj.id },
            });
            console.log(`    Sale active: $${(salePriceAmount / 100).toFixed(2)}`);
        } else if (existingProduct) {
            const currentMeta = existingProduct.metadata || {};
            if (currentMeta.sale_price_id) {
                await stripe.products.update(product.id, {
                    metadata: { ...metadata, sale_price_id: '' },
                });
                console.log(`    Sale ended`);
            }
        }
    }

    // Write Stripe Product IDs back to column Q
    if (writebacks.length) {
        console.log(`\nWriting ${writebacks.length} Stripe Product ID(s) back to the sheet...`);
        const data = writebacks.map(({ rowIndex, productId }) => ({
            range: `${ACTIVE_SHEET}!Q${rowIndex}`,
            values: [[productId]],
        }));
        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                valueInputOption: 'RAW',
                data,
            },
        });
    }

    console.log(`\nDone: ${created} created, ${updated} updated, ${skipped} skipped.`);
}

main().catch(console.error);
