/**
 * Server-side proxy for Upstox's option-chain endpoint — keeps the access
 * token out of the browser (Upstox's own API also doesn't set CORS headers
 * for arbitrary origins, so a direct browser call would fail regardless).
 *
 * Query params: `instrument` (one of this app's Instrument values) and
 * `expiry` (yyyy-mm-dd). Returns the full chain response through unfiltered
 * — the caller (Live Portfolio) matches specific strikes client-side, since
 * several open positions can share one instrument+expiry and should share
 * one fetch rather than one each.
 *
 * Designed generically (not Live-Portfolio-specific) so a future feature —
 * e.g. live pricing in the Brokerage Calculator — can call this same route.
 */

import { NextResponse, type NextRequest } from "next/server";

import { UPSTOX_INSTRUMENT_KEYS } from "@/lib/upstox/instrumentKeys";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import { INSTRUMENTS, type Instrument } from "@/lib/types";

function isInstrument(value: string): value is Instrument {
  return (INSTRUMENTS as readonly string[]).includes(value);
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const instrument = searchParams.get("instrument");
  const expiry = searchParams.get("expiry");

  if (!instrument || !expiry) {
    return NextResponse.json({ error: "Missing required query params: instrument, expiry." }, { status: 400 });
  }
  if (!isInstrument(instrument)) {
    return NextResponse.json({ error: `Unknown instrument: ${instrument}` }, { status: 400 });
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

  const instrumentKey = UPSTOX_INSTRUMENT_KEYS[instrument];
  const upstoxUrl = `https://api.upstox.com/v2/option/chain?instrument_key=${encodeURIComponent(instrumentKey)}&expiry_date=${encodeURIComponent(expiry)}`;

  let upstoxResponse: Response;
  try {
    upstoxResponse = await fetch(upstoxUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      // Every call must reach Upstox fresh — polling is the whole point, and
      // Next's fetch cache would otherwise happily serve a stale response.
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
    return NextResponse.json(
      { error: `Upstox returned ${upstoxResponse.status}`, detail },
      { status: 502 },
    );
  }

  const data = await upstoxResponse.json();
  return NextResponse.json(data);
}
