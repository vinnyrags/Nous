/**
 * #how-it-works Reference — auto-synced to #how-it-works on startup.
 *
 * Customer-facing payment, shipping, and refund explanation. Each entry
 * becomes one embed posted in order. The bot compares existing embeds to
 * this content and edits any that have changed (see sync-bot-commands.js).
 *
 * Whatnot-era copy (2026-06-04): live commerce runs on Whatnot, itzenzo.tv
 * is the catalog + Request-to-See surface, on-site checkout is paused.
 * Canonical policy context lives in akivili/business/whatnot-first-strategy.md
 * and discord.md; keep these in sync when policy changes.
 */

const messages = [
    // Message 1: Overview
    {
        title: '💳 How Buying Works',
        description: [
            'We sell Pokemon and anime TCG product — sealed and hand-inspected raw singles — **live on Whatnot** at [whatnot.com/user/itzenzottv](https://whatnot.com/user/itzenzottv).',
            '',
            'The full singles catalog is browseable anytime at [itzenzo.tv/cards](https://itzenzo.tv/cards), with condition shown right on each listing.',
            '',
            '_Have a question this doesn\'t cover? DM the shop owner directly — that always reaches me._',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 2: Buying on Whatnot
    {
        title: '🛒 Buying on Whatnot',
        description: [
            '**During a live show**',
            'Shows run on **Whatnot** — $1-start singles auctions, sealed pack openings, and big vintage hits. Going-live links are posted in the announcements channel before every show. Follow [itzenzottv on Whatnot](https://whatnot.com/user/itzenzottv) and the app notifies you too.',
            '',
            '**Between shows**',
            'The [Whatnot shop](https://whatnot.com/user/itzenzottv/shop) stays open with Buy-it-Now sealed product and singles. Browse the full catalog at [itzenzo.tv/cards](https://itzenzo.tv/cards) to see everything we have, then grab it on Whatnot or ask about it on the next show.',
            '',
            '**Payments and buyer protection**',
            'Whatnot handles checkout, payment processing, and buyer protection on every order. We never see or store your payment details.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 3: Singles catalog + Request to See
    {
        title: '🃏 Singles Catalog & Request to See',
        description: [
            '**The catalog**',
            'Every raw single is hand-inspected, with condition (NM, LP, MP, HP, DMG) shown in the corner of the listing at [itzenzo.tv/cards](https://itzenzo.tv/cards).',
            '',
            '**Not sure about a card?**',
            'Hit **Request to See** on the listing and we\'ll feature the card on the next live show — edges, surface, centering, and holo shift in real time before you commit to anything. No purchase required.',
            '',
            '**Pack battles**',
            'Competitive multi-buyer pack openings now run on Whatnot using their native Group Break tooling — watch the announcements channel for when one is on the schedule.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 4: Shipping
    {
        title: '📦 Shipping & 🌍 International',
        description: [
            '**Whatnot orders**',
            'Shipping is handled through Whatnot — it\'s calculated at checkout, and everything you win in the same show ships together. Tracking lands in the Whatnot app as soon as your label is printed.',
            '',
            '**Shipping schedule**',
            'Orders go out weekly. Want something sooner or have a special request? DM the shop owner — we\'re flexible.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 5: Refunds
    {
        title: '💸 Refunds, Returns, and "Is My Card Actually NM?"',
        description: [
            'If something\'s wrong, we\'ll make it right. The short version:',
            '',
            '**Whatnot orders** — covered by Whatnot\'s buyer protection. If an order arrives damaged, wrong, or not as described, report it through the Whatnot app and DM us so we can make sure it gets resolved fast.',
            '',
            '**Concerned about a card?** — Hit **Request to See** on the [catalog listing](https://itzenzo.tv/cards) before you buy. We\'ll feature the card on the next live show so you can see edges, surface, and centering in real time before committing.',
            '',
            '**Full policy:** [itzenzo.tv/how-it-works/refund-policy](https://itzenzo.tv/how-it-works/refund-policy)',
            '',
            '_How to ask: DM the shop owner directly — that always reaches me._',
        ].join('\n'),
        color: 0xceff00,
    },
];

export default messages;
