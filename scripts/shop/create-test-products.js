/**
 * Create a "Test Products" sheet with 30 sample products.
 *
 * Usage: node scripts/shop/create-test-products.js
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SHEET_NAME = 'Test Products';

const HEADERS = ['Name', 'Price', 'Category', 'Stock', 'Cost', 'Sale Price', 'Image URL', 'Language'];

const TEST_PRODUCTS = [
    // Pokemon (10 products)
    ['Prismatic Evolutions Booster Box', '149.99', 'pokemon', '45', '130.00', '', '', 'English'],
    ['Scarlet & Violet 151 Booster Box', '139.99', 'pokemon', '30', '115.00', '119.99', '', 'Japanese'],
    ['Obsidian Flames Elite Trainer Box', '44.99', 'pokemon', '60', '35.00', '', '', 'English'],
    ['Paldea Evolved Booster Box', '119.99', 'pokemon', '25', '100.00', '', '', 'Japanese'],
    ['Crown Zenith Elite Trainer Box', '54.99', 'pokemon', '15', '42.00', '44.99', '', 'English'],
    ['Temporal Forces Booster Box', '124.99', 'pokemon', '35', '105.00', '', '', 'Japanese'],
    ['Twilight Masquerade Booster Box', '129.99', 'pokemon', '20', '110.00', '109.99', '', 'English'],
    ['Pokemon TCG Pocket Sleeves (65ct)', '9.99', 'pokemon', '100', '5.00', '', '', ''],
    ['Pikachu VMAX Playmat', '24.99', 'pokemon', '40', '12.00', '', '', ''],
    ['Charizard Deck Box', '14.99', 'pokemon', '50', '7.00', '11.99', '', ''],

    // Weiss Schwarz / Anime (12 products)
    ['Weiss Schwarz: Hololive Vol. 2 Booster Box', '69.99', 'anime', '20', '55.00', '', '', 'Japanese'],
    ['Weiss Schwarz: Spy x Family Booster Box', '64.99', 'anime', '18', '50.00', '54.99', '', 'Japanese'],
    ['Weiss Schwarz: Chainsaw Man Booster Box', '74.99', 'anime', '12', '60.00', '', '', 'Japanese'],
    ['Weiss Schwarz: Mushoku Tensei Booster Box', '59.99', 'anime', '22', '45.00', '', '', 'Japanese'],
    ['Weiss Schwarz: Oshi no Ko Booster Box', '79.99', 'anime', '8', '65.00', '69.99', '', 'Japanese'],
    ['Weiss Schwarz: Jujutsu Kaisen Booster Box', '64.99', 'anime', '15', '50.00', '', '', 'Japanese'],
    ['Weiss Schwarz: Re:Zero Trial Deck', '19.99', 'anime', '30', '12.00', '', '', 'Japanese'],
    ['Weiss Schwarz: Bocchi the Rock Booster Box', '69.99', 'anime', '10', '55.00', '59.99', '', 'Japanese'],
    ['Tokyo Revengers Vol 2 Booster Box', '119.00', 'anime', '10', '90.00', '99.00', '', 'Japanese'],
    ['Anime Card Sleeves - Demon Slayer (60ct)', '11.99', 'anime', '80', '6.00', '', '', ''],
    ['Attack on Titan Playmat', '29.99', 'anime', '25', '14.00', '', '', ''],
    ['Jujutsu Kaisen Deck Box', '16.99', 'anime', '35', '8.00', '', '', ''],

    // Mature / Goddess Story (8 products)
    ['Goddess Story 5M01 Booster Box', '45.00', 'mature', '20', '28.00', '', '', 'Chinese'],
    ['Goddess Story 5M02 Booster Box', '45.00', 'mature', '20', '28.00', '39.99', '', 'Chinese'],
    ['Goddess Story 5M03 Booster Box', '49.99', 'mature', '15', '30.00', '', '', 'Chinese'],
    ['Goddess Story 5M04 Booster Box', '49.99', 'mature', '18', '30.00', '42.99', '', 'Chinese'],
    ['Goddess Story 5M05 Booster Box', '54.99', 'mature', '12', '35.00', '', '', 'Chinese'],
    ['Goddess Story 5M06 Booster Box', '54.99', 'mature', '10', '35.00', '', '', 'Chinese'],
    ['Goddess Story 5M07 Booster Box', '59.99', 'mature', '8', '38.00', '49.99', '', 'Chinese'],
    ['Goddess Story 5M08 Booster Box', '59.99', 'mature', '5', '38.00', '', '', 'Chinese'],
];

async function main() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    // Check if sheet already exists
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const exists = spreadsheet.data.sheets.some((s) => s.properties.title === SHEET_NAME);

    if (!exists) {
        // Create the sheet tab
        await sheets.spreadsheets.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                requests: [
                    {
                        addSheet: {
                            properties: { title: SHEET_NAME },
                        },
                    },
                ],
            },
        });
    }

    // Get the new sheet ID
    const updated = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const sheetId = updated.data.sheets.find((s) => s.properties.title === SHEET_NAME).properties.sheetId;

    // Write headers + data
    const allRows = [HEADERS, ...TEST_PRODUCTS];
    await sheets.spreadsheets.values.update({
        spreadsheetId: SPREADSHEET_ID,
        range: `${SHEET_NAME}!A1:H${allRows.length}`,
        valueInputOption: 'RAW',
        requestBody: { values: allRows },
    });

    // Format headers
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [
                {
                    repeatCell: {
                        range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
                        cell: {
                            userEnteredFormat: {
                                textFormat: { bold: true },
                                backgroundColor: { red: 0.9, green: 0.9, blue: 0.9 },
                            },
                        },
                        fields: 'userEnteredFormat(textFormat,backgroundColor)',
                    },
                },
                {
                    updateSheetProperties: {
                        properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
                        fields: 'gridProperties.frozenRowCount',
                    },
                },
                {
                    autoResizeDimensions: {
                        dimensions: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: HEADERS.length },
                    },
                },
            ],
        },
    });

    console.log(`Done — "${SHEET_NAME}" created with ${TEST_PRODUCTS.length} products.`);
    console.log(`  Pokemon: 10 | Anime/Weiss Schwarz: 12 | Mature/Goddess Story: 8`);
    console.log(`  On sale: ${TEST_PRODUCTS.filter((p) => p[5]).length} products`);
}

main().catch(console.error);
