/**
 * The natural gas planner's live data: the active MCX natural gas future's signal on every timeframe, the bars to draw for the one
 * asked for (`?tf=`, minutes: 1, 2, 3, 5, 10, 15, 30, 60 or 240), the last price, and a replay of the plan rule over past sessions.
 * Candles come from Upstox with the token kept server-side, as in every other route here; see lib/natgasPlannerFeed.ts.
 *
 * 401 `token_expired` when the Upstox token has lapsed; 400 for a timeframe that isn't offered.
 */

import { NextResponse } from "next/server";

import { isTimeframe } from "@/lib/natgasPlanner/config";
import { getPlanner } from "@/lib/natgasPlannerFeed";
import { getUpstoxAccessToken } from "@/lib/upstox/token";

export async function GET(request: Request) {
  const tf = Number(new URL(request.url).searchParams.get("tf") ?? 5);
  if (!isTimeframe(tf)) return NextResponse.json({ error: "That timeframe isn't offered." }, { status: 400 });

  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) return NextResponse.json({ error: "token_expired" }, { status: 401 });

  const result = await getPlanner(token, tf);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.error === "token_expired" ? 401 : (result.status ?? 502) });
  }
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
