# Legacy itzenzo.tv policy pages (Stripe-era) — preserved reference

These are **verbatim copies** of the itzenzo.tv legal / how-it-works pages as
they existed while the storefront ran on **Stripe Checkout**, captured the day
the storefront was converted to informational + Whatnot-only (2026-05-30).

They were archived here, inside the `@itzenzottv/stripe-bridge` extension,
deliberately: the bridge is the canonical home for everything Stripe-coupled
that was removed from the live sites. When the live itzenzo.tv pages were
rewritten to describe **Whatnot** as the sales/payments channel (Whatnot's own
buyer protection + refund policy apply), the original Stripe wording — refund
windows, dispute/chargeback handling, "all payments processed by Stripe",
7-year Stripe retention, the shipping-checkout link flow, etc. — was preserved
here rather than lost to git history, so the exact prior legal posture can be
referenced or restored if Stripe checkout is ever re-enabled.

| File | Was live at |
|------|-------------|
| `terms.page.tsx` | `/legal/terms` (Terms of Service & Refund Policy) |
| `privacy.page.tsx` | `/legal/privacy` |
| `refund-policy.page.tsx` | `/how-it-works/refund-policy` (CMS-summary page) |
| `shipping.page.tsx` | `/how-it-works/shipping` |
| `buying.page.tsx` | `/how-it-works/buying` |

**These files are NOT compiled** — only `src/` is the package's published
surface. They are inert reference text. Do not import them.

Provenance: copied from `itzenzo.tv` at git HEAD `b31c75e`
(`stripe: gate checkout proxies + thank-you behind STRIPE_ENABLED`).
