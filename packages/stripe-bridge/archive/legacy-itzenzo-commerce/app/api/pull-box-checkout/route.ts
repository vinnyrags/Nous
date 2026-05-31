import { NextResponse } from "next/server";
import { STRIPE_ENABLED } from "@/lib/flags";

const WP_REST_URL = process.env.WP_REST_URL!;

export async function POST(request: Request) {
  // Stripe parked (Whatnot pivot) — never proxy a checkout upstream.
  if (!STRIPE_ENABLED) {
    return NextResponse.json({ error: "stripe_disabled" }, { status: 503 });
  }

  const body = await request.json();

  const response = await fetch(`${WP_REST_URL}/pull-box-checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  return NextResponse.json(data, { status: response.status });
}
