/**
 * Server-side proxy for Upstox's margin endpoint — same reasoning as
 * option-chain/route.ts (token stays server-side; Upstox doesn't set CORS
 * for browser callers anyway). Returns the actual SPAN + exposure margin
 * Upstox would block for each instrument, not just its premium value.
 *
 * Body: `{ instruments: UpstoxMarginInstrumentRequest[] }`, max 20 per
 * Upstox's own limit — the caller (useMargin) is responsible for chunking
 * a longer list into multiple requests.
 */

import { NextResponse, type NextRequest } from "next/server";

import { getUpstoxAccessToken } from "@/lib/upstox/token";
import type { UpstoxMarginInstrumentRequest } from "@/lib/upstox/types";

function isValidInstrument(value: unknown): value is UpstoxMarginInstrumentRequest {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.instrument_key === "string" &&
    v.instrument_key.length > 0 &&
    typeof v.quantity === "number" &&
    v.quantity > 0 &&
    (v.transaction_type === "BUY" || v.transaction_type === "SELL") &&
    (v.product === "D" || v.product === "I" || v.product === "CO" || v.product === "MTF") &&
    (v.price === undefined || typeof v.price === "number")
  );
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const instruments = (body as Record<string, unknown> | null)?.instruments;
  if (!Array.isArray(instruments) || instruments.length === 0 || instruments.length > 20) {
    return NextResponse.json(
      { error: "Body must be { instruments: [...] }, 1-20 entries." },
      { status: 400 },
    );
  }
  if (!instruments.every(isValidInstrument)) {
    return NextResponse.json({ error: "One or more instruments are malformed." }, { status: 400 });
  }

  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) {
    return NextResponse.json({ error: "token_expired" }, { status: 401 });
  }

  let upstoxResponse: Response;
  try {
    upstoxResponse = await fetch("https://api.upstox.com/v2/charges/margin", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ instruments }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "Couldn't reach Upstox." }, { status: 502 });
  }

  if (upstoxResponse.status === 401) {
    return NextResponse.json({ error: "token_expired" }, { status: 401 });
  }
  if (!upstoxResponse.ok) {
    const detail = await upstoxResponse.text().catch(() => undefined);
    return NextResponse.json({ error: `Upstox returned ${upstoxResponse.status}`, detail }, { status: 502 });
  }

  const data = await upstoxResponse.json();
  return NextResponse.json(data);
}
