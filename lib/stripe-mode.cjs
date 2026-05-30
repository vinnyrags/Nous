/**
 * Back-compat shim — the canonical implementation moved into
 * @itzenzottv/stripe-bridge (Whatnot pivot Phase 1 extraction).
 *
 * Kept as a CommonJS re-export so the existing import sites continue to work
 * unchanged across both module systems:
 *   - CJS  `require('../../lib/stripe-mode.cjs')`  (scripts/shop/*)
 *   - ESM  `import { … } from '../lib/stripe-mode.cjs'`  (bin/, tests/)
 *
 * New code should import from the package directly:
 *   `require('@itzenzottv/stripe-bridge/stripe-mode')` or
 *   `import { detectMode } from '@itzenzottv/stripe-bridge'`.
 */

'use strict';

module.exports = require('@itzenzottv/stripe-bridge/stripe-mode');
