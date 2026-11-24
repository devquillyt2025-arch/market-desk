/**
 * Where MCX natural gas and crude oil are expected to open - for the Watchlist's Global markets section and the Live
 * Portfolio's MCX positions. MCX's last price comes from Upstox (so the token stays server-side, as in every other route
 * here), the NYMEX prices from Yahoo Finance; see lib/expectedOpenFeed.ts.
 *
 * `?contract=` (the Natural gas tab sends it): "default", "auto" or an Upstox instrument key (MCX_FO|digits) picks which natural gas
 * future the answer is about, and adds the list of futures to choose from. Without it, the front month - as the Watchlist and the
 * Live Portfolio have always had. Anything else is a 400.
 *
 * Always answers 200 with `open: true` and no items while MCX is trading. 401 `token_expired` when the Upstox token has lapsed.
 */

import { NextResponse, type NextRequest } from "next/server";

import { getExpectedOpen } from "@/lib/expectedOpenFeed";
import { parseContractPref } from "@/lib/natgasContract";
import { getUpstoxAccessToken } from "@/lib/upstox/token";

export async function GET(request: NextRequest) {
  const asked = request.nextUrl.searchParams.get("contract");
  const contract = asked === null ? null : parseContractPref(asked);
  if (asked !== null && contract === null) return NextResponse.json({ error: "contract must be default, auto or an MCX instrument key" }, { status: 400 });

  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) return NextResponse.json({ error: "token_expired" }, { status: 401 });

  const result = await getExpectedOpen(token, {}, contract);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "token_expired" ? 401 : 502 });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
