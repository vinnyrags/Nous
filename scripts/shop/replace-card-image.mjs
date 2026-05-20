#!/usr/bin/env node
/**
 * Replace a card's WP image with a different source URL.
 *
 * Built for the Evolutions-stamp issue: pokemontcg.io's hosted images
 * for some XY12 cards (Charizard #11, Gyarados #34) have the prerelease
 * "EVOLUTIONS" stamp baked into the PNG bytes. Retail copies don't
 * carry that stamp, so the listing image misrepresents what the buyer
 * receives. Limitless TCG hosts clean retail scans at predictable URLs
 * (https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/{SET}/
 * {SET}_{NNN}_{R}_EN_LG.png).
 *
 * For each target:
 *   1. Download from sourceUrl
 *   2. Upload to WP /wp-json/wp/v2/media (new attachment)
 *   3. Repoint card.featured_media to the new attachment
 *
 * The old attachment is left orphaned (same convention as
 * remediate-card-image-collisions.mjs) — safer than risking deletion
 * of a still-referenced row.
 *
 * Modes:
 *   --apply  actually do writes (default is dry-run preview)
 *
 * Env (required when --apply is passed):
 *   WP_REMEDIATE_USER          WP admin username
 *   WP_REMEDIATE_APP_PASSWORD  WP Application Password
 *   WP_BASE_URL                defaults to https://vincentragosta.io
 *
 * Usage:
 *   node scripts/shop/replace-card-image.mjs              # dry run
 *   WP_REMEDIATE_USER=... WP_REMEDIATE_APP_PASSWORD=... \
 *     node scripts/shop/replace-card-image.mjs --apply
 */

import path from 'node:path';

const TARGETS = [
    {
        cardId: 5857,
        label: 'Charizard #11/108 — Evolutions',
        sourceUrl: 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/EVO/EVO_011_R_EN_LG.png',
    },
    {
        cardId: 5851,
        label: 'Gyarados #34/108 — Evolutions',
        sourceUrl: 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpci/EVO/EVO_034_R_EN_LG.png',
    },
];

const APPLY = process.argv.includes('--apply');
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
console.log(`WP base URL: ${WP_BASE_URL}`);
console.log(`Targets:     ${TARGETS.length}`);
console.log();

function slugify(s) {
    return s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
}

async function downloadImage(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Image download ${res.status} for ${url}`);
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
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

async function main() {
    const results = { ok: [], errors: [] };

    for (let i = 0; i < TARGETS.length; i++) {
        const t = TARGETS[i];
        console.log(`[${i + 1}/${TARGETS.length}] card #${t.cardId} "${t.label}"`);
        console.log(`     source → ${t.sourceUrl}`);

        if (!APPLY) {
            console.log(`     [dry-run] would: download → upload → repoint #${t.cardId}`);
            results.ok.push(t);
            continue;
        }

        try {
            const buffer = await downloadImage(t.sourceUrl);
            const ext = path.extname(new URL(t.sourceUrl).pathname).toLowerCase() || '.png';
            const contentType =
                ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
                : ext === '.webp' ? 'image/webp'
                : 'image/png';
            const filename = `${slugify(t.label)}-${Date.now()}${ext}`;
            const newAttachmentId = await uploadAttachment({ buffer, filename, contentType });
            await setFeaturedMedia(t.cardId, newAttachmentId);
            console.log(`     ✓ attachment ${newAttachmentId} → card #${t.cardId}`);
            results.ok.push({ ...t, newAttachmentId });
        } catch (e) {
            console.log(`     ✗ ${e.message}`);
            results.errors.push({ ...t, error: e.message });
        }
    }

    console.log();
    console.log('=== summary ===');
    console.log(`ok:     ${results.ok.length}`);
    console.log(`errors: ${results.errors.length}`);
    if (results.errors.length) {
        console.log();
        for (const r of results.errors) {
            console.log(`  - #${r.cardId}  ${r.label}`);
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
