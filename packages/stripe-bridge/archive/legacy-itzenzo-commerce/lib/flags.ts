/**
 * Feature flags for the Whatnot-first migration phase (2026-05).
 *
 * itzenzo.tv was originally built as the livestream venue itself —
 * homepage Live Queue / Duck Race / Activity Feed, pack battles, and
 * pull boxes all assumed the operator was streaming on itzenzo.tv. With
 * TikTok permanently deleting the operator's TikTok Shop and the
 * business pivoting to Whatnot for live commerce, the homepage reframes
 * as a Whatnot landing pad.
 *
 * NON-DESTRUCTIVE: all underlying React components, API routes, Discord
 * bot mechanics, DB tables, and Stripe products stay operational. This
 * flag controls UI surfacing only. Flip it to false to instantly revert
 * the homepage and frontend CTAs to the original itzenzo.tv-as-venue
 * mode — useful if the Whatnot pivot doesn't pan out.
 */

export const IS_WHATNOT_PRIMARY = true;

export const WHATNOT_URL = "https://whatnot.com/user/itzenzottv";

/**
 * Stripe payment backend kill switch (Whatnot pivot).
 *
 * Distinct from IS_WHATNOT_PRIMARY: that flag controls UI *surfacing*
 * (what the homepage/CTAs show), while this controls the payment
 * *backend*. When false, the checkout proxy routes refuse upstream calls
 * (503) and the thank-you server actions skip Stripe entirely, so the
 * storefront never originates a Stripe Checkout Session. Mirrors the
 * STRIPE_ENABLED define in WordPress's wp-config-env.php (the canonical
 * source) and Nous's config.STRIPE_ENABLED. Flip to true to re-enable.
 */
export const STRIPE_ENABLED = false;
