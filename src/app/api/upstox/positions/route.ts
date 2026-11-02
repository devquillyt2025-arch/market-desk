/**
 * Server-side proxy for Upstox's positions endpoint — the account's open
 * F&O positions (and anything squared off today), feeding Live Portfolio's
 * sync. Same reasoning as option-chain/route.ts for living here: the token
 * stays server-side.
 *
 * Upstox only gives each position an opaque instrument token, so every one is
 * matched to its contract (see contracts.ts) and returned already reduced to
 * the instrument / strike / CE-PE / expiry this app stores. Anything that
 * isn't a Nifty / Bank Nifty / Sensex option is counted, not returned.
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
  type HistoricalFill,
} from "@/lib/upstox/api";
import { getOptionContracts, type OptionContract } from "@/lib/upstox/contracts";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import type { UpstoxPosition } from "@/lib/upstox/types";

/** How far back to look for when a carried position was opened — past the longest-dated monthly most people hold. */
const OPENED_ON_LOOKBACK_DAYS = 120;

/** Fills only change once a day (Upstox adds each day's the next morning), so they're fetched at most once per IST day. */
let fillsCache: { day: string; fills: HistoricalFill[] } | null = null;

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
function openedOnFor(fills: HistoricalFill[], contract: OptionContract, overnightQuantity: number): string | null {
  const side = overnightQuantity > 0 ? "BUY" : "SELL";
  const matching = fills
    .filter(
      (f) =>
        f.side === side &&
        f.symbol === contract.instrument &&
        f.optionType === contract.optionType &&
        f.strike === contract.strike &&
        f.expiry === contract.expiry,
    )
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : compareTradeIds(b.tradeId, a.tradeId)));

  let remaining = Math.abs(overnightQuantity);
  let openedOn: string | null = null;
  for (const fill of matching) {
    openedOn = fill.date;
    remaining -= fill.quantity;
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

  // NRML and intraday rows of the same contract are one position as far as
  // this app is concerned — summed here, by instrument token.
  const totalsByKey = new Map<string, Totals>();
  let otherCount = 0;
  for (const row of rows as Record<string, unknown>[]) {
    const key = row.instrument_token;
    if (typeof key !== "string" || !contracts.has(key)) {
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
    };
    t.overnightBuyQty += num(row.overnight_buy_quantity);
    t.overnightSellQty += num(row.overnight_sell_quantity);
    t.overnightBuyAmount += num(row.overnight_buy_amount);
    t.overnightSellAmount += num(row.overnight_sell_amount);
    t.dayBuyQty += num(row.day_buy_quantity);
    t.daySellQty += num(row.day_sell_quantity);
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
    const contract = contracts.get(instrumentKey) as OptionContract;
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
    if (fillsCache?.day !== today) {
      const result = await getHistoricalFills(token, addDays(today, -OPENED_ON_LOOKBACK_DAYS), today);
      if (!isUpstoxGetError(result)) fillsCache = { day: today, fills: result.fills };
    }
    if (fillsCache?.day === today) {
      for (const p of carried) p.openedOn = openedOnFor(fillsCache.fills, p, p.overnightQuantity);
    }
  }

  positions.sort((a, b) =>
    a.expiry !== b.expiry ? (a.expiry < b.expiry ? -1 : 1) : a.strike !== b.strike ? a.strike - b.strike : a.optionType < b.optionType ? -1 : 1,
  );
  return NextResponse.json({ positions, otherCount });
}
