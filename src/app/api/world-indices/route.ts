/**
 * The world's stock-market indices - for the Watchlist's Global markets tab, and for the ticker across the top
 * of every page - from Yahoo Finance's public feed (see lib/worldIndicesFeed.ts). The fetch happens on the server so the browser
 * never talks to Yahoo, and the PIN gate in proxy.ts covers this route like the rest.
 *
 * `?ids=^GSPC,^N225` asks for just those (the ticker asks for what is ticked, the tab for its headline eight); without it every index is returned. Ids the feed
 * doesn't know are ignored, and a request naming none of them is a 400.
 *
 * Succeeds with whichever indices came back (`missing` names the rest); only when none did is it a 502.
 */

import { NextResponse } from "next/server";

import { getWorldIndices, isWorldIndexId } from "@/lib/worldIndicesFeed";

export async function GET(request: Request) {
  const param = new URL(request.url).searchParams.get("ids");
  const ids = param === null ? undefined : param.split(",").map((id) => id.trim()).filter(Boolean);
  if (ids && !ids.some(isWorldIndexId)) {
    return NextResponse.json({ error: "No known index in ids." }, { status: 400 });
  }

  const result = await getWorldIndices({ ids });
  if (result.quotes.length === 0) {
    return NextResponse.json({ error: "Couldn't reach the price feed (Yahoo Finance). Retrying." }, { status: 502 });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
