/**
 * Server-side proxy for the charges Upstox shows beside its trade summary - brokerage, taxes, exchange fees - over a date
 * range, for Reports' Net P&L. Same reasoning as option-chain/route.ts for living here.
 *
 * Query params: `segment` (FO, COM for MCX, EQ, or ALL for F&O and MCX added together; defaulting to ALL), and `from` and
 * `to` (yyyy-mm-dd, inclusive), matched against the date each trade closed. Upstox only answers one financial year per
 * call, so a range across 31 March is fetched as one piece per year and added up. The trades themselves, and the P&L,
 * are /api/upstox/pnl-trades.
 *
 * The figures are Upstox's own, so they can include the costs of a position still open - one the P&L report, which is built
 * overnight, doesn't list yet.
 */

import { NextResponse, type NextRequest } from "next/server";

import { isUpstoxGetError, upstoxErrorResponse } from "@/lib/upstox/api";
import { addCharges, fyStartOf, getPnlCharges, ZERO_CHARGES, type DateRange } from "@/lib/upstox/pnlReport";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import {
  segmentsOfScope,
  UPSTOX_SUMMARY_SCOPES,
  type UpstoxChargesBreakdown,
  type UpstoxPnlCharges,
  type UpstoxSummaryScope,
} from "@/lib/upstox/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function isScope(value: string): value is UpstoxSummaryScope {
  return (UPSTOX_SUMMARY_SCOPES as readonly string[]).includes(value);
}
/** Enough for "All" (three years) with room to spare, without letting a typo'd year 1900 fan out into a hundred calls. */
const MAX_YEARS = 5;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("segment") ?? "ALL";
  const from = searchParams.get("from") ?? "";
  const to = searchParams.get("to") ?? "";
  if (!isScope(scope)) {
    return NextResponse.json({ error: `Unknown segment: ${scope}` }, { status: 400 });
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

  // Every segment and year is its own call; one failing fails the answer - half the charges would read as all of them.
  const results = await Promise.all(segmentsOfScope(scope).flatMap((segment) => pieces.map(({ fyStart, range }) => getPnlCharges(token, { segment, fyStart, range }))));
  let charges: UpstoxChargesBreakdown = { ...ZERO_CHARGES };
  for (const result of results) {
    if (isUpstoxGetError(result)) return upstoxErrorResponse(result);
    charges = addCharges(charges, result.charges);
  }

  const body: UpstoxPnlCharges = { scope, from, to, charges };
  return NextResponse.json(body);
}
