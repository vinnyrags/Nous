/**
 * Stripe CLI process helpers for the L3 service-integration suite.
 *
 * Wraps two CLI invocations:
 *   stripe listen    — long-running, forwards events to a local URL
 *   stripe trigger   — fires a test event into the user's Stripe test
 *                      account, which Stripe then delivers to the listen
 *                      tunnel (which forwards it to localhost)
 *
 * Pre-reqs:
 *   - `stripe` on PATH (Stripe CLI installed locally)
 *   - `stripe login` already run (we don't re-authenticate from tests)
 *
 * Tests that depend on this should skip themselves when the CLI isn't
 * available (e.g. `if (!isStripeCliAvailable()) test.skip(...)`).
 */

import { spawn, spawnSync, execFileSync } from 'node:child_process';

/**
 * Returns true if the `stripe` CLI is on PATH and authenticated.
 */
export function isStripeCliAvailable() {
    try {
        const res = spawnSync('stripe', ['config', '--list'], { encoding: 'utf8' });
        if (res.status !== 0) return false;
        // The output has `account_id = 'acct_...'` when authenticated.
        return /account_id\s*=\s*'/.test(res.stdout || '');
    } catch {
        return false;
    }
}

/**
 * Spawn `stripe listen --forward-to <forwardTo>` and capture the webhook
 * signing secret it prints to stderr. Returns:
 *   {
 *     signingSecret: 'whsec_...' (resolves once captured)
 *     stop()       — terminate the child process
 *   }
 *
 * The CLI prints the secret in a banner like:
 *   "Ready! You are using Stripe API Version [...]
 *    Your webhook signing secret is whsec_xxx (^C to quit)"
 *
 * We watch stdout/stderr until the secret appears, then resolve. The
 * spawned process keeps running so events forwarded by Stripe reach
 * `forwardTo` for the duration of the test.
 */
export async function startStripeListen(forwardTo, { events } = {}) {
    const args = ['listen', '--forward-to', forwardTo];
    if (events && events.length) {
        args.push('--events', events.join(','));
    }
    const child = spawn('stripe', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let resolved = false;
    let onSignal;
    const signingSecretPromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (!resolved) {
                cleanup();
                reject(new Error('Timed out waiting for stripe listen signing secret (10s)'));
            }
        }, 10_000);

        const onData = (chunk) => {
            const text = chunk.toString();
            const match = text.match(/(whsec_[A-Za-z0-9_]+)/);
            if (match && !resolved) {
                resolved = true;
                clearTimeout(timeout);
                resolve(match[1]);
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);

        child.once('exit', (code) => {
            if (!resolved) {
                clearTimeout(timeout);
                reject(new Error(`stripe listen exited (${code}) before printing signing secret`));
            }
        });
        onSignal = () => {
            if (!child.killed) child.kill('SIGTERM');
        };
    });

    function cleanup() {
        if (onSignal) onSignal();
    }

    const signingSecret = await signingSecretPromise;

    return {
        signingSecret,
        stop: () => new Promise((resolve) => {
            if (child.killed || child.exitCode !== null) return resolve();
            child.once('exit', () => resolve());
            child.kill('SIGTERM');
            // Belt-and-suspenders: SIGKILL after 3s if SIGTERM didn't take
            setTimeout(() => {
                if (child.exitCode === null) child.kill('SIGKILL');
            }, 3_000);
        }),
    };
}

/**
 * Synchronously fire `stripe trigger <event> [--override key=value ...]`.
 * Returns the CLI's stdout. Throws on non-zero exit.
 *
 * Stripe propagates the event to the configured webhook endpoints
 * (including the active `stripe listen` tunnel) — the local handler
 * receives a real Stripe-signed payload.
 */
export function triggerEvent(event, overrides = {}) {
    const args = ['trigger', event];
    for (const [key, value] of Object.entries(overrides)) {
        args.push('--override', `${key}=${value}`);
    }
    return execFileSync('stripe', args, { encoding: 'utf8' });
}
