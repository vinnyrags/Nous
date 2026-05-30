/**
 * Pure decision logic for the Stripe kill switch (Whatnot pivot).
 *
 * Kept free of fs / process so it is unit-testable in isolation —
 * config.js performs the actual env read + file reads and feeds the
 * results in here.
 */

/**
 * Interpret an explicit STRIPE_ENABLED env-var value.
 *
 * Truthy unless it explicitly reads false-y (`false` / `0` / empty).
 * Case- and whitespace-insensitive.
 *
 * @param {string|undefined} raw
 * @returns {boolean|undefined} undefined when the var is unset
 */
export function parseEnvFlag(raw) {
    if (raw === undefined || raw === null) {
        return undefined;
    }
    const v = String(raw).trim().toLowerCase();
    return v !== 'false' && v !== '0' && v !== '';
}

/**
 * Extract `define('STRIPE_ENABLED', true|false)` from a wp-config file's
 * contents.
 *
 * @param {string} contents
 * @returns {boolean|undefined} undefined when the define is absent
 */
export function parseWpConfigFlag(contents) {
    if (typeof contents !== 'string') {
        return undefined;
    }
    const match = contents.match(/define\('STRIPE_ENABLED',\s*(true|false)\)/);
    if (!match) {
        return undefined;
    }
    return match[1] === 'true';
}

/**
 * Resolve the effective flag from the env value and an ordered list of
 * candidate wp-config file contents.
 *
 * Precedence: env var → first wp-config define found → default true
 * (backward-compatible: only an explicit `false` anywhere parks Stripe).
 *
 * @param {object} opts
 * @param {string|undefined} opts.envValue   process.env.STRIPE_ENABLED
 * @param {Array<string|null|undefined>} [opts.fileContents] wp-config bodies, in priority order
 * @returns {boolean}
 */
export function resolveStripeEnabled({ envValue, fileContents = [] } = {}) {
    const fromEnv = parseEnvFlag(envValue);
    if (fromEnv !== undefined) {
        return fromEnv;
    }

    for (const contents of fileContents) {
        const fromFile = parseWpConfigFlag(contents);
        if (fromFile !== undefined) {
            return fromFile;
        }
    }

    return true;
}
