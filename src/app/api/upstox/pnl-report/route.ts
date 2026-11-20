/**
 * Server-side proxy for Upstox's trade-wise P&L report — every closed F&O and
 * MCX round trip in one financial year, feeding Trade Entries' "Sync Upstox".
 * Same reasoning as option-chain/route.ts for living here.
 *
 * Query param: `fy`, the year the financial year starts in (2026 = FY
 * 2026-27, Apr 2026 – Mar 2027). Upstox builds the report overnight, so a
 * trade closed today shows up from tomorrow.
 *
 * Upstox keeps index options (segment FO) and MCX crude oil / gold (segment
 * COM) in separate reports, so both are read and added together. How their rows
 * become trades — merging fills, telling which leg came first, MCX counting in
 * lots — is in pnlTrades.ts.
 */

import { NextResponse, type NextRequest } from "next/server";

import { round2 } from "@/lib/calculateTrade";
import { isCommodityInstrument } from "@/lib/types";
import { getHistoricalFills, isUpstoxGetError, upstoxErrorResponse, type HistoricalFill } from "@/lib/upstox/api";
import { addCharges, getPnlCharges, getPnlReportRows, ZERO_CHARGES } from "@/lib/upstox/pnlReport";
import { datesNeedingFills, firstSideOf, groupReportRows, tradesFromGroups, withFutureExpiries } from "@/lib/upstox/pnlTrades";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import { JOURNAL_PNL_SEGMENTS, type UpstoxChargesBreakdown } from "@/lib/upstox/types";

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

  // A segment that can't be read fails the whole report: a journal entry for it would otherwise
  // look like one Upstox "has no record of" and be offered for deletion.
  const rowsBySegment = new Map<(typeof JOURNAL_PNL_SEGMENTS)[number], Record<string, unknown>[]>();
  for (const segment of JOURNAL_PNL_SEGMENTS) {
    const rowsResult = await getPnlReportRows(token, { segment, fyStart: fy });
    if (isUpstoxGetError(rowsResult)) return upstoxErrorResponse(rowsResult);
    rowsBySegment.set(segment, rowsResult.rows);
  }

  // Upstox's own charges for the year, all segments together — informational, so a failure here doesn't sink the report.
  let charges: UpstoxChargesBreakdown | null = null;
  for (const [segment, rows] of rowsBySegment) {
    if (rows.length === 0) continue;
    const chargesResult = await getPnlCharges(token, { segment, fyStart: fy });
    if (isUpstoxGetError(chargesResult)) {
      charges = null;
      break;
    }
    charges = addCharges(charges ?? ZERO_CHARGES, chargesResult.charges);
  }

  // The trade history is read once per segment, for the two things only it knows (best effort - the report is complete
  // without them):
  //  - Upstox names a future in the report by its underlying alone ("NIFTY"), no expiry month, so the contract's expiry
  //    is read off the fills of the dates it traded. A future the history can't place is still imported, without an expiry.
  //  - which leg of a same-day round trip came first; without it, those fall back to "buy".
  const fillsBySegment = new Map<(typeof JOURNAL_PNL_SEGMENTS)[number], HistoricalFill[]>();
  for (const segment of JOURNAL_PNL_SEGMENTS) {
    const rows = rowsBySegment.get(segment) ?? [];
    const dates = datesNeedingFills(rows);
    if (dates.length === 0) continue;
    const fillsResult = await getHistoricalFills(token, dates[0], dates[dates.length - 1], segment);
    if (isUpstoxGetError(fillsResult)) continue;
    fillsBySegment.set(segment, fillsResult.fills);
    rowsBySegment.set(segment, withFutureExpiries(rows, fillsResult.fills));
  }

  const { groups, otherCount, otherNames, grossPnl } = groupReportRows([...rowsBySegment.values()].flat());

  const firstSides = new Map<string, "BUY" | "SELL">();
  for (const [segment, fills] of fillsBySegment) {
    const sameDay = [...groups].filter(([, g]) => g.buyDate === g.sellDate && isCommodityInstrument(g.instrument) === (segment === "COM"));
    for (const [key, g] of sameDay) {
      const side = firstSideOf(g, fills);
      if (side) firstSides.set(key, side);
    }
  }

  return NextResponse.json({
    from,
    to,
    trades: tradesFromGroups(groups, firstSides),
    otherCount,
    otherNames: [...otherNames].sort(),
    grossPnl: round2(grossPnl),
    charges,
  });
}
