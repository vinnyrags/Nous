# Legacy itzenzo.tv commerce glue (Stripe-era) — preserved for restore

Verbatim copies of the **itzenzo.tv storefront commerce code** removed when the
site was converted to a lean, purely-presentational informational site after the
Whatnot pivot (2026-05-30). Captured from `itzenzo.tv` at git HEAD `b31c75e`.

This is the **app-glue half** of the preserved storefront. It pairs with:
- the reusable Stripe **logic** already in this package's `src/` (Phase-1
  extraction: checkout-session params/create, refunds, products, prices,
  coupons, customers, webhook verify), and
- the legal **policy text** in `../legacy-itzenzo-policies/`.

Together these three are the complete "get back up and running" kit: if the
business ever leaves Whatnot and re-enables a Stripe storefront, everything
removed from the live site is here.

> **Not compiled.** Only `src/` is the package's published surface. These `.ts`/
> `.tsx` files are inert reference copies — `@/…` import aliases and Next.js
> conventions only resolve inside the itzenzo.tv app, not here. Do not import them.

## What's here (mirrors the itzenzo.tv `src/` layout)

| Archived path | Was at `itzenzo.tv/src/…` | Role |
|---|---|---|
| `lib/cart.ts` | `lib/cart.ts` | localStorage cart model (get/save/add/remove/clear/count) |
| `lib/checkout.ts` | `lib/checkout.ts` | `lookupShipping()` + `createCheckout()` — POST to the API routes |
| `lib/flags.ts` | `lib/flags.ts` | `STRIPE_ENABLED` kill switch (+ `IS_WHATNOT_PRIMARY`) |
| `hooks/useCart.ts` | `hooks/useCart.ts` | cart context hook |
| `components/CartProvider.tsx` | `components/CartProvider.tsx` | cart context provider (was mounted in `layout.tsx`) |
| `components/CartButton.tsx` | `components/CartButton.tsx` | header cart icon + count badge |
| `components/CartDrawer.tsx` | `components/CartDrawer.tsx` | slide-out cart → Stripe checkout CTA |
| `components/ShippingPaymentModal.tsx` | `components/ShippingPaymentModal.tsx` | email → shipping-rate lookup → Stripe |
| `components/ShippingPaymentCallout.tsx` | `components/ShippingPaymentCallout.tsx` | entry point that opens the shipping modal |
| `components/HomepageBundle.tsx` | `components/HomepageBundle.tsx` | English-Bundle buy widget |
| `components/PullBoxes.tsx` | `components/PullBoxes.tsx` | pull-box buy-in widget |
| `components/CurrentPackBattle.tsx` | `components/CurrentPackBattle.tsx` | pack-battle buy-in widget |
| `components/PackBattleSection.tsx` | `components/PackBattleSection.tsx` | homepage section wrapping pack-battle/pull-box/bundle |
| `app/api/checkout/route.ts` | `app/api/checkout/route.ts` | cart → WP checkout proxy |
| `app/api/bundle-checkout/route.ts` | same | bundle checkout proxy |
| `app/api/pull-box-checkout/route.ts` | same | pull-box checkout proxy |
| `app/api/pack-battle-checkout/route.ts` | same | pack-battle checkout proxy |
| `app/api/shipping/start-checkout/route.ts` | same | shipping checkout proxy |
| `app/thank-you/page.tsx` | `app/thank-you/page.tsx` | post-checkout landing |
| `app/thank-you/actions.ts` | same | server actions: read Stripe session email/source |
| `app/thank-you/ThankYouClient.tsx` | same | clears cart, persists buyer email |

> `PackBattleSection.tsx` and the presentational tiles `ProductCard.tsx` /
> `CardTile.tsx` were **edited in place** in itzenzo.tv (buy actions stripped,
> display kept), not deleted — see those files' git history for the exact
> Stripe-era versions. `PackBattleSection` is archived here because it was the
> homepage host for the now-removed buy widgets.

## Reincorporation (re-enabling a Stripe storefront)

1. Copy the files above back to their mirrored `itzenzo.tv/src/…` paths.
2. Re-add `CartProvider` to `app/layout.tsx`; re-add `CartButton`/`CartDrawer`
   to `Header.tsx`; re-render the buy widgets in `app/page.tsx`.
3. Restore the Stripe-only GraphQL fields (`stripePriceId`, `stripeProductId`,
   `bundleStripePriceId`) in `lib/graphql/queries.ts` + `types.ts`, and the
   Add-to-Cart actions in `ProductCard.tsx` / `CardTile.tsx` (git history).
4. Re-add the checkout/shipping rate-limit rules in `middleware.ts`.
5. Restore the Stripe-era legal pages from `../legacy-itzenzo-policies/`.
6. Set `STRIPE_ENABLED = true` (itzenzo `lib/flags.ts`), and flip the WP +
   Nous `STRIPE_ENABLED` per `akivili/business/deployment.md`.
7. The server-side Stripe SDK logic is already live in this package's `src/`.

Provenance: itzenzo.tv @ `b31c75e`.
