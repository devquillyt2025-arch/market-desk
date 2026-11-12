/**
 * Server-side proxy behind the Watchlist page: live quotes for every instrument on the list in one Upstox call.
 * Same reasoning as option-chain/route.ts - the token stays server-side.
 *
 * `POST { items: [{ itemKey, kind, symbol }] }` -> `{ quotes, missing }`, `quotes` keyed by the
 * item's `itemKey`. A commodity is quoted on its current-month future, looked up from the MCX contract list on
 * each call (the contract changes monthly, so the Watchlist stores the commodity, never a contract). An item
 * Upstox has no price for comes back in `missing`, not as a row of zeros.
 *
 * Uses v2's full quote rather than the lighter v3 LTP the Heatmap polls: it is the one that carries the day's
 * open / high / low (the range bar) and `net_change` (yesterday's close is the price less that). v3's OHLC
 * endpoint has no previous-session candle for these, so it can't stand in.
 */

import { NextResponse } from "next/server";

import { isUpstoxGetError, upstoxData, upstoxErrorResponse, upstoxGet } from "@/lib/upstox/api";
import { getMcxContracts, isMcxError, type McxFuture } from "@/lib/upstox/mcx";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import { parseQuoteEntry, parseWatchRequest, resolveQuoteKey } from "@/lib/upstox/watchQuotes";
import type { WatchQuote } from "@/lib/watchlist";

export async function POST(request: Request) {
  const items = parseWatchRequest(await request.json().catch(() => null));
  if (!items) return NextResponse.json({ error: "Body must be { items: [{ itemKey, kind, symbol }] }, valid and at most 60." }, { status: 400 });
  if (items.length === 0) return NextResponse.json({ quotes: {}, missing: [] });

  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) return NextResponse.json({ error: "token_expired" }, { status: 401 });

  // The commodity contract list is only needed when the list holds a commodity.
  let futures = new Map<string, McxFuture>();
  if (items.some((item) => item.kind === "commodity")) {
    const mcx = await getMcxContracts();
    if (isMcxError(mcx)) return NextResponse.json({ error: mcx.error }, { status: mcx.status });
    futures = mcx.futures;
  }

  const keyByItem = new Map<string, { key: string; contract: WatchQuote["contract"] }>();
  const missing: string[] = [];
  for (const item of items) {
    const resolved = resolveQuoteKey(item, futures);
    if (resolved) keyByItem.set(item.itemKey, resolved);
    else missing.push(item.itemKey);
  }
  if (keyByItem.size === 0) return NextResponse.json({ quotes: {}, missing });

  const keys = [...new Set([...keyByItem.values()].map((r) => r.key))];
  const result = await upstoxGet(token, `/v2/market-quote/quotes?${new URLSearchParams({ instrument_key: keys.join(",") })}`);
  if (isUpstoxGetError(result)) return upstoxErrorResponse(result);

  const data = upstoxData(result.body);
  if (!data || typeof data !== "object") {
    return NextResponse.json({ error: "Upstox's quote response was missing the expected data." }, { status: 502 });
  }

  // Match on each entry's own `instrument_token`: the response's object key is `NSE_INDEX:Nifty 50`,
  // Upstox's own format to change, while the token is the exact key sent.
  const entryByKey = new Map<string, unknown>();
  for (const entry of Object.values(data as Record<string, { instrument_token?: string }>)) {
    if (entry?.instrument_token) entryByKey.set(entry.instrument_token, entry);
  }

  const quotes: Record<string, WatchQuote> = {};
  for (const [itemKey, { key, contract }] of keyByItem) {
    const quote = parseQuoteEntry(entryByKey.get(key), contract);
    if (quote) quotes[itemKey] = quote;
    else missing.push(itemKey);
  }
  return NextResponse.json({ quotes, missing });
}
