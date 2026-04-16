/**
 * Configuration — reads from environment variables or wp-config-env.php.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function readPhpDefine(name) {
    const configPath = path.resolve(__dirname, '../wp-config-env.php');
    try {
        const contents = fs.readFileSync(configPath, 'utf8');
        const match = contents.match(
            new RegExp(`define\\(\\s*'${name}'\\s*,\\s*'([^']*)'\\s*\\)`)
        );
        return match ? match[1] : null;
    } catch {
        return null;
    }
}

function required(name) {
    const value = process.env[name] || readPhpDefine(name);
    if (!value) {
        console.error(`Missing required config: ${name}`);
        process.exit(1);
    }
    return value;
}

function optional(name, fallback = null) {
    return process.env[name] || readPhpDefine(name) || fallback;
}

export default {
    // Discord
    DISCORD_BOT_TOKEN: required('DISCORD_BOT_TOKEN'),
    GUILD_ID: '862139045974638612',

    // Stripe
    STRIPE_SECRET_KEY: required('STRIPE_SECRET_KEY'),
    STRIPE_WEBHOOK_SECRET: optional('STRIPE_BOT_WEBHOOK_SECRET'),

    // Twitch
    TWITCH_CLIENT_ID: optional('TWITCH_CLIENT_ID'),
    TWITCH_CLIENT_SECRET: optional('TWITCH_CLIENT_SECRET'),
    TWITCH_WEBHOOK_SECRET: optional('TWITCH_WEBHOOK_SECRET'),
    TWITCH_BROADCASTER_ID: optional('TWITCH_BROADCASTER_ID'),

    // Server
    PORT: parseInt(process.env.BOT_PORT || '3100', 10),
    SHOP_URL: optional('SHOP_URL', 'https://vincentragosta.io/shop'),
    SITE_URL: optional('SITE_URL', 'https://vincentragosta.io'),
    LIVESTREAM_SECRET: optional('LIVESTREAM_SECRET', 'itzenzo-live'),

    // Channel IDs
    CHANNELS: {
        ANNOUNCEMENTS: '862806276639293510',
        ORDER_FEED: '1488041099816734760',
        DEALS: '1488041098751381524',
        PACK_BATTLES: '1488041101326811158',
        POKEMON: '1488041103348465757',
        ANIME: '866726650526957598',
        MATURE_DROPS: '1488041112038805717',
        AND_IN_THE_BACK: '862825014515335210',
        QUEUE: '1489147026598920192',
        WELCOME: '898715514086498324',
        MOD_LOG: '862800551476854825',
        CARD_SHOP: '1488977861237801231',
        OPS: '1489048966019682376',
        BOT_COMMANDS: '1488659446589816842',
        COMMUNITY_GOALS: '1489442566654132254',
        ANALYTICS: '1489498346812080230',
        LIVESTREAM_FLOW: '1489009286066733136',
        DEV_LOG: '1489513907025346630',
        GIVEAWAYS: '1489502926195003532',
        MOMENTS: '1493307443084787984',
    },

    SHIPPING: {
        COUNTRIES: ['US', 'CA'],
        DOMESTIC: 1000,         // $10
        INTERNATIONAL: 2500,    // $25
    },
    CARD_RESERVATION_MS: 30 * 60 * 1000,

    // Role IDs
    ROLES: {
        AKIVILI: '1488046525065072670',
        NANOOK: '1488046525899739148',
        LONG: '1488046526940053607',
        AHA: '1488046527627919451',
        XIPE: '898717442803642429',
        YAOSHI: '1488046530295496824',
        IX: '1488046531000008710',
        ENA: '1488046532358967297',
    },

    // Thresholds
    LOW_STOCK_THRESHOLD: 3,
    LONG_PURCHASE_THRESHOLD: 5,
    XIPE_PURCHASE_THRESHOLD: 1,
};
