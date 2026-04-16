/**
 * Product Alerts
 *
 * Posts new product notifications to #deals.
 * Triggered via HTTP endpoint after `!sync` or `make sync-products`.
 */

import { sendEmbed } from '../discord.js';

/**
 * Post a new product alert to #deals.
 */
async function alertNewProduct(product) {
    const { name, category, price, shop_url } = product;

    const description = [
        `**${name}**`,
        category ? `📂 ${category}` : null,
        price ? `💰 $${(price / 100).toFixed(2)}` : null,
        shop_url ? `\n👉 [Shop Now](${shop_url})` : null,
    ].filter(Boolean).join('\n');

    await sendEmbed('DEALS', {
        title: '🆕 New Drop!',
        description,
        color: 0xceff00,
    });

    console.log(`Product alert sent: ${name} → #deals`);
}

/**
 * Handle bulk product alerts (after sync).
 */
async function alertNewProducts(products) {
    if (!products.length) return;

    if (products.length === 1) {
        await alertNewProduct(products[0]);
        return;
    }

    // Bulk alert — single embed with all products
    const list = products.map((p) => `• **${p.name}**${p.category ? ` (${p.category})` : ''}${p.price ? ` — $${(p.price / 100).toFixed(2)}` : ''}`).join('\n');

    await sendEmbed('DEALS', {
        title: `🆕 ${products.length} New Drops!`,
        description: list,
        color: 0xceff00,
    });

    console.log(`Bulk product alert sent: ${products.length} products → #deals`);
}

export { alertNewProduct, alertNewProducts };
