/**
 * Server-side proxy behind the Heatmap tab: one price and one percent-change
 * per constituent of an index (or, on the Commodities tab, per MCX commodity),
 * plus the level and change of the three headline indices. Same reasoning as option-chain/route.ts — the token stays
 * server-side.
 *
 * Query params: `index` (one of the three indices; NIFTY is the Nifty 50 here -
 * or COMMODITIES, whose tiles are each commodity's current-month future) and optionally `range` (1D, 5D, 1M, 3M, 6M, 1Y, 3Y, 5Y —
 * defaults to 1D). Returns `{ quotes, indices }`.
 *
 * Live prices always come from v3 `market-quote/ltp` rather than v2's full
 * quotes: it carries `cp` (the previous close) explicitly, where the v2
 * payload's `ohlc.close` is just the current price intraday and its
 * `net_change` has to be back-solved — and it skips the order-book depth v2
 * attaches to every instrument, which is a lot of dead weight across 50
 * stocks. 1D compares against that `cp`; longer ranges compare against the
 * close from the cached daily history (see dailyCloses.ts).
 */

import { NextResponse, type NextRequest } from "next/server";

import { istDateString } from "@/lib/calculateStrategy";
import { COMMODITIES_TAB, getHeatmapStocks, heatmapInstrumentKey, isHeatmapTabId } from "@/lib/heatmap/constituents";
import { DEFAULT_HEATMAP_RANGE, isHeatmapRange, rangeStartDate, type HeatmapRange } from "@/lib/heatmap/ranges";
import { sessionReference } from "@/lib/heatmap/sessionMove";
import { closeOnOrBefore, getDailyCloses } from "@/lib/upstox/dailyCloses";
import { getLastTradeTimes } from "@/lib/upstox/lastTrades";
import { UPSTOX_INSTRUMENT_KEYS } from "@/lib/upstox/instrumentKeys";
import { getMcxContracts, isMcxError } from "@/lib/upstox/mcx";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import type { HeatmapQuote, IndexQuote } from "@/lib/upstox/types";
import { commodityFutures } from "@/lib/mcxCommodities";
import { INDEX_INSTRUMENTS } from "@/lib/types";

type LtpEntry = { instrument_token?: string; last_price?: number; cp?: number };

/** Upstox's own limit is 50 requests/second; this stays far under it while still loading ~60 histories in about a second. */
const HISTORY_BATCH_SIZE = 12;

function percentChange(price: number, reference: number | null | undefined): number | null {
  return typeof reference === "number" && reference > 0 ? ((price - reference) / reference) * 100 : null;
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const index = searchParams.get("index");
  const rangeParam = searchParams.get("range") ?? DEFAULT_HEATMAP_RANGE;

  if (!index) {
    return NextResponse.json({ error: "Missing required query param: index." }, { status: 400 });
  }
  if (!isHeatmapTabId(index)) {
    return NextResponse.json({ error: `Unknown index: ${index}` }, { status: 400 });
  }
  if (!isHeatmapRange(rangeParam)) {
    return NextResponse.json({ error: `Unknown range: ${rangeParam}` }, { status: 400 });
  }
  const range: HeatmapRange = rangeParam;

  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) {
    return NextResponse.json({ error: "token_expired" }, { status: 401 });
  }

  // What the tiles are: an index's stocks, or each commodity's current-month future. The month rolls, so a
  // commodity's key is looked up fresh from the exchange's contract list rather than written down here.
  let tiles: { symbol: string; key: string }[];
  if (index === COMMODITIES_TAB) {
    const mcx = await getMcxContracts();
    if (isMcxError(mcx)) return NextResponse.json({ error: mcx.error }, { status: mcx.status });
    // Every commodity the exchange lists - the mini and micro contracts too - not a fixed few. One that hasn't traded (Upstox lists
    // Cotton, Kapas with no price at all) is dropped further down with the other zero prices, and appears once it trades.
    tiles = commodityFutures(mcx.futures.values()).map((future) => ({ symbol: future.symbol, key: future.key }));
  } else {
    tiles = getHeatmapStocks(index).map((stock) => ({ symbol: stock.symbol, key: heatmapInstrumentKey(stock) }));
  }
  const stockKeys = tiles.map((tile) => tile.key);
  // The headline indices ride along on the same request — all three, whichever tab is open.
  const indexKeys = INDEX_INSTRUMENTS.map((i) => UPSTOX_INSTRUMENT_KEYS[i]);
  const upstoxUrl = `https://api.upstox.com/v3/market-quote/ltp?instrument_key=${encodeURIComponent([...stockKeys, ...indexKeys].join(","))}`;

  let upstoxResponse: Response;
  try {
    upstoxResponse = await fetch(upstoxUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      // Polled — a cached response would freeze the heatmap.
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
  const data: unknown = body?.data;
  if (!data || typeof data !== "object") {
    return NextResponse.json({ error: "Upstox's quote response was missing the expected data." }, { status: 502 });
  }

  // Match on each entry's own `instrument_token` instead of the response's
  // object key — that key is `NSE_EQ:<trading symbol>`, which is Upstox's to
  // reformat, while the token is the exact key we sent.
  const entryByToken = new Map<string, LtpEntry>();
  for (const entry of Object.values(data as Record<string, LtpEntry>)) {
    if (entry?.instrument_token) entryByToken.set(entry.instrument_token, entry);
  }

  // What each instrument's price is measured against: Upstox's previous close
  // for 1D, otherwise the close from `range` ago (null = nothing that far back).
  const referenceByKey = new Map<string, number | null>();
  if (range === "1D") {
    for (const [key, entry] of entryByToken) referenceByKey.set(key, entry.cp ?? null);

    // MCX: Upstox resets its "previous close" after the close - for some contracts, not others - so Gold reads +0.14% beside
    // Gold Mini's -4.41% when both fell about 4.4%. The latest session against the one before it, from the price history,
    // is right at every hour and equals `cp` wherever `cp` is right (see heatmap/sessionMove.ts). Best effort: a contract whose
    // history or last trade can't be had keeps `cp`.
    if (index === COMMODITIES_TAB) {
      const today = istDateString(Date.now());
      const lastTrades = await getLastTradeTimes(token, stockKeys);
      for (let i = 0; i < stockKeys.length; i += HISTORY_BATCH_SIZE) {
        await Promise.all(
          stockKeys.slice(i, i + HISTORY_BATCH_SIZE).map(async (key) => {
            const history = await getDailyCloses(token, key, today);
            if ("error" in history) return;
            referenceByKey.set(key, sessionReference({ closes: history.closes, lastTradeMs: lastTrades.get(key) ?? null, cp: entryByToken.get(key)?.cp ?? null }));
          }),
        );
      }
    }
  } else {
    const today = istDateString(Date.now());
    const startDate = rangeStartDate(range, today);
    const keys = [...stockKeys, ...indexKeys];
    let tokenExpired = false;
    let failed = 0;

    for (let i = 0; i < keys.length; i += HISTORY_BATCH_SIZE) {
      await Promise.all(
        keys.slice(i, i + HISTORY_BATCH_SIZE).map(async (key) => {
          const result = await getDailyCloses(token, key, today);
          if ("error" in result) {
            if (result.error === "token_expired") tokenExpired = true;
            else failed++;
            return;
          }
          referenceByKey.set(key, closeOnOrBefore(result.closes, startDate));
        }),
      );
      if (tokenExpired) break;
    }

    if (tokenExpired) {
      return NextResponse.json({ error: "token_expired" }, { status: 401 });
    }
    // A few stocks failing just leaves their tiles blank; if none of the
    // *stocks* loaded (even with the indices fine) there's nothing to rank,
    // and a grid of "—" would look like an answer instead of an error.
    if (failed > 0 && !stockKeys.some((key) => referenceByKey.has(key))) {
      return NextResponse.json({ error: "Couldn't load historical prices from Upstox." }, { status: 502 });
    }
  }

  const quotes: HeatmapQuote[] = [];
  for (const { symbol, key } of tiles) {
    const price = entryByToken.get(key)?.last_price;
    // A zero/absent price means the stock hasn't traded (or Upstox has no
    // quote for it) — drop it rather than draw a ₹0 tile at -100%.
    if (typeof price !== "number" || !(price > 0)) continue;
    quotes.push({ symbol, price, changePct: percentChange(price, referenceByKey.get(key)) });
  }

  const indices: IndexQuote[] = [];
  for (const instrument of INDEX_INSTRUMENTS) {
    const key = UPSTOX_INSTRUMENT_KEYS[instrument];
    const price = entryByToken.get(key)?.last_price;
    if (typeof price !== "number" || !(price > 0)) continue;
    const reference = referenceByKey.get(key);
    const changePct = percentChange(price, reference);
    indices.push({
      instrument,
      price,
      change: changePct === null || typeof reference !== "number" ? null : price - reference,
      changePct,
    });
  }

  return NextResponse.json({ quotes, indices });
}
