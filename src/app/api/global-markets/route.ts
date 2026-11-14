/**
 * Prices for the strip across the top of every page: WTI and Brent crude, USD/INR, natural gas and gold, from
 * Yahoo Finance's public feed (see lib/globalMarketsFeed.ts). No query params, no token - the fetch happens on the
 * server so the browser never talks to Yahoo, and the PIN gate in proxy.ts covers this route like the rest.
 *
 * Succeeds with whichever markets came back (`missing` names the rest); only when none did is it a 502.
 */

import { NextResponse } from "next/server";

import { getGlobalMarkets } from "@/lib/globalMarketsFeed";

export async function GET() {
  const result = await getGlobalMarkets();
  if (result.quotes.length === 0) {
    return NextResponse.json({ error: "Couldn't reach the price feed (Yahoo Finance). Retrying." }, { status: 502 });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
