/**
 * /sync — pull catalog from Sheets/Stripe → WordPress.
 * /sync mode:full      — full sync (default)
 * /sync mode:stripe    — Stripe only (faster, skips Sheets)
 *
 * Triggers a product-cache refresh on success so /battle and /hype
 * autocomplete reflect the freshly-synced catalog.
 */

import config from '../../config.js';
import { buildSyntheticMessage } from '../../lib/synthetic-message.js';
import { handleSync } from '../sync.js';
import * as productCache from '../../lib/product-cache.js';

export async function handleSyncSlash(interaction) {
    if (!interaction.member?.roles?.cache?.has(config.ROLES.AKIVILI)) {
        return interaction.reply({ content: 'Only Akivili can run /sync.', ephemeral: true });
    }

    const mode = interaction.options.getString('mode') || 'full';
    const args = mode === 'stripe' ? ['stripe'] : [];

    await interaction.deferReply({ ephemeral: true });
    const message = buildSyntheticMessage(interaction);
    try {
        await handleSync(message, args);
        // Refresh the autocomplete cache so newly-synced products show up
        // in /battle and /hype suggestions immediately. Non-blocking — if
        // the refresh fails the next /sync (or bot restart) will pick it up.
        productCache.refresh().catch(() => {});
        if (!interaction.replied) {
            await interaction.followUp({ content: `✓ /sync (${mode}) finished. Check the channel for the result embed.`, ephemeral: true });
        }
        return mode;
    } catch (e) {
        await interaction.followUp({ content: `✗ /sync failed: ${e.message}`, ephemeral: true });
        throw e;
    }
}
