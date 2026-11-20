/**
 * Server-side proxy for Upstox's trade-wise P&L report, for Reports: every row of the last three financial years, in every
 * segment (F&O, MCX, equity), read as a trade. Reports is built from this, so it follows Upstox's own report - the same
 * rows it counts, every underlying it lists - not the Trade Entries journal. Same reasoning as option-chain/route.ts for
 * living here.
 *
 * Three years is as far back as Trade Entries' Upstox sync goes, and covers the calendar and account-growth views, which
 * look at the whole history; the time frame the page is on is cut from this in the browser. Upstox builds the report
 * overnight, so a trade closed today shows up from tomorrow. How a row becomes a trade is in lib/upstox/reportTrades.ts.
 */

import { NextResponse } from "next/server";

import { isUpstoxGetError, upstoxErrorResponse, type UpstoxGetError } from "@/lib/upstox/api";
import { fyStartOf, getPnlReportRows } from "@/lib/upstox/pnlReport";
import { reportRowsToTrades } from "@/lib/upstox/reportTrades";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import { UPSTOX_PNL_SEGMENTS, type UpstoxPnlTradesSuccess, type UpstoxReportTrade } from "@/lib/upstox/types";

const YEARS_BACK = 2;

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

  const thisYear = fyStartOf(new Date().toISOString().slice(0, 10));
  const years = Array.from({ length: YEARS_BACK + 1 }, (_, i) => thisYear - YEARS_BACK + i);

  // A segment-year that can't be read fails the whole answer: a report with a year missing would read as the whole of it.
  const reads = await Promise.all(
    UPSTOX_PNL_SEGMENTS.flatMap((segment) =>
      years.map(async (fyStart): Promise<UpstoxReportTrade[] | UpstoxGetError> => {
        const result = await getPnlReportRows(token, { segment, fyStart });
        return isUpstoxGetError(result) ? result : reportRowsToTrades(result.rows, segment);
      }),
    ),
  );

  const trades: UpstoxReportTrade[] = [];
  for (const read of reads) {
    if (isUpstoxGetError(read)) return upstoxErrorResponse(read);
    trades.push(...read);
  }
  trades.sort((a, b) => (a.closing_date !== b.closing_date ? (a.closing_date < b.closing_date ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));

  const body: UpstoxPnlTradesSuccess = { from: `${years[0]}-04-01`, trades, fetchedAt: Date.now() };
  return NextResponse.json(body);
}
