import type { CartItem } from "./cart";
import { TERMS_VERSION } from "./terms";

export interface ShippingLookupResult {
  email: string;
  known: boolean;
  covered: boolean;
  international: boolean;
  rate: number;
  label: string;
  countryKnown?: boolean;
}

export async function lookupShipping(
  email: string,
): Promise<ShippingLookupResult | null> {
  try {
    const response = await fetch(
      `/api/shipping?email=${encodeURIComponent(email)}`,
    );

    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export interface CheckoutPayload {
  items: Array<{ priceId: string; quantity: number }>;
  international: boolean;
  country_known: boolean;
  email: string;
  shipping_covered: boolean;
  discord_linked: boolean;
}

export async function createCheckout(
  items: CartItem[],
  options: {
    email?: string;
    international?: boolean;
    countryKnown?: boolean;
    shippingCovered?: boolean;
    discordLinked?: boolean;
  } = {},
): Promise<
  | { url: string }
  | {
      error: string;
      code?: string;
      stockError?: boolean;
      itemUnavailable?: boolean;
      priceId?: string;
      productName?: string;
    }
> {
  try {
    const response = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: items.map((i) => ({
          priceId: i.priceId,
          quantity: i.quantity,
        })),
        international: options.international ?? false,
        country_known: options.countryKnown ?? true,
        email: options.email ?? "",
        shipping_covered: options.shippingCovered ?? false,
        discord_linked: options.discordLinked ?? false,
        // Pin the terms version the buyer saw at checkout. The WP-side
        // endpoint records this with the Stripe session metadata so
        // chargeback disputes can be answered with the exact version
        // the buyer agreed to.
        terms_version: TERMS_VERSION,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      const code = data.code || "checkout_failed";
      const stockError =
        code === "out_of_stock" || code === "insufficient_stock";
      const itemUnavailable = code === "item_unavailable";
      // WP_Error nests its `data` payload at data.data — priceId and
      // productName live there, set by CreateCheckoutEndpoint::unavailableItemResponse
      const priceId = data?.data?.priceId as string | undefined;
      const productName = data?.data?.productName as string | undefined;
      return {
        error: data.message || "Checkout failed. Please try again.",
        code,
        stockError,
        itemUnavailable,
        priceId,
        productName,
      };
    }

    return { url: data.url };
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
}
