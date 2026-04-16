import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        env: {
            DISCORD_BOT_TOKEN: 'test-token',
            STRIPE_SECRET_KEY: 'sk_test_fake',
        },
    },
});
