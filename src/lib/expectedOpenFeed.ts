/**
 * Server side of the expected MCX open (the arithmetic and rules are in expectedOpen.ts): gathers, for natural gas and
 * crude oil, MCX's last price and the time it last traded (Upstox), then the price of the NYMEX contract it follows at
 * that moment and now (Yahoo Finance).
 *
 * Only MCX's *front-month future* is asked of Upstox - one quote call for both - and when every market is trading, that
 * is all that happens: Yahoo is not touched while MCX is open.
 *
 * The NYMEX price at the moment MCX last traded can never change once it is known, so it is kept for good (a few numbers
 * a day) and fetched once, as a small window of 1-minute candles around that moment. The current NYMEX price is what
 * moves, and the whole result is shared for a few seconds between tabs so the polls don't each cost a round of requests.
 */

import {
  assembleExpectedOpen,
  EXPECTED_OPEN_MARKETS,
  nymexContractFor,
  parseMcxQuote,
  type ExpectedOpenError,
  type ExpectedOpenMarket,
  type ExpectedOpenResult,
  type MarketInput,
} from "@/lib/expectedOpen";
import { fetchYahooChart } from "@/lib/globalMarketsFeed";
import { parseYahooCandles, parseYahooMeta, priceBefore } from "@/lib/globalMarkets";
import { contractMonthLabel } from "@/lib/mcxCommodities";
import { isUpstoxGetError, upstoxData, upstoxGet } from "@/lib/upstox/api";
import { getMcxContracts, isMcxError, type McxFuture } from "@/lib/upstox/mcx";

/** How long a whole result is reused. */
export const EXPECTED_OPEN_TTL_MS = 10_000;
/** Yahoo keeps 1-minute candles for about a month; asking further back than this would only fail. */
const MAX_REFERENCE_AGE_MS = 25 * 86_400_000;
const MAX_REFERENCES = 60;

type Quote = { price: number; lastTradeMs: number | null };

export type ExpectedOpenDeps = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** The current-month future of each market, by MCX symbol. */
  getFutures?: () => Promise<Map<string, McxFuture> | { error: string; status: number }>;
  /** Upstox quotes for the given instrument keys, by key. */
  getQuotes?: (token: string, keys: string[]) => Promise<Map<string, Quote> | { error: string; status: number }>;
};

const references = new Map<string, number>();
let cached: { at: number; result: ExpectedOpenResult } | null = null;
let inFlight: Promise<ExpectedOpenResult | ExpectedOpenError> | null = null;

/** For tests: forget everything fetched. */
export function resetExpectedOpenFeed(): void {
  references.clear();
  cached = null;
  inFlight = null;
}

async function defaultGetFutures() {
  const mcx = await getMcxContracts();
  return isMcxError(mcx) ? { error: mcx.error, status: mcx.status } : mcx.futures;
}

async function defaultGetQuotes(token: string, keys: string[]) {
  const result = await upstoxGet(token, `/v2/market-quote/quotes?${new URLSearchParams({ instrument_key: keys.join(",") })}`);
  if (isUpstoxGetError(result)) return { error: result.error, status: result.status };
  const data = upstoxData(result.body);
  const out = new Map<string, Quote>();
  if (data && typeof data === "object") {
    // Matched on each entry's own instrument_token: the response's object key is Upstox's own format to change.
    for (const entry of Object.values(data as Record<string, { instrument_token?: string }>)) {
      const parsed = parseMcxQuote(entry);
      if (entry?.instrument_token && parsed) out.set(entry.instrument_token, parsed);
    }
  }
  return out;
}

/**
 * The NYMEX contract's price at `closeMs`, or null while it isn't known yet - Yahoo runs ~10 minutes behind, so for a
 * few minutes after MCX closes the candles for that moment haven't arrived. Only a found price is kept.
 */
async function nymexAtClose(symbol: string, closeMs: number, nowMs: number, fetchImpl: typeof fetch): Promise<number | null> {
  const key = `${symbol}@${closeMs}`;
  const known = references.get(key);
  if (known !== undefined) return known;
  if (nowMs - closeMs > MAX_REFERENCE_AGE_MS) return null;

  const from = Math.floor(closeMs / 1000) - 1800;
  const to = Math.floor(closeMs / 1000) + 600;
  const body = await fetchYahooChart(symbol, `?interval=1m&period1=${from}&period2=${to}`, fetchImpl);
  const price = priceBefore(parseYahooCandles(body), closeMs);
  if (price === null) return null;

  if (references.size >= MAX_REFERENCES) references.delete(references.keys().next().value as string);
  references.set(key, price);
  return price;
}

async function build(token: string, deps: Required<Pick<ExpectedOpenDeps, "fetchImpl" | "now" | "getFutures" | "getQuotes">>): Promise<ExpectedOpenResult | ExpectedOpenError> {
  const futures = await deps.getFutures();
  if ("error" in futures) return { error: futures.error };

  const futureOf = new Map<ExpectedOpenMarket, McxFuture | undefined>(EXPECTED_OPEN_MARKETS.map((m) => [m, futures.get(m)]));
  const keys = [...futureOf.values()].flatMap((f) => (f ? [f.key] : []));
  const quoted = keys.length > 0 ? await deps.getQuotes(token, keys) : new Map<string, Quote>();
  if (!(quoted instanceof Map)) return { error: quoted.error };

  const nowMs = deps.now();
  // First pass, with no NYMEX prices yet: all it settles is which markets are shut (from the clock and the last trade).
  const gathered = EXPECTED_OPEN_MARKETS.map((market): MarketInput => {
    const future = futureOf.get(market);
    if (!future) return { market, contract: null, mcx: null, nymex: null };
    const contract = { label: contractMonthLabel(future.expiry), expiry: future.expiry };
    const mcx = quoted.get(future.key) ?? null;
    const nymex = nymexContractFor(market, future.expiry);
    return { market, contract, mcx, nymex: nymex ? { ...nymex, atClose: null, now: null } : null };
  });

  // Yahoo is only asked about the markets that are shut - while MCX trades, none of it is touched.
  const shut = assembleExpectedOpen(nowMs, gathered);
  const needed = new Set(shut.items.map((item) => item.market));
  if (needed.size === 0) return shut;

  const filled = await Promise.all(
    gathered.map(async (input): Promise<MarketInput> => {
      if (!needed.has(input.market) || !input.mcx || !input.nymex) return input;
      const closeMs = input.mcx.lastTradeMs;
      const [atClose, current] = await Promise.all([
        closeMs === null ? Promise.resolve(null) : nymexAtClose(input.nymex.symbol, closeMs, nowMs, deps.fetchImpl),
        fetchYahooChart(input.nymex.symbol, "?interval=1d&range=1d", deps.fetchImpl).then(parseYahooMeta),
      ]);
      return { ...input, nymex: { ...input.nymex, atClose, now: current ? { price: current.price, asOf: current.asOf } : null } };
    }),
  );
  return assembleExpectedOpen(nowMs, filled);
}

/** Where natural gas and crude oil are expected to open, or an error from Upstox ("token_expired" when its token has lapsed). */
export async function getExpectedOpen(token: string, deps: ExpectedOpenDeps = {}): Promise<ExpectedOpenResult | ExpectedOpenError> {
  const resolved = {
    fetchImpl: deps.fetchImpl ?? fetch,
    now: deps.now ?? Date.now,
    getFutures: deps.getFutures ?? defaultGetFutures,
    getQuotes: deps.getQuotes ?? defaultGetQuotes,
  };
  if (cached && resolved.now() - cached.at < EXPECTED_OPEN_TTL_MS) return cached.result;
  if (inFlight) return inFlight;

  const run = build(token, resolved)
    .then((result) => {
      // Only a good result is shared; an Upstox error (a lapsed token) should be retried on the next poll.
      if (!("error" in result)) cached = { at: resolved.now(), result };
      return result;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = run;
  return run;
}
