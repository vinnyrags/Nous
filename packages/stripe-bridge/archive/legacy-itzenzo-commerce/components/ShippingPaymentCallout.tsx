"use client";

import { useState } from "react";
import Link from "next/link";
import ShippingPaymentModal from "./ShippingPaymentModal";

/**
 * Right-column callout on the homepage (paired with the "Sealed
 * product" description in a 2-col grid) and re-used on the
 * /how-it-works/shipping page. Opens a modal that walks the buyer
 * through the email-entry → Stripe-checkout flow.
 *
 * Intentionally scoped so it serves the no-Discord buyer segment —
 * Discord-flow buyers already get a settlement DM at /offline.
 */
export default function ShippingPaymentCallout() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent/5 p-4 text-sm text-muted">
      <div>
        <strong className="text-foreground">Need to pay shipping?</strong>{" "}
        Some purchases are speculative — you pay the buy-in upfront, and
        shipping settles after items are opened during our live show. If
        you don&apos;t use Discord, pay your shipping here directly.
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setModalOpen(true)}
          className="btn btn-primary !py-2 !text-xs"
        >
          Pay shipping
        </button>
        <Link
          href="/how-it-works/shipping"
          className="text-xs text-accent underline"
        >
          How shipping works →
        </Link>
      </div>

      <ShippingPaymentModal
        isOpen={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </div>
  );
}
