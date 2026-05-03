/**
 * /hype — pre-stream hype announcement.
 *   /hype products:"Product 1, Product 2" — looks up products in Stripe,
 *                                            posts hype embed in #announcements,
 *                                            drops checkout URLs in #ops
 */

import config from '../../config.js';
import { buildSyntheticMessage } from '../../lib/synthetic-message.js';
import { handleHype } from '../hype.js';

export async function handleHypeSlash(interaction) {
    if (!interaction.member?.roles?.cache?.has(config.ROLES.AKIVILI)) {
        return interaction.reply({ content: 'Only Akivili can run /hype.', ephemeral: true });
    }

    const products = interaction.options.getString('products', true);
    // Legacy handler joins args with space then splits on comma — preserve
    // that shape by passing the full string as a single arg.
    const args = products.split(/\s+/);

    await interaction.deferReply({ ephemeral: true });
    const message = buildSyntheticMessage(interaction);
    try {
        await handleHype(message, args);
        if (!interaction.replied) {
            await interaction.followUp({ content: `✓ /hype queued. Check #ops for the preview embed (✅ to confirm).`, ephemeral: true });
        }
        return products;
    } catch (e) {
        await interaction.followUp({ content: `✗ /hype failed: ${e.message}`, ephemeral: true });
        throw e;
    }
}
