#!/usr/bin/env node
/**
 * One-shot remediation for the 2026-05-09 card-image collision incident.
 *
 * The bug: on 2026-05-09 a bulk-upload of card images via WP Admin
 * raced on WordPress's `wp_unique_filename`. N parallel workers each
 * picked the same "next free" filename, all wrote to that single path
 * (overwriting each other), and all created attachment records
 * pointing at it. Result: 47 published cards on the storefront were
 * showing the wrong image because their `_thumbnail_id` pointed at an
 * attachment whose underlying file bytes were whichever card uploaded
 * last in the race.
 *
 * Image bytes for the "losers" can't be recovered from disk — they
 * were overwritten. But the image SOURCE survived: pokemontcg.io
 * still serves the canonical image for every card via its public API,
 * and `enrich-singles.js` already proved the matching path works
 * (name + number + set.name). This script:
 *
 *   1. Reads tmp/card-image-collisions-2026-05-18.csv (the audit
 *      generated when the bug was found).
 *   2. For each affected card, parses {name, set, number} from the WP
 *      title and queries pokemontcg.io for the canonical image URL.
 *   3. Downloads the image.
 *   4. Uploads to WP via `/wp-json/wp/v2/media` with a unique-by-
 *      construction filename (also defended by the
 *      CardAttachmentUniqueFilename hook).
 *   5. Repoints the card's `featured_media` to the new attachment.
 *
 * The old (collision-sharing) attachment is left orphaned — it can be
 * cleaned up later via `wp_post_delete` once we're sure no other card
 * is depending on it. Safer to leak the row than to delete one that
 * a still-correct card was secretly relying on.
 *
 * Modes:
 *   --apply         actually do writes (default is dry-run preview)
 *   --limit=N       process only the first N rows (testing)
 *   --card-id=N     process only the single card with this WP post id
 *   --audit-csv=P   override the path to the audit CSV
 *
 * Env (required when --apply is passed):
 *   WP_REMEDIATE_USER          WP username (an admin user)
 *   WP_REMEDIATE_APP_PASSWORD  WP Application Password — create at
 *                              WP Admin → Users → Profile →
 *                              Application Passwords. NOT your login
 *                              password.
 *   WP_BASE_URL                defaults to https://vincentragosta.io
 *   POKEMON_TCG_API_KEY        optional; lifts rate limits
 *
 * Usage:
 *   # Preview (safe, no writes)
 *   node scripts/shop/remediate-card-image-collisions.mjs
 *
 *   # Preview a single card
 *   node scripts/shop/remediate-card-image-collisions.mjs --card-id=6014
 *
 *   # Run a smoke test against just one card
 *   WP_REMEDIATE_USER=... WP_REMEDIATE_APP_PASSWORD=... \
 *     node scripts/shop/remediate-card-image-collisions.mjs --card-id=6014 --apply
 *
 *   # Commit the full batch
 *   WP_REMEDIATE_USER=... WP_REMEDIATE_APP_PASSWORD=... \
 *     node scripts/shop/remediate-card-image-collisions.mjs --apply
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// --- CLI ---------------------------------------------------------------

const APPLY = process.argv.includes('--apply');
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = LIMIT_ARG ? parseInt(LIMIT_ARG.split('=')[1], 10) : Infinity;
const CARD_ID_ARG = process.argv.find((a) => a.startsWith('--card-id='));
const ONLY_CARD_ID = CARD_ID_ARG ? parseInt(CARD_ID_ARG.split('=')[1], 10) : null;
const AUDIT_CSV_ARG = process.argv.find((a) => a.startsWith('--audit-csv='));
const AUDIT_CSV = AUDIT_CSV_ARG
    ? AUDIT_CSV_ARG.split('=')[1]
    : path.join(
        __dirname,
        '../../../vincentragosta.io/tmp/card-image-collisions-2026-05-18.csv',
    );

// --- Env ---------------------------------------------------------------

const POKEMON_TCG_API = 'https://api.pokemontcg.io/v2';
const POKEMON_TCG_API_KEY = process.env.POKEMON_TCG_API_KEY || '';
// pokemontcg.io free tier returns 404 (not 429) when rate-limited and
// starts kicking in around request #20 at 400ms cadence. Bumping to
// 800ms keeps us comfortably under, and the retry logic below catches
// transient hits regardless.
const THROTTLE_MS = 800;
const API_MAX_RETRIES = 3;
const API_RETRY_BASE_MS = 4000;

const WP_BASE_URL = (process.env.WP_BASE_URL || 'https://vincentragosta.io').replace(/\/+$/, '');
const WP_USER = process.env.WP_REMEDIATE_USER;
const WP_APP_PASSWORD = process.env.WP_REMEDIATE_APP_PASSWORD;

if (APPLY && (!WP_USER || !WP_APP_PASSWORD)) {
    console.error('Missing WP_REMEDIATE_USER and/or WP_REMEDIATE_APP_PASSWORD env vars.');
    console.error('Generate an Application Password at WP Admin → Users → Profile → Application Passwords.');
    process.exit(1);
}

const WP_AUTH = (WP_USER && WP_APP_PASSWORD)
    ? 'Basic ' + Buffer.from(`${WP_USER}:${WP_APP_PASSWORD}`).toString('base64')
    : '';

console.log(APPLY
    ? '[APPLY MODE — WP writes enabled]'
    : '[DRY RUN — no WP writes. Pass --apply to commit.]');
console.log(`WP base URL:   ${WP_BASE_URL}`);
console.log(`Audit CSV:     ${AUDIT_CSV}`);
if (ONLY_CARD_ID) console.log(`Single card:   #${ONLY_CARD_ID}`);
if (Number.isFinite(LIMIT)) console.log(`Limit:         ${LIMIT}`);
console.log();

// --- CSV ---------------------------------------------------------------

function parseAuditCsv(filepath) {
    if (!fs.existsSync(filepath)) {
        console.error(`Audit CSV not found at ${filepath}`);
        process.exit(1);
    }
    const text = fs.readFileSync(filepath, 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    // Header: shared_path,card_id,card_title,attachment_id
    const [, ...rows] = lines;
    return rows.map((line) => {
        // Card titles don't contain commas in any of the 47 affected
        // rows, so a plain split is fine. If that ever changes, swap
        // for a real CSV parser.
        const [shared_path, card_id, card_title, attachment_id] = line.split(',');
        return {
            shared_path,
            card_id: parseInt(card_id, 10),
            card_title,
            attachment_id: parseInt(attachment_id, 10),
        };
    });
}

// --- Title parsing -----------------------------------------------------

// Set keywords that appear in the 47 affected WP titles. Longest match
// wins (e.g. "Base Set 2" before "Base Set"). Imperfect in general but
// covers every title in the audit CSV.
const SET_KEYWORDS = [
    'Kids WB Presents Pokemon The First Movie Promo',
    'Base Set 2',
    'Base Set',
    'Team Rocket',
    'Gym Heroes',
    'Gym Challenge',
    'Neo Genesis',
    'Neo Discovery',
    'Neo Revelation',
    'Neo Destiny',
    'Fossil',
    'Jungle',
    'Celebrations',
    'Promo',
];

// pokemontcg.io's `set.name` doesn't always match the way the WP title
// spells the set. Notably the original 1999 Base Set is just `"Base"`
// on the API, while every collector / our WP titles call it
// `"Base Set"`. When the WP title's set hint is on the left of this
// table, also try the right-hand value as an alternate.
const SET_NAME_ALIASES = {
    'Base Set': ['Base'],
    'Kids WB Presents Pokemon The First Movie Promo': ['WB Pokémon: The First Movie'],
    'Promo': ['Wizards Black Star Promos'],
};

function parseCardTitle(title) {
    // Trailing card number: "1/62" or just "1" for promos. Capture the
    // total (denominator) when present — it's the cleanest
    // disambiguator when name+number matches multiple sets. Base Set
    // has 102 cards, Base Set 2 has 130, etc.
    const m = title.match(/^(.+?)\s+(\d+)(?:\/(\d+))?$/);
    if (!m) return { name: title, setHint: '', number: '', total: null };
    const number = m[2];
    const total = m[3] ? parseInt(m[3], 10) : null;
    const prefix = m[1].trim();

    for (const kw of SET_KEYWORDS) {
        const idx = prefix.lastIndexOf(kw);
        if (idx >= 0) {
            return {
                name: prefix.slice(0, idx).trim(),
                setHint: prefix.slice(idx).trim(),
                number,
                total,
            };
        }
    }
    return { name: prefix, setHint: '', number, total };
}

// --- pokemontcg.io -----------------------------------------------------

function tcgHeaders() {
    return POKEMON_TCG_API_KEY ? { 'X-Api-Key': POKEMON_TCG_API_KEY } : {};
}

/**
 * Wraps a pokemontcg.io fetch with retry-on-rate-limit. The API
 * returns 404 (not the more conventional 429) when the free tier
 * throttles, with the body indicating it was rate-limited. We retry
 * with exponential backoff so a transient rate-limit kick mid-batch
 * doesn't poison the whole run.
 */
async function tcgFetch(url) {
    let lastErr;
    for (let attempt = 0; attempt < API_MAX_RETRIES; attempt++) {
        const res = await fetch(url, { headers: tcgHeaders() });
        if (res.ok) return res;
        // Both 404 (rate-limit in disguise) and 429 are retryable.
        if (res.status === 404 || res.status === 429) {
            lastErr = new Error(`pokemontcg.io ${res.status} (retry ${attempt + 1}/${API_MAX_RETRIES})`);
            const waitMs = API_RETRY_BASE_MS * Math.pow(2, attempt);
            await sleep(waitMs);
            continue;
        }
        // Other statuses are non-transient; bail immediately.
        throw new Error(`pokemontcg.io ${res.status}`);
    }
    throw lastErr || new Error('pokemontcg.io exhausted retries');
}

/**
 * Returns the canonical hi-res image URL for the matched card, or null
 * if pokemontcg.io has no entry for that name+number+set combination.
 *
 * Matching strategy: query the API broadly by name+number (no set
 * filter in the query string — pokemontcg.io's `set.name:` filter
 * doesn't tokenize the way we'd expect and tends to either over-match
 * or 404), then disambiguate in code using two signals:
 *
 *   1. set.name === setHint (case-insensitive), with alias fallback
 *      (e.g. WP "Base Set" ↔ API "Base"). This is the primary tie-
 *      breaker when multiple sets contain a card with the same name
 *      and number.
 *
 *   2. set.printedTotal === total. Distinguishes "Alakazam 1/102" (the
 *      original Base Set, 102 cards) from "Alakazam 1/130" (Base Set 2,
 *      130 cards) when the set hint alone can't separate them.
 *
 * When neither signal disambiguates, we surface the first result.
 */
async function findCardImage({ name, number, setHint, total }) {
    // Don't put set.name in the query — it's unreliable. Query
    // name+number, then filter results in code.
    const queries = [];
    if (name) queries.push(`name:"${name}" number:"${number}"`);
    queries.push(`number:"${number}"`);

    const setHintLower = setHint ? setHint.toLowerCase() : '';
    const aliases = SET_NAME_ALIASES[setHint] || [];
    const aliasesLower = aliases.map((a) => a.toLowerCase());

    for (const q of queries) {
        const url = `${POKEMON_TCG_API}/cards?q=${encodeURIComponent(q)}&pageSize=25`;
        const res = await tcgFetch(url);
        const data = await res.json();
        const matches = data.data || [];
        if (!matches.length) continue;

        // Apply the two disambiguators in priority order.
        const exactSetMatch = setHint
            ? matches.find((c) => (c.set?.name || '').toLowerCase() === setHintLower)
            : null;
        const aliasSetMatch = !exactSetMatch && aliasesLower.length
            ? matches.find((c) => aliasesLower.includes((c.set?.name || '').toLowerCase()))
            : null;
        const setMatched = exactSetMatch || aliasSetMatch;

        // If a set-matched candidate ALSO has the right printedTotal,
        // that's the strongest signal — return it. Otherwise, use the
        // set match alone (the title's set keyword is usually
        // authoritative), or fall back to totalMatch alone, or first.
        let chosen = null;
        if (setMatched && total && setMatched.set?.printedTotal === total) {
            chosen = setMatched;
        } else if (setMatched) {
            chosen = setMatched;
        } else if (total) {
            chosen = matches.find((c) => c.set?.printedTotal === total) || matches[0];
        } else {
            chosen = matches[0];
        }

        const image = chosen.images?.large || chosen.images?.small || null;
        if (image) return { image, apiId: chosen.id, setName: chosen.set?.name };
    }
    return null;
}

// --- WP REST helpers ---------------------------------------------------

async function downloadImage(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image download ${res.status} for ${url}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
}

function slugify(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

async function uploadAttachment({ buffer, filename, contentType }) {
    const res = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/media`, {
        method: 'POST',
        headers: {
            Authorization: WP_AUTH,
            'Content-Type': contentType,
            'Content-Disposition': `attachment; filename="${filename}"`,
        },
        body: buffer,
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`POST /media ${res.status}: ${txt.slice(0, 300)}`);
    }
    const data = await res.json();
    return data.id;
}

async function setFeaturedMedia(cardId, attachmentId) {
    const res = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/card/${cardId}`, {
        method: 'POST',
        headers: {
            Authorization: WP_AUTH,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ featured_media: attachmentId }),
    });
    if (!res.ok) {
        const txt = await res.text();
        throw new Error(`POST /card/${cardId} ${res.status}: ${txt.slice(0, 300)}`);
    }
}

// --- main --------------------------------------------------------------

function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

async function main() {
    const rows = parseAuditCsv(AUDIT_CSV);
    const filtered = ONLY_CARD_ID
        ? rows.filter((r) => r.card_id === ONLY_CARD_ID)
        : rows;

    console.log(`Audit rows:    ${rows.length}`);
    console.log(`To process:    ${Math.min(filtered.length, LIMIT)}`);
    console.log();

    const results = {
        ok: [],
        noMatch: [],
        errors: [],
    };

    let processed = 0;
    for (const row of filtered) {
        if (processed >= LIMIT) break;
        processed++;

        const { name, setHint, number, total } = parseCardTitle(row.card_title);
        console.log(`[${processed}/${Math.min(filtered.length, LIMIT)}] card #${row.card_id} "${row.card_title}"`);
        console.log(`     parse → name="${name}" setHint="${setHint}" number=${number} total=${total}`);

        let match;
        try {
            match = await findCardImage({ name, number, setHint, total });
        } catch (e) {
            console.log(`     ⚠️  API error: ${e.message}`);
            results.errors.push({ ...row, error: e.message });
            await sleep(THROTTLE_MS);
            continue;
        }
        if (!match) {
            console.log(`     ⚠️  no pokemontcg.io match`);
            results.noMatch.push(row);
            await sleep(THROTTLE_MS);
            continue;
        }
        console.log(`     match  → ${match.apiId} (${match.setName})`);
        console.log(`     image  → ${match.image}`);

        if (!APPLY) {
            console.log(`     [dry-run] would: download → upload → repoint #${row.card_id}`);
            results.ok.push({ ...row, apiId: match.apiId });
            await sleep(THROTTLE_MS);
            continue;
        }

        try {
            const buffer = await downloadImage(match.image);
            const ext =
                path.extname(new URL(match.image).pathname).toLowerCase() ||
                '.png';
            const contentType =
                ext === '.jpg' || ext === '.jpeg'
                    ? 'image/jpeg'
                    : ext === '.webp'
                        ? 'image/webp'
                        : 'image/png';
            // Filename embeds the card title + a timestamp suffix. The
            // CardAttachmentUniqueFilename hook on the WP side will
            // additionally randomize, so collisions are impossible by
            // construction even if this script were run twice in
            // parallel.
            const filename = `${slugify(row.card_title)}-${Date.now()}${ext}`;
            const newAttachmentId = await uploadAttachment({
                buffer,
                filename,
                contentType,
            });
            await setFeaturedMedia(row.card_id, newAttachmentId);
            console.log(`     ✓ attachment ${newAttachmentId} → card #${row.card_id}`);
            results.ok.push({ ...row, apiId: match.apiId, newAttachmentId });
        } catch (e) {
            console.log(`     ✗ ${e.message}`);
            results.errors.push({ ...row, error: e.message });
        }

        await sleep(THROTTLE_MS);
    }

    console.log();
    console.log('=== summary ===');
    console.log(`processed:   ${processed}`);
    console.log(`ok:          ${results.ok.length}`);
    console.log(`no match:    ${results.noMatch.length}`);
    console.log(`errors:      ${results.errors.length}`);
    if (results.noMatch.length) {
        console.log();
        console.log('No pokemontcg.io match (need manual handling):');
        for (const r of results.noMatch) {
            console.log(`  - #${r.card_id}  ${r.card_title}`);
        }
    }
    if (results.errors.length) {
        console.log();
        console.log('Errors:');
        for (const r of results.errors) {
            console.log(`  - #${r.card_id}  ${r.card_title}`);
            console.log(`    ${r.error}`);
        }
    }
    if (!APPLY) {
        console.log();
        console.log('Dry-run complete. Re-run with --apply to commit the writes.');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
