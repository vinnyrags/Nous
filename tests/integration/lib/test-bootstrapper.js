/**
 * L3 service-integration — boot Nous's express server in test mode.
 *
 * Skips the Discord client login (no token / no IPC overhead). Discord-
 * touching handlers (sendEmbed, getMember) gracefully no-op when the
 * client isn't connected — handlers tolerate empty channel caches.
 *
 * Each call returns:
 *   { url, port, stop() }
 *
 * The caller is responsible for setting NOUS_DB_PATH and STRIPE_WEBHOOK_SECRET
 * BEFORE invoking this — db.js and config.js read them at module-load time.
 *
 * Why not import index.js? It calls client.login() at module top level, which
 * blocks on a real Discord connection and would prevent tests from running
 * without bot credentials. server.js exports a clean { app, startServer }
 * pair — we use those directly.
 */

import http from 'node:http';

let _serverInstance = null;
let _appModule = null;

/**
 * Boot the test Nous express server on a random ephemeral port. Returns
 * the running URL plus a stop() to dispose. Idempotent: calling twice
 * returns the same instance.
 */
export async function startTestNous() {
    if (_serverInstance) {
        return _serverInstance;
    }

    if (!_appModule) {
        // Dynamic import so process.env mutations made by the test setup
        // (NOUS_DB_PATH, STRIPE_WEBHOOK_SECRET) are honored when db.js
        // and config.js evaluate.
        _appModule = await import('../../../server.js');
    }

    const { app } = _appModule;
    const server = http.createServer(app);
    await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => resolve());
    });

    const port = server.address().port;
    const url = `http://127.0.0.1:${port}`;

    _serverInstance = {
        url,
        port,
        stop: () => new Promise((resolve) => {
            server.close(() => {
                _serverInstance = null;
                resolve();
            });
        }),
    };

    return _serverInstance;
}
