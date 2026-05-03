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
- `STRIPE_DELETE_WHEN_REMOVING` — `true` (default) deletes Stripe products on `push-products.js --clean` / `push-cards.js --clean` so archived rows don't accumulate and silently break checkouts. Set to `false` before going live so prices with payment history aren't blocked from delete (Stripe rejects deleting anything with charges; the script falls back to archive automatically when it has to)

### Slash commands

All ops commands run as Discord slash commands as of 2026-05-03 (Akivili-only via Discord permissions + runtime role check). The legacy `!command` text dispatcher was removed in commit `5b27918`. See `bot-commands.js` for the full reference embed (auto-synced to `#bot-commands`).

**Queue & duck race (during livestream):**
- `/queue open` / `/queue close` — open/close (usually automated by `/live` and `/offline`)
- `/queue history` — last five queues
- `/queue next` — advance the queue: completes the current "Now Serving" entry, promotes the oldest queued entry to active. Completed entries appear on the homepage timeline. Requires `QUEUE_SOURCE=wp`.
- `/queue skip` — god-mode skip the current entry (returns to queued, not completed)
- `/duckrace show` / `/duckrace start` / `/duckrace winner user:<@user>` — roster + animation
- `/duckrace pick user:<@user>` — owner-only rig before running

**Pull boxes (livestream):**

Pull boxes are slot-based — each box has a finite number of numbered slots that buyers claim. WordPress is the source of truth (`wp_pull_boxes` + `wp_pull_box_slots`), Nous reads/writes via REST.

- `/pull open` — opens a pull box; pass tier + name + max in `args:` (e.g. `args:v "Vintage Box" 100`, or legacy `args:"Box" 1.00 100`)
- `/pull replenish` — adds slots without resetting claims (`args:v 50`)
- `/pull close` — closes the active box (`args:v` or `args:vmax` if both open)
- `/pull status` — lists active boxes

For ad-hoc invocations matching the legacy syntax (free-form args), use `/op pull ...`.

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
| `commands/` | Slash command handlers in commands/slash/ (universal `/op`, native `/queue`, `/battle`, `/reset`, etc.) plus legacy text-mode handlers (one per command file) that the slash framework wraps via the synthetic-message factory plus auto-managed channel embeds (`welcome.js`, `minecraft.js`, `lfg.js`) |
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
| `scripts/shop/audit-stripe-active.js` | Find WP catalog posts that reference inactive (archived/deleted) Stripe products. `--apply` sets stock=0 + clears stale `stripe_price_id`/`stripe_product_id` meta. `--local` skips the SSH wrap when the script runs on the box itself. Belt for the pre-flight + webhook layers; useful as a nightly cron. |
| `scripts/migrate-queue-to-wp.js` | One-shot migration of recent SQLite queues into the WordPress unified queue (`--limit=N`, `--dry-run`). Idempotent via external_ref. |

## Catalog drift defense (Stripe ↔ WP)

A buyer adding an item whose `stripe_product_id` points at a Stripe
product that has since been archived or deleted will hit a checkout
failure: Stripe refuses to create a session if any line item references
an inactive product. To prevent that, the system layers four pieces:

1. **Push scripts delete instead of archive** — `push-products.js
   --clean` and `push-cards.js --clean` hard-delete Stripe products
   (env-gated by `STRIPE_DELETE_WHEN_REMOVING`) so re-syncs don't leave
   archived rows for catalog references to point at later. Falls back
   to archive automatically when Stripe rejects delete (live mode +
   payment history).
2. **Stripe webhook → real-time WP cleanup** — `server.js` handles
   `product.updated` (active true→false), `product.deleted`,
   `price.updated`, and `price.deleted` events. Each calls
   `notifyCatalogProductDeactivated()` which POSTs to WP's
   `/shop/v1/catalog/stripe-product-deactivated` endpoint. WP sets
   `stock_quantity=0` on every catalog post that references the now-dead
   `stripe_product_id` and clears the stale meta. **Requires the four
   events to be subscribed on the Stripe webhook endpoint** (Dashboard →
   Developers → Webhooks → your endpoint → Add events).
3. **Pre-flight in CreateCheckoutEndpoint** — checkout asks Stripe
   directly whether each priceId is active before decrementing stock or
   creating a session. Backstop for any window between (1) and (2).
4. **Friendly catch in CreateCheckoutEndpoint** — if Stripe still rejects
   the session create call, the catch block parses the offending priceId
   out of the message, sets stock=0, and returns a 409 naming the bad
   item ("Mewtwo #XY101 is no longer available — please remove…").

`scripts/shop/audit-stripe-active.js` is a manual sweep that catches
anything (1)–(4) miss. Run periodically (cron candidate — see
vincentragosta.io's `TODO.md`).

## Queue cutover

The queue (orders, pack battles, pull boxes, RTS) lived in local SQLite (`queues` + `queue_entries` tables). It now also lives in WordPress (`wp_queue_sessions` + `wp_queue_entries`), where it can be exposed to the itzenzo.tv homepage and admin tooling.

To migrate:

1. Run `node scripts/migrate-queue-to-wp.js --dry-run` and review output
2. Run `node scripts/migrate-queue-to-wp.js --limit=20` to copy recent sessions
3. Set `QUEUE_SOURCE=wp` in `/opt/nous-bot/.env` and restart the systemd service
4. Verify `/queue history` and the itzenzo.tv homepage Live Queue section both show the same data

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
