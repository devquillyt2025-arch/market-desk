/**
 * The global-prices strip: reading Yahoo's chart response, the rupee-priced WTI, the change and staleness rules,
 * and the server feed's sharing of one fetch. The fixtures are real responses from 13 Nov 2026 (trimmed to `meta`).
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  buildStrip,
  changeOf,
  GLOBAL_MARKETS,
  isGlobalMarketsError,
  isGlobalQuote,
  isStale,
  marketsStatus,
  parseYahooChart,
  quotesById,
  wtiInRupees,
  type GlobalQuote,
} from "@/lib/globalMarkets";
import { FEED_FAILURE_TTL_MS, FEED_TTL_MS, getGlobalMarkets, resetGlobalMarketsFeed } from "@/lib/globalMarketsFeed";

function chart(meta: Record<string, unknown>) {
  return { chart: { result: [{ meta }], error: null } };
}

const WTI_META = {
  currency: "USD",
  symbol: "CL=F",
  regularMarketTime: 1794593987,
  regularMarketPrice: 88.71,
  regularMarketChangePercent: -0.034,
  regularMarketDayHigh: 89.64,
  regularMarketDayLow: 87.8,
  chartPreviousClose: 88.74,
  previousClose: 88.74,
};

describe("reading a Yahoo chart response", () => {
  it("takes the live price, the previous close, the day's range and the time of the last update", () => {
    assert.deepEqual(parseYahooChart("WTI", chart(WTI_META)), {
      id: "WTI",
      price: 88.71,
      previousClose: 88.74,
      asOf: 1794593987 * 1000,
      dayHigh: 89.64,
      dayLow: 87.8,
    });
  });

  it("uses the 1-day response, which has no previousClose but has chartPreviousClose", () => {
    assert.equal(parseYahooChart("WTI", chart({ ...WTI_META, previousClose: undefined }))?.previousClose, 88.74);
  });

  it("keeps a price that has no previous close or range, and leaves the change out", () => {
    const quote = parseYahooChart("GOLD", chart({ regularMarketPrice: 3890.3, regularMarketTime: 1794593986 }));
    assert.ok(quote);
    assert.equal(quote.previousClose, null);
    assert.equal(quote.dayHigh, null);
    assert.equal(changeOf(quote), null);
  });

  it("returns nothing for a response without a usable price", () => {
    assert.equal(parseYahooChart("WTI", null), null);
    assert.equal(parseYahooChart("WTI", {}), null);
    assert.equal(parseYahooChart("WTI", { chart: { result: null, error: { code: "Not Found" } } }), null);
    assert.equal(parseYahooChart("WTI", chart({ regularMarketTime: 1794593987 })), null); // no price
    assert.equal(parseYahooChart("WTI", chart({ regularMarketPrice: 0, regularMarketTime: 1794593987 })), null);
    assert.equal(parseYahooChart("WTI", chart({ regularMarketPrice: "88.7", regularMarketTime: 1794593987 })), null);
    assert.equal(parseYahooChart("WTI", chart({ regularMarketPrice: 88.7 })), null); // no time
  });

  it("ignores a previous close that makes no sense", () => {
    const quote = parseYahooChart("WTI", chart({ ...WTI_META, chartPreviousClose: 0, previousClose: undefined }));
    assert.equal(quote?.previousClose, null);
  });
});

describe("the change since the previous close", () => {
  it("is the move and its percentage", () => {
    const move = changeOf({ price: 94.23, previousClose: 94.04 });
    assert.ok(move);
    assert.ok(Math.abs(move.change - 0.19) < 1e-9);
    assert.ok(Math.abs(move.percent - 0.2020) < 1e-3);
  });

  it("is negative when the price is down", () => {
    assert.ok((changeOf({ price: 88.63, previousClose: 88.74 })?.percent ?? 0) < 0);
  });
});

describe("a stored or received quote", () => {
  const good: GlobalQuote = { id: "BRENT", price: 95.86, previousClose: 95.82, asOf: 1, dayHigh: null, dayLow: null };

  it("is accepted when it is what this module produces", () => {
    assert.equal(isGlobalQuote(good), true);
  });

  it("is refused when anything is off, so a corrupt saved set can't put NaN on the strip", () => {
    assert.equal(isGlobalQuote(null), false);
    assert.equal(isGlobalQuote({ ...good, id: "SILVER" }), false);
    assert.equal(isGlobalQuote({ ...good, price: NaN }), false);
    assert.equal(isGlobalQuote({ ...good, price: -1 }), false);
    assert.equal(isGlobalQuote({ ...good, price: "95.86" }), false);
    assert.equal(isGlobalQuote({ ...good, asOf: undefined }), false);
    assert.equal(isGlobalQuote({ ...good, previousClose: "x" }), false);
  });

  it("tells an error from a result", () => {
    assert.equal(isGlobalMarketsError({ error: "x" }), true);
    assert.equal(isGlobalMarketsError({ quotes: [], missing: [], fetchedAt: 0 }), false);
  });
});

describe("WTI in rupees", () => {
  const wti: GlobalQuote = { id: "WTI", price: 88.71, previousClose: 88.74, asOf: 1000, dayHigh: 89.64, dayLow: 87.8 };
  const rate: GlobalQuote = { id: "USDINR", price: 94.23, previousClose: 94.04, asOf: 5, dayHigh: null, dayLow: null };

  it("is the dollar price times the rupee rate, aged like WTI", () => {
    const rupees = wtiInRupees({ WTI: wti, USDINR: rate });
    assert.ok(rupees);
    assert.ok(Math.abs(rupees.price - 88.71 * 94.23) < 1e-9);
    assert.equal(rupees.asOf, 1000);
  });

  it("moves with both the oil price and the rate - its previous close is the product of theirs", () => {
    const rupees = wtiInRupees({ WTI: wti, USDINR: rate });
    assert.ok(rupees);
    assert.ok(Math.abs((rupees.previousClose ?? 0) - 88.74 * 94.04) < 1e-9);
    // Oil down 0.03%, rupee down 0.20%: in rupees, up about 0.17%.
    const move = changeOf(rupees);
    assert.ok(move && move.percent > 0.16 && move.percent < 0.18);
  });

  it("has no change when either previous close is missing", () => {
    assert.equal(changeOf(wtiInRupees({ WTI: wti, USDINR: { ...rate, previousClose: null } })!), null);
  });

  it("is nothing until both prices are in", () => {
    assert.equal(wtiInRupees({ WTI: wti }), null);
    assert.equal(wtiInRupees({ USDINR: rate }), null);
  });
});

describe("the strip", () => {
  const quote = (id: GlobalQuote["id"], price: number): GlobalQuote => ({ id, price, previousClose: price, asOf: 0, dayHigh: null, dayLow: null });

  it("lists every market in order, with WTI in rupees right after the rupee rate", () => {
    const keys = buildStrip({}).map((item) => item.key);
    assert.deepEqual(keys, ["WTI", "BRENT", "USDINR", "WTI_INR", "NATGAS", "GOLD"]);
    assert.equal(keys.length, GLOBAL_MARKETS.length + 1);
  });

  it("leaves a market without a price empty rather than dropping its tile", () => {
    const items = buildStrip({ WTI: quote("WTI", 88.71) });
    assert.equal(items.find((i) => i.key === "WTI")?.quote?.price, 88.71);
    assert.equal(items.find((i) => i.key === "BRENT")?.quote, null);
    assert.equal(items.find((i) => i.key === "WTI_INR")?.quote, null);
  });

  it("formats each price the way its market quotes it", () => {
    const items = Object.fromEntries(buildStrip({}).map((i) => [i.key, i.format]));
    assert.equal(items.WTI(88.7), "$88.70");
    assert.equal(items.BRENT(1234.5), "$1,234.50");
    assert.equal(items.USDINR(94.2), "₹94.20");
    assert.equal(items.NATGAS(3.25), "$3.250");
    assert.equal(items.GOLD(3889), "$3,889.0");
    assert.equal(items.WTI_INR(8352.54), "₹8,353");
    assert.equal(items.WTI_INR(123456.7), "₹1,23,457"); // Indian digit grouping
  });

  it("maps a list of quotes by market", () => {
    const map = quotesById([quote("WTI", 1), quote("GOLD", 2)]);
    assert.equal(map.WTI?.price, 1);
    assert.equal(map.GOLD?.price, 2);
    assert.equal(map.BRENT, undefined);
  });
});

describe("how the prices stand", () => {
  const FRESH = 10_000_000;
  const at = (asOf: number): Partial<Record<GlobalQuote["id"], GlobalQuote>> => ({
    WTI: { id: "WTI", price: 88.7, previousClose: 88.8, asOf, dayHigh: null, dayLow: null },
    BRENT: { id: "BRENT", price: 95.8, previousClose: 95.9, asOf, dayHigh: null, dayLow: null },
  });
  const status = (quotes: ReturnType<typeof at>, over: Partial<Parameters<typeof marketsStatus>[0]> = {}) =>
    marketsStatus({ items: buildStrip(quotes), loading: false, offline: false, feedError: null, reference: FRESH, ...over });

  it("is live when the crude prices are recent, and says they are delayed", () => {
    const s = status(at(FRESH - 11 * 60_000));
    assert.equal(s.tone, "live");
    assert.equal(s.tag, null);
    assert.match(s.summary, /Delayed ~10 min/);
  });

  it("is closed when both crude prices are old", () => {
    const s = status(at(FRESH - 6 * 3600_000));
    assert.equal(s.tone, "closed");
    assert.equal(s.tag, "Closed");
  });

  it("is not closed when only one crude price is old - the other is still moving", () => {
    const quotes = at(FRESH - 60_000);
    quotes.BRENT = { ...quotes.BRENT!, asOf: FRESH - 6 * 3600_000 };
    assert.equal(status(quotes).tone, "live");
  });

  it("does not call a missing crude price a closed market - that is a feed problem", () => {
    const quotes = at(FRESH - 6 * 3600_000);
    delete quotes.BRENT;
    assert.equal(status(quotes).tone, "live");
  });

  it("puts a problem ahead of everything, offline before a feed error", () => {
    assert.deepEqual([status(at(FRESH), { offline: true }).tone, status(at(FRESH), { offline: true }).tag], ["problem", "Offline"]);
    assert.deepEqual([status(at(FRESH), { feedError: "x" }).tone, status(at(FRESH), { feedError: "x" }).tag], ["problem", "Feed down"]);
    assert.equal(status(at(FRESH), { offline: true, feedError: "x" }).tag, "Offline");
    assert.equal(status(at(FRESH - 6 * 3600_000), { offline: true }).tag, "Offline"); // not "Closed"
  });

  it("is loading until the first prices land, with nothing to say yet", () => {
    const s = status({}, { loading: true });
    assert.equal(s.tone, "loading");
    assert.equal(s.tag, null);
  });
});

describe("staleness", () => {
  it("is the price being older than its market allows", () => {
    const limit = 45 * 60_000;
    assert.equal(isStale({ asOf: 1_000_000 }, limit, 1_000_000 + limit), false);
    assert.equal(isStale({ asOf: 1_000_000 }, limit, 1_000_000 + limit + 1), true);
  });

  it("lets the rupee rate be hours old before it counts as stale - it updates far less often than futures", () => {
    const wti = GLOBAL_MARKETS.find((m) => m.id === "WTI")!;
    const rate = GLOBAL_MARKETS.find((m) => m.id === "USDINR")!;
    assert.ok(rate.staleAfterMs > 3 * 60 * 60_000);
    assert.ok(rate.staleAfterMs > wti.staleAfterMs);
  });
});

describe("the server feed", () => {
  beforeEach(() => resetGlobalMarketsFeed());

  /** A fetch that answers with a chart for each symbol it knows and a 429 for the rest, counting its calls. */
  function fakeFeed(known: Record<string, number>) {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      assert.equal((init?.headers as Record<string, string>)["User-Agent"], "MarketDesk"); // generic, and present: Yahoo 429s without one
      const symbol = decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
      const price = known[symbol];
      if (price === undefined) return new Response("Too Many Requests", { status: 429 });
      return Response.json(chart({ regularMarketPrice: price, regularMarketTime: 1794593987, chartPreviousClose: price }));
    }) as typeof fetch;
    return { fetchImpl, calls };
  }

  const ALL = { "CL=F": 88.7, "BZ=F": 95.8, "INR=X": 94.2, "NG=F": 3.25, "GC=F": 3889 };

  it("asks once per market and returns them all", async () => {
    const { fetchImpl, calls } = fakeFeed(ALL);
    const result = await getGlobalMarkets({ fetchImpl, now: () => 1000 });
    assert.equal(calls.length, 5);
    assert.deepEqual(result.quotes.map((q) => q.id).sort(), ["BRENT", "GOLD", "NATGAS", "USDINR", "WTI"]);
    assert.deepEqual(result.missing, []);
    assert.equal(result.fetchedAt, 1000);
  });

  it("serves a second poll from the first fetch, then fetches again once it has expired", async () => {
    const { fetchImpl, calls } = fakeFeed(ALL);
    let t = 1000;
    await getGlobalMarkets({ fetchImpl, now: () => t });
    t += FEED_TTL_MS - 1;
    await getGlobalMarkets({ fetchImpl, now: () => t });
    assert.equal(calls.length, 5);
    t += 2;
    await getGlobalMarkets({ fetchImpl, now: () => t });
    assert.equal(calls.length, 10);
  });

  it("shares one fetch between polls that arrive together", async () => {
    const { fetchImpl, calls } = fakeFeed(ALL);
    await Promise.all([getGlobalMarkets({ fetchImpl, now: () => 1 }), getGlobalMarkets({ fetchImpl, now: () => 1 }), getGlobalMarkets({ fetchImpl, now: () => 1 })]);
    assert.equal(calls.length, 5);
  });

  it("keeps the markets it did get when one fails, and names the one it didn't", async () => {
    const withoutBrent: Record<string, number> = { ...ALL };
    delete withoutBrent["BZ=F"];
    const result = await getGlobalMarkets({ fetchImpl: fakeFeed(withoutBrent).fetchImpl, now: () => 1 });
    assert.equal(result.quotes.length, 4);
    assert.deepEqual(result.missing, ["BRENT"]);
  });

  it("counts a thrown fetch, or a body that isn't JSON, as a missing market", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) throw new Error("socket hang up");
      if (n === 2) return new Response("<html>", { status: 200 });
      return Response.json(chart({ regularMarketPrice: 5, regularMarketTime: 1794593987 }));
    }) as typeof fetch;
    const result = await getGlobalMarkets({ fetchImpl, now: () => 1 });
    assert.equal(result.quotes.length, 3);
    assert.equal(result.missing.length, 2);
  });

  it("retries a total failure sooner than a good result, but not on every poll", async () => {
    const { fetchImpl, calls } = fakeFeed({});
    let t = 1000;
    const first = await getGlobalMarkets({ fetchImpl, now: () => t });
    assert.equal(first.quotes.length, 0);
    assert.equal(first.missing.length, 5);
    t += FEED_FAILURE_TTL_MS - 1;
    await getGlobalMarkets({ fetchImpl, now: () => t });
    assert.equal(calls.length, 5); // still the first failure
    t += 2;
    await getGlobalMarkets({ fetchImpl, now: () => t });
    assert.equal(calls.length, 10);
    assert.ok(FEED_FAILURE_TTL_MS < FEED_TTL_MS);
  });
});
