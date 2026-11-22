/**
 * Server-side proxy for one future's live quote (an index future or an MCX commodity future) — what prices a futures
 * position in Live Portfolio. Same reasoning as option-chain/route.ts for living here: the token stays server-side.
 *
 * `GET ?instrument=NIFTY&expiry=2026-12-29` -> `{ instrumentKey, ltp, prevClose, oi, volume }`. A future has no
 * row in an option chain, and its instrument key is only in Upstox's instrument file (see futures.ts for the indices,
 * mcx.ts for the commodities), so the contract is looked up there and then quoted with the same call the Watchlist uses.
 */

import { NextResponse } from "next/server";

import { isUpstoxGetError, upstoxData, upstoxErrorResponse, upstoxGet } from "@/lib/upstox/api";
import { futureContractId, futuresExchangeFor, getIndexFutures, parseFutureQuote } from "@/lib/upstox/futures";
import { getMcxContracts, isMcxError, mcxFutureKey } from "@/lib/upstox/mcx";
import { getUpstoxAccessToken } from "@/lib/upstox/token";
import { COMMODITY_INSTRUMENTS, INDEX_INSTRUMENTS, type CommodityInstrument, type IndexInstrument } from "@/lib/types";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isIndex = (value: string): value is IndexInstrument => (INDEX_INSTRUMENTS as readonly string[]).includes(value);
const isCommodity = (value: string): value is CommodityInstrument => (COMMODITY_INSTRUMENTS as readonly string[]).includes(value);

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const instrument = searchParams.get("instrument");
  const expiry = searchParams.get("expiry");
  if (!instrument || !(isIndex(instrument) || isCommodity(instrument)) || !expiry || !ISO_DATE.test(expiry)) {
    return NextResponse.json({ error: "Query must be ?instrument=NIFTY|BANKNIFTY|SENSEX|<an MCX commodity>&expiry=yyyy-mm-dd." }, { status: 400 });
  }

  let token: string | null;
  try {
    token = await getUpstoxAccessToken();
  } catch {
    return NextResponse.json({ error: "Couldn't read the Upstox token from the database." }, { status: 500 });
  }
  if (!token) return NextResponse.json({ error: "token_expired" }, { status: 401 });

  let key: string | null;
  if (isIndex(instrument)) {
    const futures = await getIndexFutures([futuresExchangeFor(instrument)]);
    if (isUpstoxGetError(futures)) return upstoxErrorResponse(futures);
    key = futures.keyByContract.get(futureContractId(instrument, expiry)) ?? null;
  } else {
    const mcx = await getMcxContracts();
    if (isMcxError(mcx)) return upstoxErrorResponse(mcx);
    key = mcxFutureKey(mcx.contracts, instrument as CommodityInstrument, expiry);
  }
  if (!key) {
    return NextResponse.json({ error: `No ${instrument} future is listed for ${expiry}.` }, { status: 404 });
  }

  const result = await upstoxGet(token, `/v2/market-quote/quotes?${new URLSearchParams({ instrument_key: key })}`);
  if (isUpstoxGetError(result)) return upstoxErrorResponse(result);

  const data = upstoxData(result.body);
  if (!data || typeof data !== "object") {
    return NextResponse.json({ error: "Upstox's quote response was missing the expected data." }, { status: 502 });
  }
  // Match on the entry's own `instrument_token`: the response's object key is `NSE_FO:NIFTY26DECFUT`, Upstox's own format.
  const entry = Object.values(data as Record<string, { instrument_token?: string }>).find((e) => e?.instrument_token === key);
  const quote = parseFutureQuote(entry, key);
  if (!quote) return NextResponse.json({ error: "Upstox has no price for this future yet." }, { status: 502 });
  return NextResponse.json(quote);
}
