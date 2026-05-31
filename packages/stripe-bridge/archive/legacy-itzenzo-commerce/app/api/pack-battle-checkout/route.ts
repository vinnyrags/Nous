/**
 * Proxy POST to Nous's /web/battle/checkout. Pack-battle state lives in
 * Nous's SQLite (battles table), so the buy endpoint lives there too.
 * This route forwards the request body and returns the Stripe checkout
 * URL (or a 4xx/5xx). Pattern mirrors src/app/api/queue/stream/route.ts —
 * Nous binds to 127.0.0.1 only, so the upstream URL never leaves the
 * Next.js server.
 */

import { NextRequest, NextResponse } from "next/server";
import { STRIPE_ENABLED } from "@/lib/flags";

const NOUS_URL = process.env.NOUS_BOT_URL || "http://127.0.0.1:3100";

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
      { error: "invalid_json", message: "Invalid JSON body" },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const res = await fetch(`${NOUS_URL}/web/battle/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Forward the buyer's IP + UA so Nous can record them in
        // the ToS audit metadata (otherwise they'd record the
        // Next.js server's loopback address and Node's UA string).
        "X-Forwarded-For":
          request.headers.get("x-forwarded-for") ||
          request.headers.get("x-real-ip") ||
          "",
        "User-Agent": request.headers.get("user-agent") || "",
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    return NextResponse.json(data, {
      status: res.status,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json(
      {
        error: "upstream_unreachable",
        message: e instanceof Error ? e.message : "Pack-battle checkout failed",
      },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
