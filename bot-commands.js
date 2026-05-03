/**
 * Bot Commands Reference — auto-synced to #bot-commands on startup.
 *
 * Each entry is an embed posted in order. On startup, the bot compares
 * existing embeds to this content and updates any that have changed.
 *
 * As of 2026-05-03 this reflects the slash-command model. Legacy `!command`
 * text dispatcher was removed in commit 5b27918. All ops commands are
 * Akivili-only via Discord permissions; /link is the only user-facing one.
 */

const messages = [
    // Message 1: Header
    {
        title: '📖 Nous Command Reference',
        description: 'All commands at a glance. Type `/` in any channel and Discord will autocomplete.\n\nAll commands except `/link` are Akivili-only. Every invocation is logged to `#ops-log` with timestamp + result.',
        color: 0xceff00,
    },

    // Message 2: Master Commands
    {
        title: '🎛️ Master Commands',
        description: [
            '**`/hype products:<list>`** — Pre-stream hype. Looks up products in Stripe, shows a preview with prices (detects sales), posts a hype embed to `#announcements` with Buy Now buttons. Drops raw checkout URLs in `#ops` for socials. React ✅ to confirm.',
            '> Example: `/hype products:Prismatic Evolutions Booster Box, Crown Zenith ETB`',
            '',
            '**`/live`** — Go live. Posts pre-order summary, starts livestream session, posts shop link in `#announcements`.',
            '',
            '**`/offline`** — End stream. Closes livestream session, ensures a queue is open for pre-orders, posts stream-ended in `#announcements`, posts stream recap to `#analytics`.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 3: Pack Battles
    {
        title: '⚔️ Pack Battles',
        description: [
            '**`/battle start product:<name> max:<int>`** — Start a battle. Bot searches Stripe for the product, posts embed with Buy Pack button to `#pack-battles`. No shipping at buy-in — only the winner pays. Default 20 max entries (capped at 50). Auto-closes when full.',
            '> Example: `/battle start product:Prismatic Evolutions max:12`',
            '',
            '**`/battle status`** — Show current battle.',
            '',
            '**`/battle close`** — Close entries, update original embed to CLOSED.',
            '',
            '**`/battle cancel`** — Cancel the battle, notify entrants.',
            '',
            '**`/battle winner user:<@user>`** — Declare winner. Assigns Aha role, cross-posts to `#announcements`. DMs winner shipping link if not already covered.',
            '',
            '*Only one battle can be active at a time. Close or cancel before starting a new one. One entry per user.*',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 4: Queue & Duck Race
    {
        title: '🦆 Queue & Duck Race',
        description: [
            '**`/queue open`** — Open a new pre-order queue (auto-opened by `/offline`).',
            '',
            '**`/queue close`** — Close queue, update `#queue` embed (auto-closed by `/offline`).',
            '',
            '**`/queue history`** — Show last 5 queues with winners.',
            '',
            '**`/queue next`** — Advance to the next queue entry on stream.',
            '',
            '**`/queue skip`** — Skip the current entry.',
            '',
            '**`/duckrace show`** — Show duck race roster (1 entry per unique buyer from queue).',
            '',
            '**`/duckrace start`** — Run animated duck race in `#queue`. Random winner, Aha role, announcements. (Mods + Akivili)',
            '',
            '**`/duckrace winner user:<@user>`** — Manual winner (skip animation). Assign Aha role, announce.',
            '',
            '**`/duckrace pick user:<@user>`** — Owner-only: rig the race outcome before running.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 5: Card Shop
    {
        title: '🃏 Card Shop',
        description: [
            '**`/sell args:<text>`** — List a card for sale. The argument string accepts the same shape as the legacy `!sell` syntax — `"Card Name" 25.00` for an open listing, `@buyer "Card Name" 25.00` to reserve for a specific viewer (30-min reservation).',
            '> Examples:',
            '> `/sell args:"Charizard Holo" 50.00`',
            '> `/sell args:@vinnyrags "Pikachu Promo" 25.00`',
            '',
            '**`/list open`** — Open a new batch card list session. Posts a summary embed in `#card-shop` that updates in real-time.',
            '',
            '**`/list add args:<card details>`** — Add a card to the active list. Summary embed updates with a dropdown menu for buyers.',
            '> Example: `/list add args:"Charizard EX" 75.00`',
            '',
            '**`/list close`** — Close the active list. Unsold items expire and the dropdown is removed.',
            '',
            '**`/sold args:<message_id>`** — Manually mark a listing as sold. Auto-marked on Stripe payment.',
            '',
            '**`/pull open args:"Name" <price> [max]`** — Open a pull box in `#card-shop`. Posts a Buy Pull button. Optional max sets a stock cap. Auto-closes when sold out.',
            '> Example: `/pull open args:"Mystery Pull Box" 3.00 50`',
            '',
            '**`/pull close`** — Close the active pull box. Shows final count and revenue.',
            '',
            '**`/pull status`** — Show active pull box info (pulls sold, revenue).',
            '',
            '**`/pull replenish args:<count>`** — Add more slots to an active pull box.',
            '',
            '*Card name in quotes for any args field. Prices in dollars. Shipping: $10 US / $25 international (waived if covered).*',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 5b: Card Catalog Requests
    {
        title: '🗃️ Card Catalog Requests',
        description: [
            'Shoppers hit **Request to See on Stream** on any card at itzenzo.tv/cards. Their request lands in `#ops` as a new embed and lives in the WordPress `wp_card_view_requests` table.',
            '',
            '**`/requests mode:<pending|all|recent>`** — List card requests. Default is `pending`.',
            '',
            '**`/request action:<next|shown|skip> [id:<int>]`** — Act on a single request:',
            '> `/request action:next` — show the oldest pending request (no id needed)',
            '> `/request action:shown id:42` — mark request 42 shown after you feature it',
            '> `/request action:skip id:42` — skip (sold out, bad match, etc.)',
            '',
            '*Request rows are for catalog cards. Ad-hoc graded/vintage sales still go through `/sell` / `/list`.*',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 6: Giveaways
    {
        title: '🎁 Giveaways',
        description: [
            '**`/giveaway start args:"Prize" [duration] [social] [url]`** — Start a giveaway with Enter button in `#giveaways`. Add `social` for TikTok engagement giveaways. Add a TikTok URL to link the post.',
            '> Examples:',
            '> `/giveaway start args:"ETB" 48h`',
            '> `/giveaway start args:"ETB" social https://tiktok.com/...`',
            '',
            '**`/giveaway status`** — Show current giveaway.',
            '',
            '**`/giveaway close`** — Close entries, update embed + announce in `#announcements`. Auto-closes when duration expires.',
            '',
            '**`/giveaway cancel`** — Cancel the giveaway.',
            '',
            '**`/spin random`** — Animated wheel spin to draw winner. ~30 sec. Assigns Aha role, announces.',
            '',
            '**`/spin pick user:<@user>`** — Owner-only: rig the giveaway outcome.',
            '',
            '*Verified members (Xipe role) can enter giveaways. One entry per person. Entry roster shows Discord + TikTok username (social mode). Social copy posted to `#ops`.*',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 7: Analytics
    {
        title: '📊 Analytics',
        description: [
            '**`/snapshot`** — Post a snapshot of the current month to `#analytics`. Revenue, orders, buyers (new vs returning), stream count, avg per stream, top products, community goal state.',
            '',
            '**`/snapshot action:march`** — Snapshot for a specific month (current year).',
            '',
            '**`/snapshot action:2026`** — Snapshot for a full year.',
            '',
            '**`/snapshot action:"march 2026"`** — Snapshot for a specific month and year.',
            '',
            '*Stream recaps are posted automatically to `#analytics` when `/offline` runs.*',
            '',
            '**`/capture`** — Log a moment timestamp to `#moments` for later clipping.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 8: Tracking, Shipping, Refunds
    {
        title: '📦 Tracking + Shipping',
        description: [
            '**`/tracking lookup ref:<order or session id>`** — Look up tracking by reference.',
            '',
            '**`/tracking list`** — Show all pending tracking entries.',
            '',
            '**`/tracking clear`** — Clear all tracking data (post-delivery cleanup).',
            '',
            '**`/dropped-off`** — Weekly domestic shipping notification. DMs every domestic buyer with unshipped orders + tracking. Posts "Orders Shipped" in `#order-feed`.',
            '',
            '**`/dropped-off intl:true`** — Monthly international shipping notification.',
            '',
            '**`/shipments list`** — List pending orders awaiting labels.',
            '**`/shipments status`** — Status summary.',
            '**`/shipments ready`** — Orders with labels/tracking ready for drop-off.',
            '',
            '**`/intl show`** — Show current intl-flagged buyers.',
            '**`/intl list`** — List all intl buyers.',
            '',
            '**`/intl-ship`** — Month-end: DM intl buyers with unpaid shipping this month.',
            '',
            '**`/shipping-audit`** — Verify all shipping collected.',
            '',
            '**`/waive user:<@user>`** — Waive shipping for a buyer. Refunds via Stripe if already paid this period; otherwise inserts a $0 waiver.',
            '',
            '**`/refund full session:<session_id>`** — Refund a Stripe session in full.',
            '',
            '**`/refund partial session:<session_id> amount:<cents>`** — Partial refund.',
            '',
            '**`/shipping`** + **`/intl`** + **`/tracking`** + **`/nous`** with free-form `args:` — for ad-hoc invocations matching the legacy syntax.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 9: Coupons
    {
        title: '🏷️ Coupons',
        description: [
            '**`/coupon create amount:<cents>`** — Create a Stripe coupon with the given discount.',
            '',
            '**`/coupon off`** — Disable the active coupon.',
            '',
            '**`/coupon status`** — Show currently active coupon.',
            '',
            '*The promo code field is always visible at checkout. For announcing a code in `#announcements`, use `/op coupon <CODE>`.*',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 10: Sync + Reset + Admin
    {
        title: '🔄 Sync, Reset, Admin',
        description: [
            '**`/sync`** or **`/sync mode:full`** — Full pipeline: Google Sheets → Stripe → WordPress. Deactivates stale products. Posts summary in `#ops`.',
            '',
            '**`/sync mode:stripe`** — Stripe → WordPress only. Faster.',
            '',
            '**`/reset`** — Wipe all bot data with detailed confirmation embed listing exactly what gets cleared (15 SQLite tables + WP queue + community goals reset). Confirm/Cancel buttons. Auto-runs `/sync` after wipe.',
            '',
            '**`/nous action:<text>`** — Bot self-management.',
            '',
            '**`/op <command-string>`** — Universal dispatcher for any legacy command without a native slash form.',
            '> Example: `/op refund @user 10.00 Wrong product`',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 11: User-facing
    {
        title: '🔗 User Commands',
        description: [
            '**`/link email:<your email>`** — (Anyone) Link your email to your Discord ID for purchase tracking. Validates via Stripe. Use the same email you used at checkout.',
            '> Example: `/link email:you@example.com`',
            '',
            '*Account linking also happens automatically at checkout when a Discord username is provided. `/link` is the manual fallback.*',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 12: Typical Stream Night Flow
    {
        title: '🔴 Typical Stream Night Flow',
        description: [
            '```',
            '/hype products:Product 1, Product 2  → Pre-stream hype (✅ to confirm)',
            '/live                                 → Go live (queue stays open)',
            '/sell args:@buyer "Card" 25.00       → Reserve a card for a viewer',
            '/list open                            → Open a batch card list',
            '/list add args:"Card" 25.00          → Add card to the list',
            '/list close                           → Close, expire unsold',
            '/coupon create amount:1000            → Create $10-off coupon',
            '/coupon off                           → Deactivate when window ends',
            '/battle start product:"Name" max:12  → Start pack battle',
            '/battle close                         → Close entries',
            '/battle winner user:@user             → Declare winner',
            '/duckrace show                        → Show duck race roster',
            '/duckrace start                       → Run animated duck race',
            '/spin random                          → Animated giveaway draw',
            '/capture                              → Log moment to #moments',
            '/offline                              → Close queue, post recap',
            '/tracking lookup ref:cs_xxx           → Look up tracking',
            '/dropped-off                          → Weekly: notify + mark shipped',
            '/snapshot                             → Anytime: analytics snapshot',
            '```',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 13: Shipping Model
    {
        title: '📦 Shipping Model',
        description: [
            '**Two tiers, two cadences:**',
            '• **Domestic (US):** $10 flat rate, collected weekly (Mon–Sun)',
            '• **International (CA+):** $25 flat rate, collected monthly',
            '',
            'Coverage is per-period — one payment covers all purchases for the week (domestic) or month (international). The bot checks before every checkout.',
            '',
            '**Delivery estimates:** 5-7 business days (domestic), 7-14 days (international).',
            '',
            '**Tracking:** ShippingEasy webhook auto-imports tracking when labels are purchased. Included in `/dropped-off` DMs. Label purchases post to `#shipping-labels`.',
            '',
            '**Waiver:** `/waive user:<@user>` pre-waives or refunds + removes shipping.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message: Audit Log
    {
        title: '📋 Audit Log',
        description: [
            'Every slash command invocation lands in `#ops-log` as a structured embed:',
            '',
            '> ▶ `/command` — started (blue) with operator + args',
            '> ✓ `/command` — completed (green) with duration',
            '> ✗ `/command` — failed (red) with error + duration',
            '',
            'Long-running commands (`/reset`, `/sync`) post both a started and completed entry, giving a heartbeat trace.',
            '',
            'Search `#ops-log` for "ran /sync" to find every sync this stream, "✗" for failures, etc.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message: Minecraft Realms
    {
        title: '🟢 Minecraft Realms — React-for-DM Invites',
        description: [
            (process.env.DISCORD_MINECRAFT_CHANNEL_ID ? `<#${process.env.DISCORD_MINECRAFT_CHANNEL_ID}>` : '`#minecraft`') + ' is bot-managed. A persistent embed pinned by Nous lists three realms with reaction emojis:',
            '',
            '> 🪓 — **Java Hardcore Survival** (whitelist required)',
            '> 👻 — **Bedrock Horror Survival**',
            '> 🎨 — **Bedrock Creative**',
            '',
            '**Bedrock realms (👻 + 🎨)** — react and the bot DMs you the realm invite URL. Your reaction is removed so you can re-react later.',
            '',
            '**Java Hardcore (🪓)** — react and the bot DMs you a button to submit your Minecraft Java username. On submit, Nous posts a whitelist request to `#ops`. Vincent adds you to the realm whitelist manually.',
            '',
            'Realm codes / IPs never appear in the channel — they live in the bot\'s env.',
            '',
            '*If your DMs are closed, the bot can\'t deliver. Open them via Server → Privacy Settings → "Direct Messages from server members" and react again.*',
        ].join('\n'),
        color: 0xceff00,
    },
];

export default messages;
