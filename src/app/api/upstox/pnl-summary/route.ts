/**
 * Server-side proxy for Upstox's "Trade summary" — gross/net P&L, charges
 * broken down, ROI, profit factor and win rate over a date range, the same
 * figures Upstox's own P&L screen shows, for Reports. Same reasoning as
 * option-chain/route.ts for living here.
 *
 * Query params: `segment` (FO or EQ, defaulting to FO), and `from` and `to`
 * (yyyy-mm-dd, inclusive), matched against the date each trade closed. Upstox
 * only answers one financial year per call, so a range across 31 March is
 * fetched as one piece per year and added up.
 */

import { NextResponse, type NextRequest } from "next/server";

import { round2 } from "@/lib/calculateTrade";
import { isUpstoxGetError, num, upstoxErrorResponse } from "@/lib/upstox/api";
import { fyStartOf, getPnlCharges, getPnlReportRows, type DateRange } from "@/lib/upstox/pnlReport";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import {
  UPSTOX_PNL_SEGMENTS,
  type UpstoxChargesBreakdown,
  type UpstoxPnlSegment,
  type UpstoxPnlSummary,
} from "@/lib/upstox/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isPnlSegment(value: string): value is UpstoxPnlSegment {
  return (UPSTOX_PNL_SEGMENTS as readonly string[]).includes(value);
}
/** Enough for "All" (three years) with room to spare, without letting a typo'd year 1900 fan out into a hundred calls. */
const MAX_YEARS = 5;

const ZERO_CHARGES: UpstoxChargesBreakdown = {
  total: 0,
  brokerage: 0,
  gst: 0,
  stt: 0,
  stampDuty: 0,
  transactionAndSebi: 0,
  clearing: 0,
  ipft: 0,
  demat: 0,
};

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const segment = searchParams.get("segment") ?? "FO";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!isPnlSegment(segment)) {
    return NextResponse.json({ error: `Unknown segment: ${segment}` }, { status: 400 });
  }
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
    return NextResponse.json({ error: "Query params from and to must be yyyy-mm-dd dates." }, { status: 400 });
  }
  if (from > to) {
    return NextResponse.json({ error: "The start date is after the end date." }, { status: 400 });
  }
  const firstYear = fyStartOf(from);
  const lastYear = fyStartOf(to);
  if (lastYear - firstYear + 1 > MAX_YEARS) {
    return NextResponse.json({ error: `Pick a range of at most ${MAX_YEARS} financial years.` }, { status: 400 });
  }

  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) {
    return NextResponse.json({ error: "token_expired" }, { status: 401 });
  }

  const pieces: { fyStart: number; range: DateRange }[] = [];
  for (let fy = firstYear; fy <= lastYear; fy++) {
    pieces.push({
      fyStart: fy,
      range: { from: fy === firstYear ? from : `${fy}-04-01`, to: fy === lastYear ? to : `${fy + 1}-03-31` },
    });
  }

  const summary: UpstoxPnlSummary = {
    segment,
    from,
    to,
    tradeCount: 0,
    winningCount: 0,
    grossPnl: 0,
    winningPnl: 0,
    losingPnl: 0,
    buyValue: 0,
    charges: { ...ZERO_CHARGES },
  };

  for (const { fyStart, range } of pieces) {
    const rowsResult = await getPnlReportRows(token, { segment, fyStart, range });
    if (isUpstoxGetError(rowsResult)) return upstoxErrorResponse(rowsResult);
    if (rowsResult.rows.length === 0) continue;

    for (const row of rowsResult.rows) {
      const buy = num(row.buy_amount);
      const pnl = num(row.sell_amount) - buy;
      summary.tradeCount++;
      summary.buyValue += buy;
      summary.grossPnl += pnl;
      if (pnl > 0) {
        summary.winningCount++;
        summary.winningPnl += pnl;
      } else if (pnl < 0) {
        summary.losingPnl += pnl;
      }
    }

    const chargesResult = await getPnlCharges(token, { segment, fyStart, range });
    if (isUpstoxGetError(chargesResult)) return upstoxErrorResponse(chargesResult);
    for (const key of Object.keys(ZERO_CHARGES) as (keyof UpstoxChargesBreakdown)[]) {
      summary.charges[key] = round2(summary.charges[key] + chargesResult.charges[key]);
    }
  }

  summary.grossPnl = round2(summary.grossPnl);
  summary.winningPnl = round2(summary.winningPnl);
  summary.losingPnl = round2(summary.losingPnl);
  summary.buyValue = round2(summary.buyValue);
  return NextResponse.json(summary);
}
