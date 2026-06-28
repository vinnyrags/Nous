/**
 * Discord Button / Modal / Select interaction handlers.
 *
 * Post-Stripe excision this is limited to community features: giveaway
 * entry (button + TikTok username modal) and the Minecraft Java-whitelist
 * button/modal. All commerce buy-button / checkout / account-linking flows
 * were removed with the Whatnot pivot.
 */

import { ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder } from 'discord.js';
import { giveaways } from '../db.js';
import { handleGiveawayEntry } from './giveaway.js';
import {
    handleJavaWhitelistButton,
    handleJavaWhitelistSubmit,
    JAVA_WHITELIST_BUTTON_ID,
    JAVA_WHITELIST_MODAL_ID,
} from './minecraft.js';

/**
 * Route button interactions by customId.
 */
async function handleButtonInteraction(interaction) {
    const customId = interaction.customId;

    if (customId === JAVA_WHITELIST_BUTTON_ID) {
        return handleJavaWhitelistButton(interaction);
    }

    if (customId.startsWith('giveaway-enter-')) {
        const giveawayId = Number(customId.replace('giveaway-enter-', ''));
        return handleGiveawayButton(interaction, giveawayId);
    }
}

/**
 * Route modal submissions by customId.
 */
async function handleModalSubmit(interaction) {
    // Giveaway TikTok username modal
    if (interaction.customId.startsWith('giveaway-tiktok-')) {
        const giveawayId = Number(interaction.customId.replace('giveaway-tiktok-', ''));
        const tiktokUsername = interaction.fields.getTextInputValue('tiktok_input')?.trim().replace(/^@/, '');

        if (!tiktokUsername) {
            return interaction.reply({ content: 'Please enter your TikTok username.', ephemeral: true });
        }

        return handleGiveawayEntry(interaction, giveawayId, tiktokUsername);
    }

    // Minecraft Java whitelist modal
    if (interaction.customId === JAVA_WHITELIST_MODAL_ID) {
        return handleJavaWhitelistSubmit(interaction);
    }
}

/**
 * Giveaway entry button handler.
 * Standard giveaways: enter immediately.
 * Social giveaways: show TikTok username modal first.
 */
async function handleGiveawayButton(interaction, giveawayId) {
    const giveaway = giveaways.getById.get(giveawayId);
    if (!giveaway || giveaway.status !== 'open') {
        return interaction.reply({ content: 'This giveaway is no longer open.', ephemeral: true });
    }

    // Social giveaway — show TikTok username modal
    if (giveaway.is_social) {
        const modal = new ModalBuilder()
            .setCustomId(`giveaway-tiktok-${giveawayId}`)
            .setTitle('Enter Giveaway');

        const tiktokInput = new TextInputBuilder()
            .setCustomId('tiktok_input')
            .setLabel('Your TikTok username')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('itzenzottv');

        const row = new ActionRowBuilder().addComponents(tiktokInput);
        modal.addComponents(row);

        return interaction.showModal(modal);
    }

    // Standard giveaway — enter directly
    return handleGiveawayEntry(interaction, giveawayId);
}

// No select-menu interactions remain post-excision (card list-buy retired).
async function handleSelectMenuInteraction() { /* no-op */ }

export { handleButtonInteraction, handleModalSubmit, handleSelectMenuInteraction };
