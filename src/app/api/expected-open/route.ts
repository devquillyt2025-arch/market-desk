/**
 * Where MCX natural gas and crude oil are expected to open - for the Watchlist's Global markets section and the Live
 * Portfolio's MCX positions. No query params. MCX's last price comes from Upstox (so the token stays server-side, as in
 * every other route here), the NYMEX prices from Yahoo Finance; see lib/expectedOpenFeed.ts.
 *
 * Always answers 200 with `open: true` and no items while MCX is trading. 401 `token_expired` when the Upstox token has lapsed.
 */

import { NextResponse } from "next/server";

import { getExpectedOpen } from "@/lib/expectedOpenFeed";
import { getUpstoxAccessToken } from "@/lib/upstox/token";

export async function GET() {
  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) return NextResponse.json({ error: "token_expired" }, { status: 401 });

  const result = await getExpectedOpen(token);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "token_expired" ? 401 : 502 });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
