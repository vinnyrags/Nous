/**
 * #how-it-works Reference — auto-synced to #how-it-works on startup.
 *
 * Customer-facing payment, shipping, and refund explanation. Each entry
 * becomes one embed posted in order. The bot compares existing embeds to
 * this content and edits any that have changed (see sync-bot-commands.js).
 *
 * Canonical copy lives in akivili/business/discord.md under "#how-it-works
 * — Planned Content"; keep these in sync when policy changes.
 */

const messages = [
    // Message 1: Overview
    {
        title: '💳 How Payments & Shipping Work',
        description: [
            'We sell sealed TCG product (Pokemon, anime, and **Yu-Gi-Oh — coming soon**) through the shop at **itzenzo.tv**, plus hand-inspected raw singles in our [card catalog](https://itzenzo.tv/cards) — condition shown right on the listing.',
            '',
            'Here\'s exactly how everything works — buying, shipping, refunds, and what to expect at every step.',
            '',
            '_Have a question this doesn\'t cover? DM the shop owner directly or reply to your Stripe receipt email._',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 2: Buying
    {
        title: '🛒 Buying',
        description: [
            '**Between live shows**',
            'Shop anytime at [itzenzo.tv](https://itzenzo.tv). We automatically check your shipping coverage using the email from a previous order. If your shipping is already covered this week (US) or month (international), you won\'t be charged again. If not, shipping is included at checkout — $10 US / $25 International.',
            '',
            '**During a live show**',
            'When a live show is on, find us on **Whatnot** at [whatnot.com/user/itzenzottv](https://whatnot.com/user/itzenzottv) — that\'s where pack openings, singles auctions, group breaks, and the live show energy live. The itzenzo.tv catalog stays open in parallel for Buy Now sealed product and Make-an-Offer / Request-to-See on singles.',
            '',
            '**You\'ll always get a receipt**',
            'Every purchase generates an automatic Stripe receipt to the email you check out with — no Discord linking required. Make-an-Offer and Request-to-See submissions also send a confirmation email, so you have a record of every interaction with the shop even if you never join the server.',
            '',
            '**Why flat-rate shipping?**',
            'One payment covers every purchase you make in the same period. Buy a single card or fifteen products in the same week — you pay shipping exactly once. No per-item math, no surprise stacking fees.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 3: Pack battles + card shop
    {
        title: '⚔️ Pack Battles & 🃏 Card Shop',
        description: [
            '**Pack battles**',
            'Pack battles in their original itzenzo.tv form are **paused during the Whatnot transition**. Live pack openings (including competitive multi-buyer formats) now happen on **Whatnot** at [whatnot.com/user/itzenzottv](https://whatnot.com/user/itzenzottv) using their native Group Break tooling.',
            '',
            '**Card shop (#card-shop)**',
            'Graded cards, vintage one-offs, and anything outside the main catalog get listed in `#card-shop` as embeds with Buy Now buttons. Click to check out — a reservation locks the card to you for 30 minutes while you complete the purchase. If you don\'t finish in time, the card is released back to the shop for the next buyer.',
            '',
            '**Raw singles catalog**',
            'Browse the catalog at [itzenzo.tv/cards](https://itzenzo.tv/cards). Every card is hand-inspected, with condition (NM, LP, MP, HP, DMG) shown in the corner of the listing. Not sure about a card? Hit **Request to See** and we\'ll feature it on our next live show on Whatnot so you can see edges, surface, and holo shift in real time — no commitment.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 4: Shipping
    {
        title: '📦 Shipping & 🌍 International',
        description: [
            '**Shipping schedule**',
            'US orders ship every Monday. International orders ship at the end of each month. Your shipping payment covers everything you buy during that period — pay once, ship once.',
            '',
            'When your order ships, you\'ll get an automatic email confirmation with your tracking number and a link to track your package — sent to the email on your order, no Discord required. Linked Discord accounts also get a DM from Nous as a faster real-time ping, and a public notification goes out in `#order-feed`.',
            '',
            '**International buyers**',
            'We ship to the US and Canada. International shipping is $25/month — one payment covers all your purchases for the entire month. If you\'re outside the US, select your country at checkout and you\'re set. Want your order sooner? DM the shop owner — we can ship early instead of waiting for the monthly batch.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 5: Payment security
    {
        title: '🔒 Payment Security',
        description: [
            'All payments go through **Stripe**, a PCI-compliant payment processor used by millions of businesses. We never see or store your card information — Stripe handles every part of the transaction.',
            '',
            'You\'ll get an email receipt directly from Stripe for every purchase. Replying to that receipt is one of the fastest ways to reach us if anything goes wrong.',
        ].join('\n'),
        color: 0xceff00,
    },

    // Message 6: Refunds
    {
        title: '💸 Refunds, Returns, and "Is My Card Actually NM?"',
        description: [
            'If something\'s wrong, we\'ll make it right. The short version:',
            '',
            '**Before your order ships** — A full refund cancels everything. Stripe refunds your money and the order is killed in our shipping system so nothing goes out the door.',
            '',
            '**After your order ships** — We can still refund, we just can\'t recall the package. If your package is lost, damaged, or never shows up, DM us with your tracking number and we\'ll work it out together.',
            '',
            '**Concerned about a card?** — Hit **Request to See** on the listing before you buy. We\'ll feature the card on our next live show on Whatnot so you can see edges, surface, and centering in real time before committing.',
            '',
            '**Pack battles** — Currently paused in their itzenzo.tv form during the Whatnot transition. Live pack openings now run on Whatnot under their native refund rules.',
            '',
            'Refunds land back on your card in 5–10 business days (Stripe processes immediately, your bank takes a beat).',
            '',
            '**Full policy:** [itzenzo.tv/how-it-works/refund-policy](https://itzenzo.tv/how-it-works/refund-policy)',
            '',
            '_How to ask: DM the shop owner directly, or reply to your Stripe receipt email — both routes reach me._',
        ].join('\n'),
        color: 0xceff00,
    },
];

export default messages;
