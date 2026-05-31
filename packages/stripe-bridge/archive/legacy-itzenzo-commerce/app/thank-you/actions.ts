"use server";

import { revalidatePath } from "next/cache";
import { STRIPE_ENABLED } from "@/lib/flags";

/**
 * Refresh the storefront caches after a successful checkout.
 *
 * Called from ThankYouClient on mount. This used to POST to /api/revalidate
 * with a hardcoded "client-revalidate" magic string — a public DoS vector
 * since anyone reading the bundle could trigger arbitrary regeneration.
 * The server action runs in-process with no shared secret, no HTTP, no
 * spoofable surface — Next.js verifies the action invocation cryptographically.
 */
export async function refreshAfterCheckout(): Promise<void> {
  revalidatePath("/");
  revalidatePath("/cards");
}

/**
 * Fetch the buyer email for a completed Stripe checkout session.
 *
 * Called from ThankYouClient on mount; the returned value is written to
 * localStorage as STORAGE_KEYS.EMAIL so the next checkout can prefill it,
 * skip the Discord username custom field (when the email is already linked
 * to a Discord account), and skip shipping (when already covered for the
 * period). Without this, every purchase looks like a brand-new buyer.
 *
 * Server-side only — STRIPE_SECRET_KEY never ships to the browser.
 */
export async function getCheckoutEmail(sessionId: string): Promise<string | null> {
  // Stripe parked (Whatnot pivot) — never call api.stripe.com.
  if (!STRIPE_ENABLED) return null;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !sessionId) return null;

  // Stripe session IDs are opaque + the data is short-lived. Plain fetch
  // keeps us off the Stripe SDK on the storefront side.
  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const data = await res.json();
    const email = data?.customer_details?.email || data?.customer_email || null;
    return typeof email === "string" ? email : null;
  } catch {
    return null;
  }
}

export type CheckoutSource = "speculative" | "pull_box" | "pack_battle" | "bundle" | "committed";

/**
 * Resolve the source of a Stripe checkout session — used by the
 * thank-you page to render speculative-purchase copy ("you'll get a
 * DM at the end of stream...") for items the buyer opens on stream
 * vs. the committed copy for sealed boxes / cards / bundles.
 *
 * Reads metadata.source on the Stripe session — set by the various
 * checkout endpoints (CreateCheckoutEndpoint sets 'speculative' for
 * all-speculative carts, PullBoxCheckoutEndpoint sets 'pull_box',
 * BundleCheckoutEndpoint sets 'bundle', etc). Anything not in the
 * speculative set is treated as committed.
 */
export async function getCheckoutSource(sessionId: string): Promise<CheckoutSource> {
  // Stripe parked (Whatnot pivot) — never call api.stripe.com.
  if (!STRIPE_ENABLED) return "committed";
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !sessionId) return "committed";

  try {
    const res = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!res.ok) return "committed";
    const data = await res.json();
    const source = data?.metadata?.source;
    if (source === "speculative" || source === "pull_box" || source === "pack_battle" || source === "bundle") {
      return source;
    }
    return "committed";
  } catch {
    return "committed";
  }
}
