/**
 * Centralized Shipping Logic
 *
 * All shipping rate lookups, double-charge prevention, and recording
 * flow through this module. Every checkout endpoint and command uses
 * these helpers instead of ad-hoc checks.
 */

import config from './config.js';
import { purchases, shipping, discordLinks } from './db.js';

/**
 * Check if a Discord user is flagged as international.
 */
function isInternational(discordUserId) {
    const row = discordLinks.getCountry.get(discordUserId);
    return !!(row?.country && row.country !== 'US');
}

/**
 * Check if a buyer (by email) is international.
 */
function isInternationalByEmail(email) {
    const row = discordLinks.getCountryByEmail.get(email);
    return !!(row?.country && row.country !== 'US');
}

/**
 * Get the correct shipping rate for a Discord user (in cents).
 */
function getShippingRate(discordUserId) {
    return isInternational(discordUserId)
        ? config.SHIPPING.INTERNATIONAL
        : config.SHIPPING.DOMESTIC;
}

/**
 * Get the shipping rate by email (in cents).
 */
function getShippingRateByEmail(email) {
    return isInternationalByEmail(email)
        ? config.SHIPPING.INTERNATIONAL
        : config.SHIPPING.DOMESTIC;
}

/**
 * Check if a buyer has already paid shipping for the current period.
 *
 * Domestic: checks this week (Mon–Sun).
 * International: checks this month.
 */
function hasShippingCovered(email) {
    const intl = isInternationalByEmail(email);

    if (intl) {
        return !!shipping.hasShippingThisMonth.get(email);
    }

    return !!shipping.hasShippingThisWeek.get(email);
}

/**
 * Check if a Discord user has shipping covered (looks up email first).
 */
function hasShippingCoveredByDiscordId(discordUserId) {
    const link = purchases.getEmailByDiscordId.get(discordUserId);
    if (!link) return false;

    return hasShippingCovered(link.customer_email);
}

/**
 * Record a shipping payment in the unified shipping_payments table.
 */
function recordShipping(email, discordUserId, amount, source, stripeSessionId = null) {
    shipping.record.run(email, discordUserId || null, amount, source, stripeSessionId || null);
}

/**
 * Get the current period's shipping record for a buyer.
 * Auto-detects domestic vs international based on email.
 */
function getShippingRecord(email) {
    const intl = isInternationalByEmail(email);

    if (intl) {
        return shipping.getByEmailThisMonth.get(email) || null;
    }

    return shipping.getByEmailThisWeek.get(email) || null;
}

/**
 * Get a display label for a shipping rate.
 */
function formatShippingRate(amountCents) {
    return `$${(amountCents / 100).toFixed(2)}`;
}

/**
 * Get the shipping label for a Discord user.
 */
function getShippingLabel(discordUserId) {
    const intl = isInternational(discordUserId);
    const rate = intl ? config.SHIPPING.INTERNATIONAL : config.SHIPPING.DOMESTIC;
    const label = intl ? 'International Shipping' : 'Standard Shipping (US)';
    return { rate, label, isInternational: intl };
}

/**
 * Build Stripe shipping_options for a checkout session.
 *
 * - Buyer flagged as international → single international option
 * - Buyer flagged as domestic (or US) → single domestic option
 * - Buyer unknown/unflagged → both options, buyer self-selects
 */
function buildShippingOptions(discordUserId) {
    const domestic = {
        shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: config.SHIPPING.DOMESTIC, currency: 'usd' },
            display_name: 'Standard Shipping (US)',
        },
    };

    const international = {
        shipping_rate_data: {
            type: 'fixed_amount',
            fixed_amount: { amount: config.SHIPPING.INTERNATIONAL, currency: 'usd' },
            display_name: 'International Shipping',
        },
    };

    // No buyer identified — offer both
    if (!discordUserId) {
        return [domestic, international];
    }

    // Check if buyer has a country flag
    const intl = isInternational(discordUserId);
    const hasFlag = (() => {
        const row = discordLinks.getCountry.get(discordUserId);
        return row?.country != null;
    })();

    // Flagged international → international only
    if (intl) return [international];

    // Flagged domestic (explicitly US) → domestic only
    if (hasFlag) return [domestic];

    // Linked but no country flag → offer both
    return [domestic, international];
}

export {
    isInternational,
    isInternationalByEmail,
    getShippingRate,
    getShippingRateByEmail,
    hasShippingCovered,
    hasShippingCoveredByDiscordId,
    recordShipping,
    getShippingRecord,
    formatShippingRate,
    getShippingLabel,
    buildShippingOptions,
};
