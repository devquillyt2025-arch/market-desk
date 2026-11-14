/**
 * Server side of the global-prices strip: fetches each market from Yahoo Finance's public chart feed.
 *
 * Yahoo wants a User-Agent (it answers 429 without one) but no key, and nothing about this app or its owner goes
 * with the request - only the symbols. The browser never calls Yahoo itself; it asks /api/global-markets, which
 * sits behind the PIN like every other route.
 *
 * Results are kept for a few seconds and shared: the strip on every open tab polls, and the feed itself only
 * moves about once a minute, so one fetch per few seconds serves them all and keeps the app off Yahoo's rate limit.
 */

import { GLOBAL_MARKETS, parseYahooChart, type GlobalMarketId, type GlobalMarketsResult } from "@/lib/globalMarkets";

const CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/";
const USER_AGENT = "MarketDesk";
const REQUEST_TIMEOUT_MS = 8000;

/** How long a good result is reused. */
export const FEED_TTL_MS = 8000;
/** A failed fetch is retried sooner, but not on every poll of every tab. */
export const FEED_FAILURE_TTL_MS = 3000;

type FeedOptions = { fetchImpl?: typeof fetch; now?: () => number };

let cached: { at: number; ttl: number; result: GlobalMarketsResult } | null = null;
let inFlight: Promise<GlobalMarketsResult> | null = null;

/** For tests: forget what was fetched. */
export function resetGlobalMarketsFeed(): void {
  cached = null;
  inFlight = null;
}

/**
 * One request to Yahoo's chart feed - `query` is everything after the symbol's path segment, e.g. `?interval=1d&range=1d` - as
 * parsed JSON, or null for a timeout, a dropped connection, a 429 or a body that isn't JSON. Callers treat null as "no price this time".
 */
export async function fetchYahooChart(symbol: string, query: string, fetchImpl: typeof fetch = fetch): Promise<unknown | null> {
  try {
    const res = await fetchImpl(`${CHART_URL}${encodeURIComponent(symbol)}${query}`, {
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchOne(id: GlobalMarketId, symbol: string, fetchImpl: typeof fetch) {
  // A missing market this time; the rest still show.
  return parseYahooChart(id, await fetchYahooChart(symbol, "?interval=1d&range=1d", fetchImpl));
}

/** Every market's latest price. A market Yahoo couldn't give is listed in `missing`; the others are unaffected. */
export async function getGlobalMarkets(options: FeedOptions = {}): Promise<GlobalMarketsResult> {
  const now = options.now ?? Date.now;
  if (cached && now() - cached.at < cached.ttl) return cached.result;
  if (inFlight) return inFlight;

  const fetchImpl = options.fetchImpl ?? fetch;
  const run = (async () => {
    const fetched = await Promise.all(GLOBAL_MARKETS.map((def) => fetchOne(def.id, def.symbol, fetchImpl)));
    const quotes = fetched.flatMap((quote) => (quote ? [quote] : []));
    const present = new Set(quotes.map((quote) => quote.id));
    const result: GlobalMarketsResult = {
      quotes,
      missing: GLOBAL_MARKETS.filter((def) => !present.has(def.id)).map((def) => def.id),
      fetchedAt: now(),
    };
    cached = { at: now(), ttl: quotes.length > 0 ? FEED_TTL_MS : FEED_FAILURE_TTL_MS, result };
    return result;
  })().finally(() => {
    inFlight = null;
  });
  inFlight = run;
  return run;
}
