/**
 * Back up the Singles tab in the itzenzoTTV Google Sheet.
 *
 * Duplicates the Singles tab as Singles_Backup_YYYY-MM-DD so the original
 * can be restored if an enrichment/sync run goes sideways.
 *
 * Usage: node scripts/shop/backup-singles.js
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');

const CREDENTIALS_PATH = path.join(process.env.HOME, '.config/google/sheets-credentials.json');
const SPREADSHEET_ID = '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM';
const SOURCE_SHEET = 'Singles';

async function main() {
    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const source = meta.data.sheets.find((s) => s.properties.title === SOURCE_SHEET);

    if (!source) {
        console.error(`Error: source sheet "${SOURCE_SHEET}" not found.`);
        process.exit(1);
    }

    const today = new Date().toISOString().slice(0, 10);
    let backupTitle = `${SOURCE_SHEET}_Backup_${today}`;

    // If a backup for today already exists, append a numeric suffix
    const existing = meta.data.sheets.map((s) => s.properties.title);
    if (existing.includes(backupTitle)) {
        let n = 2;
        while (existing.includes(`${backupTitle}_${n}`)) n++;
        backupTitle = `${backupTitle}_${n}`;
    }

    const res = await sheets.spreadsheets.batchUpdate({
        spreadsheetId: SPREADSHEET_ID,
        requestBody: {
            requests: [
                {
                    duplicateSheet: {
                        sourceSheetId: source.properties.sheetId,
                        newSheetName: backupTitle,
                    },
                },
            ],
        },
    });

    const newId = res.data.replies[0].duplicateSheet.properties.sheetId;
    console.log(`✓ Backed up "${SOURCE_SHEET}" to "${backupTitle}" (sheetId: ${newId}).`);
}

main().catch((err) => {
    console.error('Backup failed:', err.message);
    process.exit(1);
});
