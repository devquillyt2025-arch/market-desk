/**
 * Server-side proxy for Upstox's positions endpoint — the account's open
 * F&O positions (and anything squared off today), feeding Live Portfolio's
 * sync. Same reasoning as option-chain/route.ts for living here: the token
 * stays server-side.
 *
 * Upstox only gives each position an opaque instrument token, so every one is
 * matched to its contract (see contracts.ts, mcx.ts for crude oil and gold,
 * and futures.ts for the index futures) and returned already reduced to the
 * instrument / strike / CE-PE / expiry this app stores - a future has no strike
 * or CE-PE, just its expiry. Anything that isn't a Nifty / Bank Nifty / Sensex
 * option or future, or an MCX crude oil / gold / natural gas option, is counted,
 * not returned.
 */

import { NextResponse } from "next/server";

import { addDays, istDateString } from "@/lib/calculateStrategy";
import { round2 } from "@/lib/calculateTrade";
import {
  compareTradeIds,
  getHistoricalFills,
  isUpstoxGetError,
  num,
  upstoxData,
  upstoxErrorResponse,
  upstoxGet,
  type FillsSegment,
  type HistoricalFill,
} from "@/lib/upstox/api";
import { getOptionContracts, type PositionContract } from "@/lib/upstox/contracts";
import { futuresExchangeOfKey, getIndexFutures, type FuturesExchange } from "@/lib/upstox/futures";
import { getMcxContracts, isMcxError, MCX_KEY_PREFIX } from "@/lib/upstox/mcx";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import type { UpstoxPosition } from "@/lib/upstox/types";

/** How far back to look for when a carried position was opened — past the longest-dated monthly most people hold. */
const OPENED_ON_LOOKBACK_DAYS = 120;

/** Fills only change once a day (Upstox adds each day's the next morning), so they're fetched at most once per IST day - per segment. */
const fillsCache: Partial<Record<FillsSegment, { day: string; fills: HistoricalFill[] }>> = {};

type Totals = {
  overnightBuyQty: number;
  overnightSellQty: number;
  overnightBuyAmount: number;
  overnightSellAmount: number;
  dayBuyQty: number;
  daySellQty: number;
  dayBuyValue: number;
  daySellValue: number;
  lastPrice: number | null;
  closePrice: number | null;
  /**
   * Units one reported quantity stands for: 1 on NSE / BSE, where Upstox counts units. MCX positions are
   * counted in lots, and their values carry the contract multiplier (2 lots of crude bought at 365.45 are
   * `quantity: 2`, `multiplier: 100`, value 73,090) - so scaling the quantities by it puts an MCX position
   * on the same footing as an index one: quantity in units, value = price x quantity.
   */
  unitsPerQuantity: number;
};

function positivePrice(value: unknown): number | null {
  const n = num(value);
  return n > 0 ? n : null;
}

/**
 * The date the oldest still-open lot was traded, walking back through this
 * contract's fills on the position's own side (FIFO: the other side's fills
 * closed the oldest lots first, so the open ones are the most recent).
 */
function openedOnFor(
  fills: HistoricalFill[],
  contract: PositionContract,
  overnightQuantity: number,
  /** Units one filled quantity stands for - see Totals.unitsPerQuantity. */
  fillUnit = 1,
): string | null {
  const side = overnightQuantity > 0 ? "BUY" : "SELL";
  const matching = fills
    .filter(
      (f) =>
        f.side === side &&
        f.symbol === contract.instrument &&
        f.expiry === contract.expiry &&
        // A future's fills carry no CE/PE and no strike. Upstox's history hasn't been seen holding one, so this is
        // a best guess at how it labels them - and a miss only leaves the position dated today.
        (contract.optionType === null
          ? f.optionType !== "CE" && f.optionType !== "PE"
          : f.optionType === contract.optionType && f.strike === contract.strike),
    )
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : compareTradeIds(b.tradeId, a.tradeId)));

  let remaining = Math.abs(overnightQuantity);
  let openedOn: string | null = null;
  for (const fill of matching) {
    openedOn = fill.date;
    remaining -= fill.quantity * fillUnit;
    if (remaining <= 0) break;
  }
  return openedOn;
}

export async function GET() {
  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) {
    return NextResponse.json({ error: "token_expired" }, { status: 401 });
  }

  const positionsResult = await upstoxGet(token, "/v2/portfolio/short-term-positions");
  if (isUpstoxGetError(positionsResult)) return upstoxErrorResponse(positionsResult);
  const rows = upstoxData(positionsResult.body);
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: "Upstox's positions response was missing the expected data." }, { status: 502 });
  }
  if (rows.length === 0) return NextResponse.json({ positions: [], otherCount: 0 });

  const contractsResult = await getOptionContracts(token);
  if (isUpstoxGetError(contractsResult)) return upstoxErrorResponse(contractsResult);
  const { contracts } = contractsResult;

  // The commodity list is a separate (and much bigger) download, so it is only
  // needed once the account actually holds something on MCX. All or nothing,
  // like the index contracts: a position left unmatched here would read as
  // "gone" to the sync and have its row squared off.
  const holdsMcx = (rows as Record<string, unknown>[]).some(
    (row) => typeof row.instrument_token === "string" && row.instrument_token.startsWith(MCX_KEY_PREFIX),
  );
  let mcxContracts: Map<string, PositionContract> | null = null;
  if (holdsMcx) {
    const mcxResult = await getMcxContracts();
    if (isMcxError(mcxResult)) return upstoxErrorResponse(mcxResult);
    mcxContracts = mcxResult.contracts;
  }
  // The same for an index future: its token is an NSE / BSE F&O key that the option contracts above don't list.
  // Only the exchange(s) actually held are downloaded.
  const futuresExchanges = new Set<FuturesExchange>();
  for (const row of rows as Record<string, unknown>[]) {
    const key = row.instrument_token;
    const exchange = typeof key === "string" && !contracts.has(key) ? futuresExchangeOfKey(key) : null;
    if (exchange) futuresExchanges.add(exchange);
  }
  let futureContracts: Map<string, PositionContract> | null = null;
  if (futuresExchanges.size > 0) {
    const futuresResult = await getIndexFutures(futuresExchanges);
    if (isUpstoxGetError(futuresResult)) return upstoxErrorResponse(futuresResult);
    futureContracts = futuresResult.contracts;
  }
  const contractFor = (key: string): PositionContract | undefined =>
    contracts.get(key) ?? mcxContracts?.get(key) ?? futureContracts?.get(key);

  // NRML and intraday rows of the same contract are one position as far as
  // this app is concerned — summed here, by instrument token.
  const totalsByKey = new Map<string, Totals>();
  let otherCount = 0;
  for (const row of rows as Record<string, unknown>[]) {
    const key = row.instrument_token;
    if (typeof key !== "string" || !contractFor(key)) {
      otherCount++;
      continue;
    }
    const t = totalsByKey.get(key) ?? {
      overnightBuyQty: 0,
      overnightSellQty: 0,
      overnightBuyAmount: 0,
      overnightSellAmount: 0,
      dayBuyQty: 0,
      daySellQty: 0,
      dayBuyValue: 0,
      daySellValue: 0,
      lastPrice: null,
      closePrice: null,
      unitsPerQuantity: 1,
    };
    if (key.startsWith(MCX_KEY_PREFIX)) {
      t.unitsPerQuantity = positivePrice(row.multiplier) ?? (contractFor(key) as PositionContract).lotSize;
    }
    const unit = t.unitsPerQuantity;
    t.overnightBuyQty += num(row.overnight_buy_quantity) * unit;
    t.overnightSellQty += num(row.overnight_sell_quantity) * unit;
    t.overnightBuyAmount += num(row.overnight_buy_amount);
    t.overnightSellAmount += num(row.overnight_sell_amount);
    t.dayBuyQty += num(row.day_buy_quantity) * unit;
    t.daySellQty += num(row.day_sell_quantity) * unit;
    t.dayBuyValue += num(row.day_buy_value);
    t.daySellValue += num(row.day_sell_value);
    t.lastPrice = positivePrice(row.last_price) ?? t.lastPrice;
    t.closePrice = positivePrice(row.close_price) ?? t.closePrice;
    totalsByKey.set(key, t);
  }

  // Net quantities come from the unsigned buy/sell counts rather than
  // Upstox's own `quantity`, so a short's sign never depends on how Upstox
  // chooses to report one.
  const positions: UpstoxPosition[] = [...totalsByKey].map(([instrumentKey, t]) => {
    const contract = contractFor(instrumentKey) as PositionContract;
    const quantity = t.overnightBuyQty + t.dayBuyQty - t.overnightSellQty - t.daySellQty;
    const averagePrice =
      quantity > 0
        ? round2((t.overnightBuyAmount + t.dayBuyValue) / (t.overnightBuyQty + t.dayBuyQty))
        : quantity < 0
          ? round2((t.overnightSellAmount + t.daySellValue) / (t.overnightSellQty + t.daySellQty))
          : null;
    return {
      instrumentKey,
      ...contract,
      // On MCX a lot is the multiplier's worth of units, whatever the instrument list says it is.
      lotSize: t.unitsPerQuantity > 1 ? t.unitsPerQuantity : contract.lotSize,
      quantity,
      overnightQuantity: t.overnightBuyQty - t.overnightSellQty,
      averagePrice,
      buyQuantity: t.overnightBuyQty + t.dayBuyQty,
      buyValue: round2(t.overnightBuyAmount + t.dayBuyValue),
      sellQuantity: t.overnightSellQty + t.daySellQty,
      sellValue: round2(t.overnightSellAmount + t.daySellValue),
      dayBuyQuantity: t.dayBuyQty,
      dayBuyValue: round2(t.dayBuyValue),
      daySellQuantity: t.daySellQty,
      daySellValue: round2(t.daySellValue),
      lastPrice: t.lastPrice,
      closePrice: t.closePrice,
      openedOn: null,
    };
  });

  // A position carried in from an earlier session started on some earlier
  // day the positions endpoint doesn't say — the trade history does. Best
  // effort: without it the sync just dates the position today.
  const carried = positions.filter((p) => p.quantity !== 0 && p.overnightQuantity !== 0);
  if (carried.length > 0) {
    const today = istDateString(Date.now());
    // Index F&O and MCX fills live in separate segments of the history.
    for (const segment of new Set<FillsSegment>(carried.map((p) => (p.instrumentKey.startsWith(MCX_KEY_PREFIX) ? "COM" : "FO")))) {
      if (fillsCache[segment]?.day === today) continue;
      const result = await getHistoricalFills(token, addDays(today, -OPENED_ON_LOOKBACK_DAYS), today, segment);
      if (!isUpstoxGetError(result)) fillsCache[segment] = { day: today, fills: result.fills };
    }
    for (const p of carried) {
      const mcx = p.instrumentKey.startsWith(MCX_KEY_PREFIX);
      const cache = fillsCache[mcx ? "COM" : "FO"];
      // MCX counts in lots, as its positions do; the commodity history had no trades to check that against, so
      // a miss here just leaves the position dated today, like any other position whose history can't be read.
      if (cache?.day === today) p.openedOn = openedOnFor(cache.fills, p, p.overnightQuantity, mcx ? p.lotSize : 1);
    }
  }

  // By expiry, then strike, then CE before PE. A future has neither strike nor CE/PE (null) and goes first in its month.
  positions.sort((a, b) =>
    a.expiry !== b.expiry
      ? a.expiry < b.expiry
        ? -1
        : 1
      : (a.strike ?? 0) !== (b.strike ?? 0)
        ? (a.strike ?? 0) - (b.strike ?? 0)
        : (a.optionType ?? "") < (b.optionType ?? "")
          ? -1
          : 1,
  );
  return NextResponse.json({ positions, otherCount });
}
