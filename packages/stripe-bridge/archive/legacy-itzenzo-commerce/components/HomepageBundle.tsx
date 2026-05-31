"use client";

/**
 * HOMEPAGE BUNDLE — one-off "constructed content" widget on the
 * itzenzo.tv homepage. Lives in the same right-column stack as the
 * pull-box widget.
 *
 * Title, description, price, and pitch are hardcoded in this component
 * (the user calls this a content thing — when the bundle changes, the
 * fix is to swap in different content + redeploy). What's *not* hardcoded:
 * the Stripe price ID and the live stock count, which both come from the
 * WP settings page so the user can:
 *   - set the price ID per environment without a code edit
 *   - watch stock decrement in real time
 *   - manually adjust stock if some bundles are sold off-platform
 *
 * Stock decrement is atomic via the `/api/bundle-checkout` route → WP's
 * `/shop/v1/bundle-checkout` endpoint. When stock hits 0 the button is
 * disabled and the pill flips to "Sold out".
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { HomepageBundle as HomepageBundleData } from "@/lib/graphql/types";
import { TERMS_VERSION, TERMS_HREF } from "@/lib/terms";

interface HomepageBundleProps {
  data: HomepageBundleData;
}

const HARDCODED_TITLE = "English Bundle";
const HARDCODED_DESCRIPTION =
  "100 cards · 5 holos · 5 reverse holos · 90 bulk · pulled from across all sets we've sold over the years. Great value for kids starting out.";
const PRICE_LABEL = "$5.99";

export default function HomepageBundle({ data }: HomepageBundleProps) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const stock = data.bundleStock ?? 0;
  const priceId = data.bundleStripePriceId;
  const soldOut = stock <= 0;
  const disabled = soldOut || !priceId || pending;

  // Close the confirm modal on Escape. Clicks on the backdrop close via
  // the onClick handler in the dialog markup below.
  useEffect(() => {
    if (!confirmOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) setConfirmOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [confirmOpen, pending]);

  // Don't render at all if the bundle isn't configured. Distinct from
  // sold-out: a missing price ID is a config error, not a real content
  // state we want to show buyers.
  if (!priceId) {
    return null;
  }

  async function handleBuy() {
    if (disabled) return;
    setPending(true);
    setError(null);
    setConfirmOpen(false);

    try {
      const res = await fetch("/api/bundle-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priceId, terms_version: TERMS_VERSION }),
      });
      const body = await res.json();

      if (!res.ok) {
        setError(
          body?.message ||
            (res.status === 409
              ? "Just sold out — refresh the page."
              : "Could not start checkout. Try again in a moment."),
        );
        return;
      }

      window.location.href = body.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="text-xs font-bold uppercase tracking-wide text-foreground">
        Bundle
      </div>
      {/* Mobile: stack tile+body on top, full-width button below.
          Desktop (sm+): original single inline row. */}
      <div className="flex flex-1 flex-col gap-3 rounded-lg border border-border bg-surface/60 p-4 sm:flex-row sm:items-center sm:gap-4">
        <div className="flex flex-1 items-start gap-4 sm:items-center">
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-md bg-accent/15 text-base font-bold text-accent">
            {PRICE_LABEL}
          </div>
          <div className="flex flex-1 flex-col">
            {/* Title + status badge wrap-stack on mobile (the badge can
                be a long string like "Only N left — first come first
                served"); inline at sm+ where there's room. */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-sm font-bold text-foreground">
                {HARDCODED_TITLE}
              </span>
              <span
                className={
                  "rounded-full px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide " +
                  (soldOut
                    ? "bg-zinc-500/15 text-zinc-400"
                    : "bg-rose-500/15 text-rose-300")
                }
              >
                {soldOut
                  ? "Sold out"
                  : `Only ${stock} left — first come first served`}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">{HARDCODED_DESCRIPTION}</p>
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={disabled}
          // Mobile: indent by the tile width (h-14 = 3.5rem) + the inner
          // gap-4 (1rem) so the button starts flush with the title/
          // description text instead of sitting under the dollar tile.
          // sm: resets both so the desktop inline row is unchanged.
          className="btn btn-primary ml-[4.5rem] self-start disabled:cursor-not-allowed disabled:opacity-50 sm:ml-0 sm:self-auto"
        >
          {soldOut ? "Sold Out" : pending ? "…" : "Buy Now"}
        </button>
      </div>

      {confirmOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bundle-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            if (!pending) setConfirmOpen(false);
          }}
        >
          <div
            className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2
              id="bundle-confirm-title"
              className="text-lg font-bold text-foreground"
            >
              Confirm purchase
            </h2>
            <p className="mt-3 text-sm text-foreground">
              <strong>{PRICE_LABEL}</strong> — {HARDCODED_TITLE}.
            </p>
            <p className="mt-3 text-xs text-muted">
              By continuing you agree to the{" "}
              <Link
                href={TERMS_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent underline"
              >
                Terms of Service &amp; Refund Policy
              </Link>{" "}
              (v{TERMS_VERSION}).
            </p>
            <div className="mt-6 flex justify-start gap-2">
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                disabled={pending}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBuy}
                disabled={pending}
                className="btn btn-primary"
              >
                {pending ? "…" : "Agree & Continue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
