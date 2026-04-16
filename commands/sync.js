/**
 * Product Sync Commands
 *
 * !sync          — Full pipeline: Google Sheets → Stripe → WordPress
 * !sync stripe   — Stripe → WordPress only (skip Sheets)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../config.js';
import { sendToChannel } from '../discord.js';
import { alertNewProducts } from '../alerts/products.js';

const exec = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const PUSH_SCRIPT = path.join(PROJECT_ROOT, 'scripts/shop/push-products.js');
const PULL_SCRIPT = path.join(PROJECT_ROOT, 'scripts/pull-products.php');
const WP_PATH = path.resolve(PROJECT_ROOT, 'wp');

/**
 * Resolve the Node.js binary — handles NVM environments.
 */
function getNodePath() {
    return process.execPath;
}

/**
 * Run push-products.js (Sheets → Stripe).
 */
async function pushToStripe(clean) {
    const args = [PUSH_SCRIPT];
    if (clean) args.push('--clean');
    const { stdout } = await exec(getNodePath(), args, {
        cwd: PROJECT_ROOT,
        timeout: 120000,
        env: { ...process.env, HOME: process.env.HOME || '/root' },
    });
    return stdout;
}

/**
 * Run pull-products.php (Stripe → WordPress).
 */
async function pullToWordPress() {
    const { stdout } = await exec('wp', [
        'eval-file', PULL_SCRIPT,
        `--path=${WP_PATH}`,
        '--allow-root',
    ], {
        cwd: PROJECT_ROOT,
        timeout: 120000,
        env: {
            ...process.env,
            PUBLISH: '1',
            CLEAN: '1',
        },
    });
    return stdout;
}

/**
 * Parse sync output for a summary line (e.g., "2 created, 11 updated, 0 skipped").
 */
function parseSummary(output) {
    const doneMatch = output.match(/Done:\s*(.+)/);
    return doneMatch ? doneMatch[1].trim() : null;
}

/**
 * Parse new products from push-products.js output (Sheets → Stripe).
 * Captures name, price, and category from "Created:" lines.
 *
 * Example: "  Created: Pokemon Astral Radiance ($10.99) [pokemon, ENG, stock:12]"
 */
function parsePushNewProducts(output) {
    const products = [];
    const regex = /^\s*Created:\s+(.+?)\s+\(\$(\d+\.\d{2})\)\s+\[(\w+)/gm;
    let match;
    while ((match = regex.exec(output)) !== null) {
        products.push({
            name: match[1],
            price: Math.round(parseFloat(match[2]) * 100),
            category: match[3],
        });
    }
    return products;
}

/**
 * Parse new products from pull-products.php output (Stripe → WordPress).
 * Captures name and category from "Created (published):" lines.
 *
 * Example: "  Created (published): Pokemon Lost Origin (ID 595) [pokemon, ENG, stock:7]"
 */
function parsePullNewProducts(output) {
    const products = [];
    const regex = /Created\s*\(published\):\s+(.+?)\s+\(ID \d+\)\s+\[(\w+)/g;
    let match;
    while ((match = regex.exec(output)) !== null) {
        products.push({ name: match[1], category: match[2] });
    }
    return products;
}

async function handleSync(message, args) {
    // Akivili only
    if (!message.member.roles.cache.has(config.ROLES.AKIVILI)) {
        return message.reply('Only the owner can sync products.');
    }

    const subcommand = args[0]?.toLowerCase();

    if (subcommand === 'stripe') {
        return syncStripeToWordPress(message);
    }

    return syncFull(message);
}

/**
 * Full sync: Sheets → Stripe → WordPress
 */
async function syncFull(message) {
    await message.channel.send('🔄 **Syncing products:** Sheets → Stripe → WordPress...');

    try {
        // Step 1: Sheets → Stripe
        const pushOutput = await pushToStripe(true);
        const pushSummary = parseSummary(pushOutput);
        const pushNewProducts = parsePushNewProducts(pushOutput);

        await message.channel.send(
            `✅ **Sheets → Stripe** complete${pushSummary ? `: ${pushSummary}` : ''}`
        );

        // Step 2: Stripe → WordPress
        const pullOutput = await pullToWordPress();
        const pullSummary = parseSummary(pullOutput);

        await message.channel.send(
            `✅ **Stripe → WordPress** complete${pullSummary ? `: ${pullSummary}` : ''}`
        );

        // Post summary to #ops
        const lines = ['📦 **Product Sync Complete**', ''];
        if (pushSummary) lines.push(`**Sheets → Stripe:** ${pushSummary}`);
        if (pullSummary) lines.push(`**Stripe → WordPress:** ${pullSummary}`);
        await sendToChannel('OPS', lines.join('\n'));

        // Alert new products (use push data for price, batch the call)
        if (pushNewProducts.length > 0) {
            await alertNewProducts(pushNewProducts.map((p) => ({
                name: p.name,
                price: p.price,
                category: p.category,
                shop_url: config.SHOP_URL,
            })));
        }
    } catch (e) {
        console.error('Product sync failed:', e.message);
        await message.channel.send(`❌ **Sync failed:** ${e.message}`);
    }
}

/**
 * Stripe → WordPress only
 */
async function syncStripeToWordPress(message) {
    await message.channel.send('🔄 **Syncing products:** Stripe → WordPress...');

    try {
        const pullOutput = await pullToWordPress();
        const pullSummary = parseSummary(pullOutput);
        const newProducts = parsePullNewProducts(pullOutput);

        await message.channel.send(
            `✅ **Stripe → WordPress** complete${pullSummary ? `: ${pullSummary}` : ''}`
        );

        await sendToChannel('OPS', `📦 **Product Sync Complete**\n\n**Stripe → WordPress:** ${pullSummary || 'done'}`);

        // Alert new products (no price data from pull output, batch the call)
        if (newProducts.length > 0) {
            await alertNewProducts(newProducts.map((p) => ({
                name: p.name,
                category: p.category,
                shop_url: config.SHOP_URL,
            })));
        }
    } catch (e) {
        console.error('Stripe → WordPress sync failed:', e.message);
        await message.channel.send(`❌ **Sync failed:** ${e.message}`);
    }
}

export { handleSync, parseSummary, parsePushNewProducts, parsePullNewProducts };
