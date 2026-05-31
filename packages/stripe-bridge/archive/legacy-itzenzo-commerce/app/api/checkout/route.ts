import { NextResponse } from "next/server";
import { STRIPE_ENABLED } from "@/lib/flags";
import { revalidatePath } from "next/cache";

const WP_REST_URL = process.env.WP_REST_URL!;

export async function POST(request: Request) {
  // Stripe parked (Whatnot pivot) — never proxy a checkout upstream.
  if (!STRIPE_ENABLED) {
    return NextResponse.json({ error: "stripe_disabled" }, { status: 503 });
  }

  const body = await request.json();

  const response = await fetch(`${WP_REST_URL}/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  // Stock changed — revalidate inline. We're already running in a route
  // handler on the server, so an HTTP round-trip to /api/revalidate would
  // just be cargo-culted misdirection. Calling revalidatePath() directly
  // also avoids needing to share the REVALIDATION_SECRET with this handler.
  if (response.ok) {
    revalidatePath("/");
    revalidatePath("/cards");
  }

  return NextResponse.json(data, { status: response.status });
}
