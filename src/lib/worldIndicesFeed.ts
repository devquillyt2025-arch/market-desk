/**
 * Server side of the world indices: fetches each from Yahoo Finance's public chart feed, a few at a time.
 *
 * It is the same feed, and the same call (`fetchYahooChart`), as the global-prices strip - but kept apart from it. The
 * strip is five requests on every page, polled all session; this is forty-odd when the whole list is wanted (the request with no
 * `ids`), and an index moves little enough in a minute that a result is reused for 45 seconds across every open tab. A handful
 * of requests at once, rather than all together, keeps the app clear of Yahoo's rate limit.
 *
 * The ticker across the top of every page and the Watchlist's Global markets tab each ask for only the indices they show (`ids`),
 * so each index is cached and shared on its own: where their sets overlap it is one request between them, not two.
 */

import { fetchYahooChart } from "@/lib/globalMarketsFeed";
import { parseWorldChart, WORLD_INDICES, type WorldIndexDef, type WorldIndicesResult, type WorldQuote } from "@/lib/worldIndices";

/** How long a good result is reused. */
export const WORLD_FEED_TTL_MS = 45_000;
/** An index Yahoo had nothing for is asked again sooner, but not on every poll of every tab. */
export const WORLD_FEED_FAILURE_TTL_MS = 5_000;
/** Requests to Yahoo in flight at once, per call. */
export const WORLD_FEED_CONCURRENCY = 6;

type FeedOptions = {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Only these indices (ids it doesn't know are ignored). Every index when left out. */
  ids?: readonly string[];
};

type Entry = { at: number; ttl: number; quote: WorldQuote | null };

const cache = new Map<string, Entry>();
/** Indices being fetched right now, so a second caller waits for them instead of asking Yahoo again. */
const inFlight = new Map<string, Promise<void>>();

/** For tests: forget what was fetched. */
export function resetWorldIndicesFeed(): void {
  cache.clear();
  inFlight.clear();
}

/** `fn` over every item, at most `limit` at a time, results in the order of `items`. */
async function mapWithLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** The indices asked for, in the order of the list; all of them when `ids` is left out. */
function wantedIndices(ids: readonly string[] | undefined): readonly WorldIndexDef[] {
  if (!ids) return WORLD_INDICES;
  const wanted = new Set(ids);
  return WORLD_INDICES.filter((index) => wanted.has(index.id));
}

/** Whether `id` is an index this feed can fetch. */
export function isWorldIndexId(id: string): boolean {
  return WORLD_INDICES.some((index) => index.id === id);
}

/** Every wanted index's latest level. One Yahoo couldn't give is listed in `missing`; the others are unaffected. */
export async function getWorldIndices(options: FeedOptions = {}): Promise<WorldIndicesResult> {
  const now = options.now ?? Date.now;
  const fetchImpl = options.fetchImpl ?? fetch;
  const wanted = wantedIndices(options.ids);

  const isFresh = (entry: Entry | undefined) => entry !== undefined && now() - entry.at < entry.ttl;
  const toFetch = wanted.filter((index) => !isFresh(cache.get(index.id)) && !inFlight.has(index.id));

  if (toFetch.length > 0) {
    // Every index to be fetched is registered up front, not when its turn comes, so a caller arriving meanwhile waits for it.
    const done = new Map<string, () => void>();
    for (const index of toFetch) {
      inFlight.set(index.id, new Promise<void>((resolve) => done.set(index.id, resolve)));
    }
    void mapWithLimit(toFetch, WORLD_FEED_CONCURRENCY, async (index) => {
      let quote: WorldQuote | null = null;
      try {
        quote = parseWorldChart(index.id, await fetchYahooChart(index.id, "?interval=1d&range=1d", fetchImpl));
      } finally {
        cache.set(index.id, { at: now(), ttl: quote ? WORLD_FEED_TTL_MS : WORLD_FEED_FAILURE_TTL_MS, quote });
        inFlight.delete(index.id);
        done.get(index.id)?.();
      }
    }).catch(() => {
      // fetchYahooChart reports a failure as null, so nothing is expected here; the entries are settled in `finally` either way.
    });
  }

  await Promise.all(wanted.flatMap((index) => inFlight.get(index.id) ?? []));

  const entries = wanted.map((index) => ({ index, entry: cache.get(index.id) }));
  const quotes = entries.flatMap(({ entry }) => (entry?.quote ? [entry.quote] : []));
  const present = new Set(quotes.map((quote) => quote.id));
  return {
    quotes,
    missing: wanted.filter((index) => !present.has(index.id)).map((index) => index.id),
    fetchedAt: entries.reduce((latest, { entry }) => Math.max(latest, entry?.at ?? 0), 0) || now(),
  };
}
