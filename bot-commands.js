/**
 * Bot Commands Reference — auto-synced to #bot-commands on startup.
 *
 * Each entry is an embed posted in order. On startup, the bot compares
 * existing embeds to this content and updates any that have changed.
 *
 * As of 2026-06-05 this reflects the Whatnot-era active set. Commerce
 * (checkout, shipping, refunds, coupons) happens on Whatnot, so the
 * Stripe-dependent commands (/hype /sell /list /sold /pull /coupon
 * /refund /waive /link /sync), shipping commands (/tracking /shipments
 * /shipping /shipping-audit /intl /intl-ship /dropped-off), and
 * queue-driven stream mechanics (/queue /duckrace /battle /snapshot
 * /capture) were deregistered — see scripts/register-slash-commands.mjs.
 * Their handlers remain reachable via /op if ever needed.
 */

const messages = [
    // Message 1: Header
    {
        title: '📖 Nous Command Reference',
        description: 'All commands at a glance. Type `/` in any channel and Discord will autocomplete.\n\nAll commands are Akivili-only. Every invocation is logged to `#ops-log` with timestamp + result.\n\nSelling happens on **Whatnot** — payments, shipping, and refunds are all handled there.',
        color: 0xceff00,
    },

    // Message 2: Stream
    {
        title: '🔴 Stream',
        description: [
            '**`/live`** — Go live. Posts a "Live on Whatnot" embed in `#announcements` with the watch link ([whatnot.com/user/itzenzottv](https://whatnot.com/user/itzenzottv)) and the itzenzo.tv catalog link.',
            '',
            '**`/offline`** — End the show. Posts show-ended in `#announcements` and a recap to `#analytics`.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 3: Giveaways
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

    // Message 4: Admin
    {
        title: '🔄 Admin',
        description: [
            '**`/reset`** — Wipe all bot data with detailed confirmation embed listing exactly what gets cleared (15 SQLite tables + WP queue + community goals reset). Confirm/Cancel buttons.',
            '',
            '**`/nous action:<text>`** — Bot self-management.',
            '',
            '**`/op <command-string>`** — Universal dispatcher for any legacy command without a native slash form (retired commands are still reachable here).',
            '> Example: `/op giveaway status`',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 5: Typical Stream Night Flow
    {
        title: '🔴 Typical Stream Night Flow',
        description: [
            '```',
            '/live                          → Announce the show in #announcements',
            '…run the show on Whatnot…       → Auctions, BINs, giveaways on-platform',
            '/giveaway start args:"Prize"   → Optional Discord-side giveaway',
            '/spin random                   → Draw the winner on stream',
            '/offline                       → Show-ended announcement + recap',
            '```',
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
            'Long-running commands (`/reset`) post both a started and completed entry, giving a heartbeat trace.',
            '',
            'Search `#ops-log` for "✗" to find failures, or a command name to find every run.',
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
