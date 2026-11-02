/**
 * Server-side proxy for Upstox's trade-wise P&L report — every closed F&O
 * round trip in one financial year, feeding Trade Entries' "Sync Upstox".
 * Same reasoning as option-chain/route.ts for living here.
 *
 * Query param: `fy`, the year the financial year starts in (2026 = FY
 * 2026-27, Apr 2026 – Mar 2027). Upstox builds the report overnight, so a
 * trade closed today shows up from tomorrow.
 *
 * Upstox lists one row per matched fill; rows of the same contract opened and
 * closed on the same two dates are merged into one trade. The report has no
 * notion of which leg came first, so that's read off the dates — or, for a
 * same-day round trip, off the exchange trade ids in the trade history.
 */

import { NextResponse, type NextRequest } from "next/server";

import { round2 } from "@/lib/calculateTrade";
import { DEFAULT_LOT_SIZES, type Instrument, type TradeEntryOptionType } from "@/lib/types";
import { compareTradeIds, getHistoricalFills, isUpstoxGetError, num, upstoxErrorResponse } from "@/lib/upstox/api";
import { getPnlCharges, getPnlReportRows } from "@/lib/upstox/pnlReport";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import type { UpstoxChargesBreakdown, UpstoxClosedTrade } from "@/lib/upstox/types";

/** The report's own name for each underlying (e.g. "NIFTY 09 Nov 2026 PE 23400"). */
const INSTRUMENT_BY_REPORT_NAME: Record<string, Instrument> = {
  NIFTY: "NIFTY",
  BANKNIFTY: "BANKNIFTY",
  SENSEX: "SENSEX",
};

/**
 * Lot sizes each index traded at before today's (DEFAULT_LOT_SIZES), most
 * recent first — the report only has quantities, and an older trade's lots
 * are only right against the lot size of its day. Best effort: the first size
 * the quantity divides evenly by wins. P&L doesn't depend on it, since it's
 * taken from Upstox's own amounts.
 */
const EARLIER_LOT_SIZES: Record<Instrument, number[]> = {
  NIFTY: [75, 25, 50],
  BANKNIFTY: [35, 15, 25],
  SENSEX: [10, 15],
};

const MONTHS: Record<string, string> = {
  JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06",
  JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12",
};

const OPTION_SCRIP = /^(.+?)\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(CE|PE)\s+(\d+(?:\.\d+)?)$/i;
const FUTURE_SCRIP = /^(.+?)\s+(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\b/;

type ParsedScrip = { name: string; instrument: Instrument | null; expiry: string; optionType: TradeEntryOptionType | null; strike: number | null };

function toExpiry(day: string, month: string, year: string): string | null {
  const mm = MONTHS[month.toUpperCase()];
  return mm ? `${year}-${mm}-${day.padStart(2, "0")}` : null;
}

function parseScrip(scrip: string, tradeType: unknown): ParsedScrip | null {
  const option = tradeType === "OPT" ? OPTION_SCRIP.exec(scrip.trim()) : null;
  if (option) {
    const [, name, day, month, year, type, strike] = option;
    const expiry = toExpiry(day, month, year);
    if (!expiry) return null;
    return {
      name,
      instrument: INSTRUMENT_BY_REPORT_NAME[name.toUpperCase()] ?? null,
      expiry,
      optionType: type.toUpperCase() as TradeEntryOptionType,
      strike: Number(strike),
    };
  }
  const future = tradeType === "FUT" ? FUTURE_SCRIP.exec(scrip.trim()) : null;
  if (future) {
    const [, name, day, month, year] = future;
    const expiry = toExpiry(day, month, year);
    if (!expiry) return null;
    return { name, instrument: INSTRUMENT_BY_REPORT_NAME[name.toUpperCase()] ?? null, expiry, optionType: null, strike: null };
  }
  return null;
}

/** "30-10-2026" → "2026-10-30". */
function reportDate(value: unknown): string | null {
  const match = typeof value === "string" ? /^(\d{2})-(\d{2})-(\d{4})$/.exec(value) : null;
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

function lotsFor(instrument: Instrument, quantity: number): number {
  for (const size of [DEFAULT_LOT_SIZES[instrument], ...EARLIER_LOT_SIZES[instrument]]) {
    if (quantity % size === 0) return quantity / size;
  }
  return Math.max(1, Math.round(quantity / DEFAULT_LOT_SIZES[instrument]));
}

type Group = ParsedScrip & { instrument: Instrument; buyDate: string; sellDate: string; quantity: number; buyAmount: number; sellAmount: number };

export async function GET(request: NextRequest) {
  const fy = Number(new URL(request.url).searchParams.get("fy"));
  if (!Number.isInteger(fy) || fy < 2000 || fy > 2098) {
    return NextResponse.json({ error: "Query param fy must be the year a financial year starts in, e.g. 2026." }, { status: 400 });
  }
  const from = `${fy}-04-01`;
  const to = `${fy + 1}-03-31`;

  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) {
    return NextResponse.json({ error: "token_expired" }, { status: 401 });
  }

  const rowsResult = await getPnlReportRows(token, { segment: "FO", fyStart: fy });
  if (isUpstoxGetError(rowsResult)) return upstoxErrorResponse(rowsResult);
  const { rows } = rowsResult;

  // Upstox's own charges for the year — informational, so a failure here doesn't sink the report.
  let charges: UpstoxChargesBreakdown | null = null;
  if (rows.length > 0) {
    const chargesResult = await getPnlCharges(token, { segment: "FO", fyStart: fy });
    if (!isUpstoxGetError(chargesResult)) charges = chargesResult.charges;
  }

  const groups = new Map<string, Group>();
  const otherNames = new Set<string>();
  let otherCount = 0;
  let grossPnl = 0;
  for (const row of rows) {
    grossPnl += num(row.sell_amount) - num(row.buy_amount);
    const parsed = typeof row.scrip_name === "string" ? parseScrip(row.scrip_name, row.trade_type) : null;
    const buyDate = reportDate(row.buy_date);
    const sellDate = reportDate(row.sell_date);
    const quantity = num(row.quantity);
    if (!parsed?.instrument || !buyDate || !sellDate || !(quantity > 0)) {
      otherCount++;
      otherNames.add(parsed?.name ?? (typeof row.scrip_name === "string" ? row.scrip_name : "Unknown"));
      continue;
    }
    const key = [parsed.instrument, parsed.expiry, parsed.strike ?? "FUT", parsed.optionType ?? "", buyDate, sellDate].join("|");
    const group = groups.get(key) ?? { ...parsed, instrument: parsed.instrument, buyDate, sellDate, quantity: 0, buyAmount: 0, sellAmount: 0 };
    group.quantity += quantity;
    group.buyAmount += num(row.buy_amount);
    group.sellAmount += num(row.sell_amount);
    groups.set(key, group);
  }

  // Which leg of each same-day round trip came first: its earliest fill that day.
  const sameDayDates = [...groups.values()].filter((g) => g.buyDate === g.sellDate).map((g) => g.buyDate).sort();
  const firstSideByGroup = new Map<string, "BUY" | "SELL">();
  if (sameDayDates.length > 0) {
    const fillsResult = await getHistoricalFills(token, sameDayDates[0], sameDayDates[sameDayDates.length - 1]);
    // Best effort — without it, same-day trades fall back to "buy".
    if (!isUpstoxGetError(fillsResult)) {
      for (const [key, g] of groups) {
        if (g.buyDate !== g.sellDate) continue;
        const first = fillsResult.fills
          .filter(
            (f) =>
              f.date === g.buyDate &&
              f.symbol === g.instrument &&
              f.expiry === g.expiry &&
              (g.optionType === null || (f.optionType === g.optionType && f.strike === g.strike)),
          )
          .sort((a, b) => compareTradeIds(a.tradeId, b.tradeId))[0];
        if (first) firstSideByGroup.set(key, first.side);
      }
    }
  }

  const trades: UpstoxClosedTrade[] = [...groups].map(([key, g]) => {
    const sellFirst = g.sellDate < g.buyDate || (g.sellDate === g.buyDate && firstSideByGroup.get(key) === "SELL");
    return {
      key,
      instrument: g.instrument,
      strike: g.strike,
      optionType: g.optionType,
      expiry: g.expiry,
      side: sellFirst ? "sell" : "buy",
      entryDate: sellFirst ? g.sellDate : g.buyDate,
      closingDate: sellFirst ? g.buyDate : g.sellDate,
      quantity: g.quantity,
      lots: lotsFor(g.instrument, g.quantity),
      buyPrice: round2(g.buyAmount / g.quantity),
      sellPrice: round2(g.sellAmount / g.quantity),
      pnl: round2(g.sellAmount - g.buyAmount),
    };
  });
  trades.sort((a, b) => (a.entryDate !== b.entryDate ? (a.entryDate < b.entryDate ? -1 : 1) : a.key < b.key ? -1 : 1));

  return NextResponse.json({
    from,
    to,
    trades,
    otherCount,
    otherNames: [...otherNames].sort(),
    grossPnl: round2(grossPnl),
    charges,
  });
}
