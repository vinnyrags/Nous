import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const CREDS = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.config/google/sheets-credentials.json')));
const auth = new google.auth.GoogleAuth({ credentials: CREDS, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
const sheets = google.sheets({ version: 'v4', auth });
const r = await sheets.spreadsheets.values.get({ spreadsheetId: '1erx1dUZ9YIwpg5xbXP_OFrE4i1dV97RoE7M0rsv_JkM', range: 'Singles!A2:T' });
const rows = r.data.values || [];

const VINTAGE = new Set(['Base Set','Base Set 2','Jungle','Fossil','Team Rocket','Gym Heroes','Gym Challenge']);
const hits = rows.map((row, i) => ({ row: i + 2, A: row[0], H: row[7], I: row[8], K: row[10], O: row[14] }))
                 .filter(r => VINTAGE.has(r.I));

const bySet = {};
for (const h of hits) {
  bySet[h.I] = (bySet[h.I] || 0) + 1;
}
console.log('Vintage rows in sheet by set:');
for (const [s, n] of Object.entries(bySet).sort()) console.log(`  ${s.padEnd(16)} ${n}`);
console.log(`Total vintage rows: ${hits.length}`);
console.log();
console.log('Sample with empty variant (Unlimited):');
hits.filter(h => !h.K).slice(0, 8).forEach(h => console.log(`  row ${h.row}: "${h.A}" #${h.H} ${h.I} variant="${h.K||''}" hasImage=${!!h.O}`));
