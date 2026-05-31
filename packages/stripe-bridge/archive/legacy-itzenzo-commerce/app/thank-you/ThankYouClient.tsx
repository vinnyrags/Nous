"use client";

import { useEffect } from "react";
import { clearCart } from "@/lib/cart";
import { STORAGE_KEYS } from "@/lib/constants";
import { getCheckoutEmail, refreshAfterCheckout } from "./actions";

interface ThankYouClientProps {
  sessionId: string | null;
}

export default function ThankYouClient({ sessionId }: ThankYouClientProps) {
  useEffect(() => {
    clearCart();
    // Server action — Next.js auth-binds this to the action handler so
    // arbitrary callers can't trigger revalidation storms.
    refreshAfterCheckout().catch(() => {});

    // Persist the buyer's email so the next checkout recognizes them —
    // CartDrawer reads this to skip shipping (when already covered for
    // the period) and to skip the Stripe Discord-username custom field
    // (when the email is already linked to a Discord account in WP).
    if (sessionId) {
      getCheckoutEmail(sessionId)
        .then((email) => {
          if (email) {
            window.localStorage.setItem(STORAGE_KEYS.EMAIL, email);
          }
        })
        .catch(() => {});
    }
  }, [sessionId]);

  return null;
}
