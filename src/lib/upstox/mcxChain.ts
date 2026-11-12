/**
 * Server-only: an option chain for an MCX crude / gold expiry, in the same
 * shape as Upstox's own `/v2/option/chain` — which answers an MCX underlying
 * with a successful, empty list, so it can't be used. Everything the chain
 * carries is available per contract from `/v3/market-quote/option-greek`
 * (LTP, previous close, OI, volume, IV and the four Greeks, MCX included), and
 * the strike ladder and underlying come from the instrument file (mcx.ts).
 *
 * Greeks are limited to 50 keys a call and a crude ladder is ~400 contracts,
 * so only a window of strikes around the money is fetched - plus whichever
 * strikes the caller holds, wherever they sit.
 */

import { isUpstoxGetError, num, upstoxData, upstoxGet, type UpstoxGetError } from "@/lib/upstox/api";
import { selectStrikes, mcxUnderlyingKeyId, type McxContracts } from "@/lib/upstox/mcx";
import type { CommodityInstrument } from "@/lib/types";
import type { UpstoxOptionChainStrike, UpstoxOptionLeg } from "@/lib/upstox/types";

/** Upstox's own per-call limit on the Greeks endpoint. */
const GREEKS_BATCH = 50;

type QuoteRow = {
  last_price?: unknown;
  cp?: unknown;
  oi?: unknown;
  volume?: unknown;
  iv?: unknown;
  delta?: unknown;
  gamma?: unknown;
  theta?: unknown;
  vega?: unknown;
};

/** Upstox keys its quote maps by a symbol ("MCX_FO:CRUDEOIL26NOV7800CE") but repeats the instrument key inside each row. */
function quotesByInstrumentKey(data: unknown): Map<string, QuoteRow> {
  const out = new Map<string, QuoteRow>();
  if (!data || typeof data !== "object") return out;
  for (const row of Object.values(data as Record<string, unknown>)) {
    const token = row && typeof row === "object" ? (row as { instrument_token?: unknown }).instrument_token : undefined;
    if (typeof token === "string") out.set(token, row as QuoteRow);
  }
  return out;
}

function legFrom(key: string | null, quotes: Map<string, QuoteRow>): UpstoxOptionLeg | undefined {
  if (!key) return undefined;
  const q = quotes.get(key);
  if (!q) return undefined;
  return {
    instrument_key: key,
    market_data: { ltp: num(q.last_price), close_price: num(q.cp), oi: num(q.oi), volume: num(q.volume) },
    option_greeks: {
      delta: num(q.delta),
      gamma: num(q.gamma),
      theta: num(q.theta),
      vega: num(q.vega),
      // The chain reports IV in percent (13.4); this endpoint as a fraction (0.134).
      iv: num(q.iv) * 100,
    },
  };
}

export async function fetchMcxChain(
  token: string,
  mcx: McxContracts,
  instrument: CommodityInstrument,
  expiry: string,
  extraStrikes: number[] = [],
): Promise<{ data: UpstoxOptionChainStrike[] } | UpstoxGetError> {
  const id = mcxUnderlyingKeyId(instrument, expiry);
  const underlyingKey = mcx.underlyingKeys.get(id);
  const ladder = mcx.ladders.get(id);
  if (!underlyingKey || !ladder) return { error: `No ${instrument} option expires on ${expiry}.`, status: 404 };

  // The futures price is the spot the options are written on - and tells which strikes are near the money.
  const spotResult = await upstoxGet(token, `/v3/market-quote/ltp?${new URLSearchParams({ instrument_key: underlyingKey })}`);
  if (isUpstoxGetError(spotResult)) return spotResult;
  const spotRow = quotesByInstrumentKey(upstoxData(spotResult.body)).get(underlyingKey);
  const spot = spotRow && num(spotRow.last_price) > 0 ? num(spotRow.last_price) : null;

  const strikes = selectStrikes(ladder, spot, extraStrikes);
  const keys = strikes.flatMap((s) => [s.ce, s.pe]).filter((k): k is string => k !== null);

  const batches: string[][] = [];
  for (let i = 0; i < keys.length; i += GREEKS_BATCH) batches.push(keys.slice(i, i + GREEKS_BATCH));
  const results = await Promise.all(
    batches.map((batch) => upstoxGet(token, `/v3/market-quote/option-greek?${new URLSearchParams({ instrument_key: batch.join(",") })}`)),
  );

  // All or nothing: a missing batch would leave strikes out, and a held one reads as "no price" rather than as an outage.
  const quotes = new Map<string, QuoteRow>();
  for (const result of results) {
    if (isUpstoxGetError(result)) return result;
    for (const [key, row] of quotesByInstrumentKey(upstoxData(result.body))) quotes.set(key, row);
  }

  const data: UpstoxOptionChainStrike[] = strikes.map((s) => ({
    expiry,
    strike_price: s.strike,
    underlying_key: underlyingKey,
    underlying_spot_price: spot ?? undefined,
    call_options: legFrom(s.ce, quotes),
    put_options: legFrom(s.pe, quotes),
  }));
  return { data };
}
