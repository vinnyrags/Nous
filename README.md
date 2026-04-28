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
- `QUEUE_SOURCE` — `sqlite` (default, legacy local tables) or `wp` (WordPress as source of truth via `/shop/v1/queue/*`). Switch after running `scripts/migrate-queue-to-wp.js` and validating in staging — see [Queue cutover](#queue-cutover)

### Queue commands (during livestream)

- `!queue` — show the current queue
- `!queue open` / `!queue close` — open/close (mods only; usually automated by `!live` / `!offline`)
- `!queue history` — last five queues
- **`!queue next`** — advance the queue: completes the current "Now Serving" entry and promotes the oldest queued entry to active. Completed entries appear in the "Already opened" timeline above the active block on the homepage. Mods only. (Requires `QUEUE_SOURCE=wp` — the legacy SQLite path doesn't track entry status.)
- **`!queue skip <position>`** — god-mode jump to any entry by homepage position (1-based). Position 1 is the active entry, positions 2+ are queued in oldest-first order. The previous active goes back to queued (not completed) so nothing is lost. Mods only.
- `!duckrace` / `!duckrace start` / `!duckrace winner @user` — duck race roster + animation

### Pull-box commands (livestream)

Pull boxes are slot-based — each box has a finite number of numbered slots that buyers claim. WordPress is the source of truth (`wp_pull_boxes` + `wp_pull_box_slots`), Nous reads/writes via REST.

- `!pull v "Vintage Box" 100`  — open a v-tier ($1) box with 100 slots
- `!pull vmax "VMAX Box" 50`   — open a vmax-tier ($2) box with 50 slots
- `!pull "Box" 1.00 100`       — legacy syntax, tier inferred from price ($1→v, $2→vmax)
- `!pull replenish [v|vmax] 50` — add 50 slots without resetting claims
- `!pull close [v|vmax]`       — close (tier required only when both open)
- `!pull status`                — list active boxes

Homepage buyers pick specific slots via a modal grid. Discord buyers get a modal too — quantity input plus an optional comma-separated slot list (`17, 23, 41`); blank slots field auto-assigns the lowest open slots, filled-in slots are atomically pre-claimed through the same `/shop/v1/pull-box-checkout` endpoint the homepage uses. The on-stream embed in `#card-shop` shows a compact unicode slot grid (⬜ open, 🟪 claimed) that updates live as buys land.

## Structure

| Path | Purpose |
|------|---------|
| `index.js` | Entry point — initializes Discord client, registers commands, starts webhook server |
| `config.js` | Environment config loader, Discord channel and role IDs, pricing constants |
| `db.js` | SQLite schema and query layer (`better-sqlite3`) — purchases, queues (legacy, when `QUEUE_SOURCE=sqlite`), battles, card listings, pulls, giveaways, community goals |
| `lib/queue-source.js` | Adapter selector — switches all queue ops between `lib/sqlite-queue.js` and `lib/wp-queue.js` based on `QUEUE_SOURCE` env |
| `lib/queue-broadcaster.js` | SSE broadcaster — receives `queue.changed` webhook from WordPress and re-streams to all connected clients (the itzenzo.tv homepage Live Queue section) |
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
| `scripts/migrate-queue-to-wp.js` | One-shot migration of recent SQLite queues into the WordPress unified queue (`--limit=N`, `--dry-run`). Idempotent via external_ref. |

## Queue cutover

The queue (orders, pack battles, pull boxes, RTS) lived in local SQLite (`queues` + `queue_entries` tables). It now also lives in WordPress (`wp_queue_sessions` + `wp_queue_entries`), where it can be exposed to the itzenzo.tv homepage and admin tooling.

To migrate:

1. Run `node scripts/migrate-queue-to-wp.js --dry-run` and review output
2. Run `node scripts/migrate-queue-to-wp.js --limit=20` to copy recent sessions
3. Set `QUEUE_SOURCE=wp` in `/opt/nous-bot/.env` and restart the systemd service
4. Verify `!queue` and the itzenzo.tv homepage Live Queue section both show the same data

To roll back: set `QUEUE_SOURCE=sqlite` and restart. Local SQLite tables are still maintained alongside WP writes, so nothing is lost.

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
