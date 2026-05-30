/**
 * @itzenzottv/stripe-bridge
 *
 * Standalone Stripe I/O bridge for the itzenzoTTV stack. The Whatnot pivot
 * parked Stripe behind a kill switch (see Nous config.STRIPE_ENABLED); this
 * package is the second half of that effort — relocating ALL Stripe SDK
 * calls out of the Nous bot into a clean, reusable boundary so the bot keeps
 * only domain logic (orders, queue, roles, ShippingEasy).
 *
 * Imports only the `stripe` SDK. Never imports Nous. Consumed by Nous as an
 * npm workspace package (`@itzenzottv/stripe-bridge`).
 *
 * Extraction is incremental and behavior-preserving — exports land one slice
 * at a time, with the Nous test suite kept green after each.
 */

// Package version marker — lets consumers/tests confirm the workspace link
// resolves before any real surface is wired up.
export const BRIDGE_VERSION = '0.1.0';

// Stripe key mode detection (live/test/unknown). Re-exported so ESM
// consumers can `import { detectMode } from '@itzenzottv/stripe-bridge'`;
// CJS consumers use the `@itzenzottv/stripe-bridge/stripe-mode` subpath.
export { detectMode, isLiveMode, isTestMode } from './stripe-mode.cjs';
