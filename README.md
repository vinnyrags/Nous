# Nous

Discord bot for the itzenzoTTV trading card business. Powers order notifications, pack battles, card shop listings, queue management, livestream flow, Stripe payment integration, the `#minecraft` react-for-invite hub, the `/cards/` catalog Request-to-See queue, and community engagement mechanics.

Named after the Aeon of Erudition from Honkai: Star Rail.

## Stack

- Node.js 20+ (ES modules)
- [discord.js](https://discord.js.org/) 14
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) for persistence
- Express for Stripe/Twitch webhook endpoints
- Stripe SDK
- Vitest for testing

## Setup

```bash
npm install
cp .env.example .env
# fill in DISCORD_BOT_TOKEN, STRIPE_SECRET_KEY, etc.
npm run dev     # watch mode
npm start       # production mode
npm test        # run the test suite
```

## Configuration

All secrets load from environment variables (via `dotenv` in development, systemd `EnvironmentFile` in production). See `.env.example` for the full list.

Key variables:
- `DISCORD_BOT_TOKEN` — Discord bot auth
- `STRIPE_SECRET_KEY`, `STRIPE_BOT_WEBHOOK_SECRET` — payments and webhook verification
- `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`, `TWITCH_WEBHOOK_SECRET`, `TWITCH_BROADCASTER_ID` — stream online/offline events
- `SHIPPINGEASY_API_KEY`, `SHIPPINGEASY_API_SECRET` — order/shipment sync
- `DISCORD_MINECRAFT_CHANNEL_ID` — channel ID for the react-for-invite embed
- `MINECRAFT_BEDROCK_HORROR_INVITE`, `MINECRAFT_BEDROCK_CREATIVE_INVITE` — realm invite URL the bot DMs the user when they react with the matching Bedrock emoji
- `MINECRAFT_JAVA_INVITE` — intro text that appears above the Java whitelist button in the DM. Java Realms don't expose shareable URLs, so reacting 🪓 DMs an intro + button → modal → `#ops` whitelist request (pings Akivili). Vincent adds the submitted Minecraft Java username to the Realm allowlist manually.
- `BOT_PORT` — Express webhook server port (default 3100)
- `SHOP_URL`, `SITE_URL`, `LIVESTREAM_SECRET` — public URLs and livestream toggle secret

## Structure

| Path | Purpose |
|------|---------|
| `index.js` | Entry point — initializes Discord client, registers commands, starts webhook server |
| `config.js` | Environment config loader, Discord channel and role IDs, pricing constants |
| `db.js` | SQLite schema and query layer (`better-sqlite3`) — purchases, queues, battles, card listings, pulls, giveaways, community goals |
| `discord.js` | Discord client helpers — channel sends, DMs, embeds |
| `server.js` | Express webhook endpoints (Stripe, Twitch) |
| `shipping.js` | Shipping calculation — flat-rate domestic and international |
| `shippingeasy-api.js` | ShippingEasy REST API client |
| `community-goals.js` | Community goal tracking and progress updates |
| `livestream-flow.js` | Card night flow orchestration — queue open, battles, duck races, stream end |
| `notify-deploy.js` | Deploy status notifications to `#dev-log` |
| `commands/` | Message command handlers (`!sell`, `!battle`, `!queue`, `!requests`/`!request`, etc.) plus auto-managed channel embeds (`welcome.js`, `minecraft.js`, `lfg.js`) |
| `webhooks/` | Stripe, Twitch, ShippingEasy, and card-request webhook handlers |
| `alerts/` | New-product alerts and channel messaging |
| `scripts/` | Operational scripts (see below) |
| `tests/` | Vitest test suite |

## Operational Scripts

| Script | Purpose |
|--------|---------|
| `scripts/shop/push-products.js` | Sync Google Sheets product data → Stripe |
| `scripts/pull-products.php` | Sync Stripe products → WordPress (runs via `wp eval-file` on the server) |
| `scripts/shop/push-cards.js` | Sync Google Sheets `Singles` tab → Stripe (card catalog) |
| `scripts/shop/enrich-singles.js` | Backfill Set/Rarity/Image/Artist via the Pokemon TCG API |
| `scripts/shop/backup-singles.js` | Duplicate the `Singles` tab before a risky enrichment/sync run |
| `scripts/shop/setup-sheet.js` | Bootstrap the Google Sheets structure |
| `scripts/shop/discord-audit.js` | Audit Discord roles/permissions |
| `scripts/shop/discord-security.js` | Security lockdown helpers |
| `scripts/shop/discord-migrate.js` | Bulk Discord structure migrations |
| `scripts/shop/create-test-products.js` | Seed test products in Stripe |

## Deployment

Deploys to DigitalOcean (174.138.70.29) via a bare git repo at `/var/repo/Nous.git`:

```bash
git push production main
```

The post-receive hook runs `npm ci`, executes the test suite, and restarts the systemd service on success. Tests gate the restart — if they fail, the previous version keeps running and a Discord alert is posted to `#dev-log`.

**Deploy paths:** `/opt/nous-bot/` (production), running as the `nous-bot` systemd service. Configuration lives at `/opt/nous-bot/.env`. The SQLite database persists at `/opt/nous-bot/data.db`.

**Port:** The bot listens on port 3100 for webhook traffic, proxied through Nginx at `/bot/*` on `vincentragosta.io`.

## Context

The bot was previously part of the [vincentragosta.io](https://github.com/vinnyrags/vincentragosta.io) WordPress repository and was extracted into this standalone repo for independent deployment and lifecycle. The WordPress site continues to act as the product catalog and Stripe integration backend; this bot layers real-time Discord community mechanics on top of it.
