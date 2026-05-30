/**
 * Stripe key mode detection.
 *
 * Stripe keys are self-identifying via prefix:
 *   sk_test_… / pk_test_… / rk_test_…  → test mode
 *   sk_live_… / pk_live_… / rk_live_…  → live mode
 *
 * Anything else (missing, malformed, the bin/run-test-suite.mjs auto-stub)
 * is treated as 'unknown' so callers can decide what to do.
 *
 * CommonJS so both ESM (bin/, lib/, package index) and CJS (scripts/shop/)
 * consumers can import it. Modern Node lets ESM use named imports of CJS
 * files. Exposed from the package as the `@itzenzottv/stripe-bridge/stripe-mode`
 * subpath; Nous keeps a thin re-export shim at lib/stripe-mode.cjs for back-compat.
 */

'use strict';

function detectMode(key) {
    if (typeof key !== 'string' || key.length === 0) return 'unknown';
    if (/^[a-z]+_live_/.test(key)) return 'live';
    if (/^[a-z]+_test_/.test(key)) return 'test';
    return 'unknown';
}

function isLiveMode(key) { return detectMode(key) === 'live'; }
function isTestMode(key) { return detectMode(key) === 'test'; }

module.exports = { detectMode, isLiveMode, isTestMode };
