/**
 * Server-side proxy behind the RRR planner: how much one index has actually been moving, day to day,
 * measured from its daily closes. Same reasoning as option-chain/route.ts - the token stays server-side.
 *
 * Query param: `instrument` (one of this app's Instrument values). Returns the volatility over each
 * look-back that has enough history (see lib/volatility.ts) - close to close, and open to close for
 * trades that are out by the end of the day - and the latest close it runs up to.
 *
 * The closes come from the same cached history the Heatmap's longer ranges use (dailyCloses.ts): one
 * fetch per index per day, so asking again - or for another index - costs Upstox nothing extra.
 */

import { NextResponse, type NextRequest } from "next/server";

import { istDateString } from "@/lib/calculateStrategy";
import { getDailyCloses } from "@/lib/upstox/dailyCloses";
import { UPSTOX_INSTRUMENT_KEYS } from "@/lib/upstox/instrumentKeys";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import { INDEX_INSTRUMENTS, type IndexInstrument } from "@/lib/types";
import { intradayVolatility, realizedVolatility, VOLATILITY_WINDOWS } from "@/lib/volatility";

function isInstrument(value: string): value is IndexInstrument {
  return (INDEX_INSTRUMENTS as readonly string[]).includes(value);
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

  const result = await getDailyCloses(token, UPSTOX_INSTRUMENT_KEYS[instrument], istDateString(Date.now()));
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "token_expired" ? 401 : 502 });
  }

  const closes = result.closes.map((c) => c.close);
  const windows = VOLATILITY_WINDOWS.flatMap((days) => {
    const v = realizedVolatility(closes, days);
    return v ? [{ ...v, intraday: intradayVolatility(result.closes, days) }] : [];
  });
  const last = result.closes[result.closes.length - 1];
  if (!last || windows.length === 0) {
    return NextResponse.json({ error: "Upstox didn't return enough history to measure volatility." }, { status: 502 });
  }

  return NextResponse.json({ instrument, asOf: last.date, lastClose: last.close, windows });
}
