import { NextResponse } from "next/server";
import { STRIPE_ENABLED } from "@/lib/flags";

const WP_REST_URL = process.env.WP_REST_URL!;

/**
 * Thin proxy to WP's POST /shop/v1/shipping/start-checkout. WP runs
 * the ToS validation + forwards to Nous; Nous computes the rate
 * server-side + creates the Stripe session. We don't touch the body
 * here — just pass through.
 */
export async function POST(request: Request) {
  // Stripe parked (Whatnot pivot) — never proxy a checkout upstream.
  if (!STRIPE_ENABLED) {
    return NextResponse.json({ error: "stripe_disabled" }, { status: 503 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { error: "Invalid request body." },
      { status: 400 },
    );
  }

  const response = await fetch(`${WP_REST_URL}/shipping/start-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  return NextResponse.json(data, { status: response.status });
}
