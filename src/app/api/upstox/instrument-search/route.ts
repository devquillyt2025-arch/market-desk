/**
 * Server-side proxy behind the Watchlist's "Add" popup: `GET ?q=reliance` -> `{ results: { indices, commodities, stocks } }`.
 *
 * Stocks and indices come from Upstox's own search endpoint (two small calls, in parallel); GIFT Nifty, which that search doesn't know, is matched locally. Commodities are searched
 * locally in the MCX contract list - Upstox's search would return one row per expiry month for each, and the
 * list wants one. A source that is down just leaves its section empty; only an expired token is an error, since
 * it would fail every call the same way.
 */

import { NextResponse } from "next/server";

import { isUpstoxGetError, upstoxErrorResponse, upstoxGet } from "@/lib/upstox/api";
import { cleanQuery, mapEquityRows, mapIndexRows, searchCommodities, searchGlobalIndices } from "@/lib/upstox/instrumentSearch";
import { getMcxContracts, isMcxError } from "@/lib/upstox/mcx";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import type { WatchSearchResult } from "@/lib/watchlist";

export async function GET(request: Request) {
  const query = cleanQuery(new URL(request.url).searchParams.get("q"));
  if (!query) return NextResponse.json({ error: "Type at least two characters." }, { status: 400 });

  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) return NextResponse.json({ error: "token_expired" }, { status: 401 });

  const search = (filters: Record<string, string>) =>
    upstoxGet(token, `/v2/instruments/search?${new URLSearchParams({ query, ...filters })}`);

  const [equityResult, indexResult, mcx] = await Promise.all([
    search({ exchanges: "NSE", segments: "EQ", instrument_types: "EQ", records: "8" }),
    search({ segments: "INDEX", records: "12" }),
    getMcxContracts(),
  ]);

  for (const result of [equityResult, indexResult]) {
    if (isUpstoxGetError(result) && result.error === "token_expired") return upstoxErrorResponse(result);
  }

  const stocks: WatchSearchResult[] = isUpstoxGetError(equityResult) ? [] : mapEquityRows(equityResult.body);
  // GIFT Nifty is one of Upstox's global indices, which its search never returns - matched locally and listed after the NSE / BSE ones.
  const indices: WatchSearchResult[] = [
    ...(isUpstoxGetError(indexResult) ? [] : mapIndexRows(indexResult.body, 6, query)),
    ...searchGlobalIndices(query),
  ];
  const commodities: WatchSearchResult[] = isMcxError(mcx) ? [] : searchCommodities(mcx.futures, query);

  // Every source failing is an outage to report, not "no matches".
  if (isUpstoxGetError(equityResult) && isUpstoxGetError(indexResult) && isMcxError(mcx)) {
    return upstoxErrorResponse(equityResult);
  }
  return NextResponse.json({ results: { indices, commodities, stocks } });
}
