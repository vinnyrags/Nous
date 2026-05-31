"use client";

import { useCallback, useState } from "react";
import Modal from "./Modal";
import TermsCheckbox from "./TermsCheckbox";
import { TERMS_VERSION } from "@/lib/terms";

interface ShippingPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SubmitState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "covered"; message: string }
  | { status: "checkout"; url: string; amount_cents: number }
  | { status: "error"; message: string };

/**
 * Email-entry → server-side rate lookup → Stripe checkout for buyers
 * who pay shipping without a Discord account. Two-state UX:
 *
 *   1. Form: email + ToS checkbox
 *   2. Result: either "you're covered" or a Stripe redirect button
 *
 * The amount the buyer is charged is computed server-side (Nous looks
 * it up by email + period) — we don't trust an amount from the client.
 */
export default function ShippingPaymentModal({
  isOpen,
  onClose,
}: ShippingPaymentModalProps) {
  const [email, setEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [submit, setSubmit] = useState<SubmitState>({ status: "idle" });

  const handleClose = useCallback(() => {
    // Reset state so reopening the modal starts fresh — otherwise a
    // buyer who got a "covered" message would see it again on next open.
    setSubmit({ status: "idle" });
    setEmail("");
    setTermsAccepted(false);
    onClose();
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setSubmit({
        status: "error",
        message: "Enter a valid email so we can look up your shipping.",
      });
      return;
    }
    if (!termsAccepted) {
      setSubmit({
        status: "error",
        message: "Please accept the Terms of Service & Refund Policy to continue.",
      });
      return;
    }

    setSubmit({ status: "submitting" });

    try {
      const res = await fetch("/api/shipping/start-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, terms_version: TERMS_VERSION }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setSubmit({
          status: "error",
          message:
            data?.message ||
            "Could not look up your shipping. Try again in a moment.",
        });
        return;
      }

      if (data.status === "covered") {
        setSubmit({ status: "covered", message: data.message });
        return;
      }

      if (data.status === "checkout" && data.url) {
        setSubmit({
          status: "checkout",
          url: data.url,
          amount_cents: data.amount_cents ?? 0,
        });
        return;
      }

      setSubmit({
        status: "error",
        message: "Unexpected response from the server. Try again.",
      });
    } catch {
      setSubmit({
        status: "error",
        message:
          "Couldn't reach the server. Check your connection and try again.",
      });
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      ariaLabel="Pay shipping"
      panelClassName="border border-border"
    >
      <div className="p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Pay shipping</h2>
            <p className="mt-1 text-sm text-muted">
              Enter the email you used at checkout — we&apos;ll look up what
              you owe.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="text-muted hover:text-foreground"
          >
            &times;
          </button>
        </div>

        {submit.status === "covered" ? (
          <div className="space-y-4">
            <p className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-foreground">
              ✓ {submit.message}
            </p>
            <button
              type="button"
              onClick={handleClose}
              className="btn btn-primary w-full"
            >
              Close
            </button>
          </div>
        ) : submit.status === "checkout" ? (
          <div className="space-y-4">
            <p className="rounded border border-border bg-surface p-3 text-sm text-foreground">
              You owe{" "}
              <strong>${(submit.amount_cents / 100).toFixed(2)}</strong> for
              this shipping period. Continue to Stripe to pay.
            </p>
            <a href={submit.url} className="btn btn-primary w-full text-center">
              Continue to Stripe
            </a>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-foreground">
                Email{" "}
                <span className="text-xs font-normal text-muted">
                  (required)
                </span>
              </span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded border border-border bg-surface px-3 py-2 text-foreground outline-none focus:border-accent"
                placeholder="you@example.com"
              />
            </label>

            <TermsCheckbox
              id="shipping-payment-terms"
              checked={termsAccepted}
              onChange={setTermsAccepted}
              disabled={submit.status === "submitting"}
            />

            {submit.status === "error" && (
              <p className="rounded border border-error/50 bg-error/10 p-2 text-sm text-error">
                {submit.message}
              </p>
            )}

            <button
              type="submit"
              disabled={submit.status === "submitting" || !termsAccepted}
              className="btn btn-primary w-full disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submit.status === "submitting"
                ? "Looking up..."
                : "Look up my shipping"}
            </button>
          </form>
        )}
      </div>
    </Modal>
  );
}
