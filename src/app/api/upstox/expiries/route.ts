/**
 * Server-side proxy for Upstox's option-contract endpoint, reduced to what
 * the option-chain picker needs: the list of expiry dates an index actually
 * has. Same reasoning as option-chain/route.ts — the token stays server-side.
 *
 * Query param: `instrument` (one of this app's Instrument values). Returns
 * `{ expiries: string[] }` — unique yyyy-mm-dd dates, soonest first.
 */

import { NextResponse, type NextRequest } from "next/server";

import { UPSTOX_INSTRUMENT_KEYS } from "@/lib/upstox/instrumentKeys";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import { INSTRUMENTS, type Instrument } from "@/lib/types";

const IST_OFFSET_MS = 5.5 * 3_600_000;

function isInstrument(value: string): value is Instrument {
  return (INSTRUMENTS as readonly string[]).includes(value);
}

/** Upstox has described `expiry` both as a date string and as epoch milliseconds — accept either. */
function toIsoDate(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value + IST_OFFSET_MS).toISOString().slice(0, 10);
  }
  return null;
}

export async function GET(request: NextRequest) {
  const instrument = new URL(request.url).searchParams.get("instrument");
  if (!instrument) {
    return NextResponse.json({ error: "Missing required query param: instrument." }, { status: 400 });
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
  const upstoxUrl = `https://api.upstox.com/v2/option/contract?instrument_key=${encodeURIComponent(instrumentKey)}`;

  let upstoxResponse: Response;
  try {
    upstoxResponse = await fetch(upstoxUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      // The expiry list barely moves intraday, but a stale one at rollover
      // would hide the new weekly — not worth caching.
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

  const body = await upstoxResponse.json().catch(() => null);
  const contracts: unknown = body?.data;
  if (!Array.isArray(contracts)) {
    return NextResponse.json({ error: "Upstox's contract list was missing the expected data." }, { status: 502 });
  }

  const expiries = [
    ...new Set(
      contracts
        .map((c) => toIsoDate((c as { expiry?: unknown } | null)?.expiry))
        .filter((d): d is string => d !== null),
    ),
  ].sort();

  return NextResponse.json({ expiries });
}
