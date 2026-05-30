import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        env: {
            DISCORD_BOT_TOKEN: 'test-token',
            STRIPE_SECRET_KEY: 'sk_test_fake',
            // The suite verifies live checkout behavior, so the test world
            // is Stripe-enabled. Explicit here so the kill-switch resolver
            // (config.js) never falls through to reading the sibling
            // wp-config-env.php, whose value varies by environment. The
            // parked-mode resolver logic is covered by stripe-flag.test.js.
            STRIPE_ENABLED: 'true',
        },
    },
});
