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

// Unified Checkout Session param assembler (replaces the 8 inline params
// objects in the Nous bot). Pure — no Stripe I/O, no DB, no magic defaults.
export { buildCheckoutSessionParams } from './checkout/session-params.js';

// Refund / charge / session retrieval primitives. Dependency-injected — each
// takes a configured `stripe` client as its first arg (the package never
// constructs one). Plain ESM, so a direct re-export is safe here.
export {
    resolveSessionIdFromCharge,
    retrieveCharge,
    retrieveSessionWithPaymentIntent,
    createRefund,
} from './refunds.js';

// Product listing (autocomplete cache source) + price pre-flight. Both
// dependency-injected (stripe first arg). The consumer keeps its cache shape
// and the user-facing pre-flight copy; the package owns only the Stripe I/O.
export { listActiveProducts } from './products.js';
export { preflightPriceActive } from './prices.js';

// Coupons / promotion codes + customer lookup. Dependency-injected (stripe
// first arg). All discount math + display formatting stays in the Nous
// command; the apiVersion pin is a caller-side client-construction concern.
export { findPromotionCodeByCode, createCoupon, createPromotionCode } from './coupons.js';
export { listCustomersByEmail } from './customers.js';

// Stripe key mode detection (live/test/unknown). Imported as a CJS default
// (the module.exports object) then re-exported as named bindings. NB: a
// direct `export { … } from './stripe-mode.cjs'` works under plain Node but
// Vite/esbuild (vitest) mis-transforms a CJS *named* re-export and silently
// drops every export declared after it — so we destructure instead. CJS
// consumers still use the `@itzenzottv/stripe-bridge/stripe-mode` subpath.
import stripeMode from './stripe-mode.cjs';
const { detectMode, isLiveMode, isTestMode } = stripeMode;
export { detectMode, isLiveMode, isTestMode };
