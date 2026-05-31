/**
 * Proxy POST to WP's /shop/v1/bundle-checkout. Atomic stock decrement
 * happens server-side; this route just forwards the request body and
 * returns the Stripe checkout URL (or a 4xx/5xx).
 */

import { NextRequest, NextResponse } from "next/server";
import { STRIPE_ENABLED } from "@/lib/flags";

const WP_REST_URL = process.env.WP_REST_URL!;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  // Stripe parked (Whatnot pivot) — never proxy a checkout upstream.
  if (!STRIPE_ENABLED) {
    return NextResponse.json({ error: "stripe_disabled" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const res = await fetch(`${WP_REST_URL}/bundle-checkout`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Bundle checkout failed" },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
