import { config } from '../config.js';

/**
 * Stripe kill switch for the Discord surface (Whatnot pivot).
 *
 * Live sales moved from Stripe checkout to Whatnot. Rather than edit every
 * Stripe-dependent command, the interactionCreate dispatcher consults the
 * sets below and short-circuits gated slash commands and buy buttons
 * BEFORE their handlers run — so the `new Stripe(config.STRIPE_SECRET_KEY)`
 * call at the top of each command never executes with a null key.
 *
 * Single source of truth for whether Stripe is on is config.STRIPE_ENABLED.
 */

const WHATNOT_URL = 'https://whatnot.com/user/itzenzottv';

/**
 * Slash commands whose execute() constructs the Stripe SDK directly and
 * would therefore throw when Stripe is parked. Identity/queue/admin
 * commands (link, queue, pull reset, etc.) are intentionally absent — they
 * must keep working during Whatnot streams.
 *
 * @type {Set<string>}
 */
export const STRIPE_GATED_COMMANDS = new Set([
    'battle',
    'coupon',
    'hype',
    'refund',
    'sell',
    'shipping',
    'shipping-audit',
    'waive',
]);

/**
 * Whether a button customId initiates a Stripe checkout.
 *
 * @param {string} customId
 * @returns {boolean}
 */
export function isStripeGatedButton(customId) {
    return (
        customId === 'pull-buy' ||
        customId.startsWith('card-buy-') ||
        customId.startsWith('hype-buy-') ||
        customId.startsWith('battle-buy-') ||
        customId.startsWith('sell-buy-')
    );
}

/**
 * If Stripe is parked, reply to the interaction with an ephemeral notice
 * and report that it was handled. Returns false when Stripe is enabled so
 * the caller proceeds with the normal flow.
 *
 * @param {import('discord.js').Interaction} interaction
 * @returns {Promise<boolean>} true when handled (caller should return)
 */
export async function handleStripeParked(interaction) {
    if (config.STRIPE_ENABLED) {
        return false;
    }

    const payload = {
        content: `🛑 Checkout is paused — we've moved live sales to Whatnot: ${WHATNOT_URL}`,
        ephemeral: true,
    };

    if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload);
    } else {
        await interaction.reply(payload);
    }

    return true;
}
