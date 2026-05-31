"use client";

import { useCallback, useState } from "react";
import { useCart } from "@/hooks/useCart";
import { lookupShipping, createCheckout } from "@/lib/checkout";
import { STORAGE_KEYS } from "@/lib/constants";
import Modal from "./Modal";
import TermsCheckbox from "./TermsCheckbox";

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CartDrawer({ isOpen, onClose }: CartDrawerProps) {
  const { items, removeItem, updateQuantity, clear } = useCart();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsAccepted, setTermsAccepted] = useState(false);

  const handleCheckout = useCallback(async () => {
    if (!items.length || isSubmitting || !termsAccepted) return;
    setIsSubmitting(true);
    setError(null);

    const email =
      localStorage.getItem(STORAGE_KEYS.EMAIL) || undefined;

    let shippingCovered = false;
    let international = false;
    let countryKnown = true;
    let discordLinked = false;

    if (email) {
      const lookup = await lookupShipping(email);
      if (lookup) {
        shippingCovered = lookup.covered;
        international = lookup.international;
        countryKnown = lookup.countryKnown ?? false;
        discordLinked = lookup.known ?? false;
      }
    } else {
      countryKnown = false;
    }

    const result = await createCheckout(items, {
      email,
      international,
      countryKnown,
      shippingCovered,
      discordLinked,
    });

    if ("url" in result) {
      window.location.href = result.url;
    } else {
      // item_unavailable: drift detected pre-flight or in the Stripe-reject
      // backstop. Remove ONLY the offending item so a buyer with a
      // multi-item cart doesn't lose four valid items because one drifted.
      if ("itemUnavailable" in result && result.itemUnavailable && result.priceId) {
        removeItem(result.priceId);
        const named = result.productName || "an item";
        setError(
          `${named} is no longer available — removed from your cart. Try again.`,
        );
        fetch("/api/revalidate?path=/").catch(() => {});
      } else if ("stockError" in result && result.stockError) {
        // out_of_stock / insufficient_stock: still ambiguous which item
        // (the pre-flight only names the inactive-Stripe-price case).
        // Keep the existing clear behavior here as the safe fallback.
        clear();
        setError(
          result.error +
            " Your cart has been cleared — please check what's still available.",
        );
        fetch("/api/revalidate?path=/").catch(() => {});
      } else {
        setError(result.error);
      }
      setIsSubmitting(false);
    }
    // termsAccepted MUST be in this dep array — without it the callback
    // captures the initial `false` value and the !termsAccepted guard
    // above returns silently even after the buyer checks the box. The
    // button's `disabled` prop re-evaluates correctly (it reads state
    // directly in the render), so the button becomes enabled — but the
    // click handler still sees the stale closure and bails. Result:
    // click does nothing, no Stripe session created, no error surfaced.
  }, [items, isSubmitting, termsAccepted, clear, removeItem]);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      variant="drawer"
      ariaLabel="Shopping cart"
    >
      <>
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-lg font-semibold">Cart</h2>
          <div className="flex items-center gap-1">
            {items.length > 0 && (
              <button
                onClick={clear}
                aria-label="Clear cart"
                title="Clear cart"
                className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface hover:text-error"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
                  <line x1="10" y1="11" x2="10" y2="17" />
                  <line x1="14" y1="11" x2="14" y2="17" />
                </svg>
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="Close cart"
              className="flex h-8 w-8 items-center justify-center rounded-full text-xl hover:bg-surface"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {items.length === 0 ? (
            <p className="py-8 text-center text-muted">
              Your cart is empty.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {items.map((item) => (
                <div
                  key={item.priceId}
                  className="flex items-start gap-3 border-b border-border pb-3"
                >
                  {item.image && (
                    <img
                      src={item.image}
                      alt=""
                      className="h-16 w-12 rounded object-cover"
                    />
                  )}
                  <div className="flex-1">
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-sm text-muted">{item.price}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {item.stock > 1 && (
                      <input
                        type="number"
                        min={1}
                        max={item.stock}
                        value={item.quantity}
                        onChange={(e) =>
                          updateQuantity(
                            item.priceId,
                            parseInt(e.target.value, 10),
                          )
                        }
                        className="h-8 w-14 rounded border border-border bg-surface text-center text-sm text-foreground"
                        aria-label="Quantity"
                      />
                    )}
                    <button
                      onClick={() => removeItem(item.priceId)}
                      aria-label={`Remove ${item.title}`}
                      className="text-lg text-muted hover:text-error"
                    >
                      &times;
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border px-4 py-3">
          {error && (
            <div className="mb-3 flex items-start gap-2 rounded border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
              <span className="flex-1">{error}</span>
              <button
                onClick={() => setError(null)}
                aria-label="Dismiss error"
                className="text-error/70 hover:text-error"
              >
                &times;
              </button>
            </div>
          )}
          {items.length > 0 && (
            <div className="mb-3">
              <TermsCheckbox
                id="cart-drawer-terms"
                checked={termsAccepted}
                onChange={setTermsAccepted}
                disabled={isSubmitting}
              />
            </div>
          )}
          <button
            onClick={handleCheckout}
            disabled={
              items.length === 0 || isSubmitting || !termsAccepted
            }
            className="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? "Processing..." : "Checkout"}
          </button>
          <p className="mt-2 text-center text-xs text-muted">
            Secure checkout via Stripe.{" "}
            <a
              href="/how-it-works/refund-policy"
              className="underline transition-colors hover:text-accent"
            >
              Refund policy
            </a>
            .
          </p>
        </div>
      </>
    </Modal>
  );
}
