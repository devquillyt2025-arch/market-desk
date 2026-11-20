/**
 * The world indices on the Global markets tab: the list itself, reading Yahoo's chart response, whether a market is open, and
 * the server feed's sharing and pacing of its requests. The fixtures are the real figures Yahoo gave on 17 Nov 2026 around
 * 14:45 UTC (trimmed to `meta`): London and Frankfurt mid-session, 15 minutes behind; Tokyo shut for hours; Stockholm filed
 * under New York's time zone.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  isSessionOpen,
  isWorldIndicesError,
  isWorldQuote,
  OPEN_FRESH_MS,
  parseWorldChart,
  worldIndexDef,
  WORLD_INDICES,
  WORLD_REGIONS,
  type WorldQuote,
} from "@/lib/worldIndices";
import { getWorldIndices, resetWorldIndicesFeed, WORLD_FEED_CONCURRENCY, WORLD_FEED_FAILURE_TTL_MS, WORLD_FEED_TTL_MS } from "@/lib/worldIndicesFeed";

const at = (iso: string) => Date.parse(iso);
const secs = (iso: string) => Date.parse(iso) / 1000;
const NOW = at("2026-11-17T14:45:00Z");

function chart(meta: Record<string, unknown>, opens?: (number | null)[]) {
  return { chart: { result: [{ meta, ...(opens ? { indicators: { quote: [{ open: opens }] } } : {}) }], error: null } };
}

const FTSE_META = {
  symbol: "^FTSE",
  currency: "GBP",
  regularMarketPrice: 10745.8,
  chartPreviousClose: 10881.55,
  regularMarketTime: secs("2026-11-17T14:30:00Z"),
  regularMarketDayHigh: 10890.1,
  regularMarketDayLow: 10731.2,
  currentTradingPeriod: { regular: { start: secs("2026-11-17T08:00:00Z"), end: secs("2026-11-17T16:30:00Z"), timezone: "GMT", gmtoffset: 0 } },
};
const NIKKEI_META = {
  symbol: "^N225",
  regularMarketPrice: 58860.43,
  chartPreviousClose: 59662.02,
  regularMarketTime: secs("2026-11-17T06:45:00Z"),
  regularMarketDayHigh: 59210.0,
  regularMarketDayLow: 58702.5,
  currentTradingPeriod: { regular: { start: secs("2026-11-17T00:00:00Z"), end: secs("2026-11-17T06:30:00Z") } },
};
const STOCKHOLM_META = {
  symbol: "^OMXS30",
  regularMarketPrice: 3310.6328,
  chartPreviousClose: 3341.9492,
  regularMarketTime: secs("2026-11-17T14:45:00Z"),
  // Yahoo's window for it is New York's (9:30-16:00 ET), not Stockholm's 08:00-16:30 UTC.
  currentTradingPeriod: { regular: { start: secs("2026-11-17T14:30:00Z"), end: secs("2026-11-17T21:00:00Z") } },
};

describe("the list of indices", () => {
  it("has each one once, in a region the page knows, with a two-letter country mark", () => {
    const ids = WORLD_INDICES.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length);
    const regions = new Set(WORLD_REGIONS.map((r) => r.id));
    for (const d of WORLD_INDICES) {
      assert.ok(regions.has(d.region), d.id);
      assert.match(d.code, /^[A-Z]{2}$/, d.id);
      assert.ok(d.name.length > 0 && d.country.length > 0, d.id);
    }
    for (const r of WORLD_REGIONS) assert.ok(WORLD_INDICES.some((d) => d.region === r.id), r.label);
  });

  it("covers the countries asked for - the US, China, Japan - and the other big markets", () => {
    const has = (id: string) => assert.ok(worldIndexDef(id), id);
    for (const id of ["^GSPC", "^DJI", "^IXIC"]) has(id); // US
    for (const id of ["000001.SS", "399001.SZ"]) has(id); // China
    has("^N225"); // Japan
    for (const id of ["^HSI", "^KS11", "^TWII", "^AXJO", "^FTSE", "^GDAXI", "^FCHI", "^GSPTSE", "^BVSP", "^J203.JO", "^TASI.SR"]) has(id);
    assert.ok(new Set(WORLD_INDICES.map((d) => d.code)).size >= 25); // a spread of countries, not just a few
  });

  it("leaves India out - it has its own tab, from Upstox - and the symbols Yahoo has no live data for", () => {
    assert.ok(!WORLD_INDICES.some((d) => d.code === "IN" || d.id === "^NSEI" || d.id === "^BSESN"));
    for (const dead of ["^MERV", "^IPSA", "^OSEAX", "IMOEX.ME"]) assert.equal(worldIndexDef(dead), undefined, dead);
  });
});

describe("reading a Yahoo chart response", () => {
  it("takes the level, previous close, day's range, open, last update and trading window", () => {
    assert.deepEqual(parseWorldChart("^FTSE", chart(FTSE_META, [10881.53])), {
      id: "^FTSE",
      price: 10745.8,
      previousClose: 10881.55,
      asOf: at("2026-11-17T14:30:00Z"),
      dayHigh: 10890.1,
      dayLow: 10731.2,
      open: 10881.53,
      sessionStart: at("2026-11-17T08:00:00Z"),
      sessionEnd: at("2026-11-17T16:30:00Z"),
    });
  });

  it("falls back to previousClose, and drops a previous close that isn't a price", () => {
    const withPrev = parseWorldChart("^FTSE", chart({ ...FTSE_META, chartPreviousClose: undefined, previousClose: 10800 }));
    assert.equal(withPrev?.previousClose, 10800);
    assert.equal(parseWorldChart("^FTSE", chart({ ...FTSE_META, chartPreviousClose: 0 }))?.previousClose, null);
    assert.equal(parseWorldChart("^FTSE", chart({ ...FTSE_META, chartPreviousClose: -5 }))?.previousClose, null);
  });

  it("copes with no day's range, no open and no trading window", () => {
    const quote = parseWorldChart("^FTSE", chart({ regularMarketPrice: 100, regularMarketTime: 1794593987 }));
    assert.deepEqual([quote?.dayHigh, quote?.dayLow, quote?.open, quote?.sessionStart, quote?.sessionEnd, quote?.previousClose], [null, null, null, null, null, null]);
  });

  it("reads the open from the candle: the latest one that has a price, and none for an empty or unusable candle", () => {
    assert.equal(parseWorldChart("^N225", chart(NIKKEI_META, [59000, 59295.8]))?.open, 59295.8);
    assert.equal(parseWorldChart("^N225", chart(NIKKEI_META, [59295.8, null]))?.open, 59295.8); // Yahoo leaves a not-yet-formed candle as null
    assert.equal(parseWorldChart("^N225", chart(NIKKEI_META, [null]))?.open, null);
    assert.equal(parseWorldChart("^N225", chart(NIKKEI_META, [0]))?.open, null);
    assert.equal(parseWorldChart("^N225", chart(NIKKEI_META, []))?.open, null);
  });

  it("gives nothing for a response with no usable price", () => {
    assert.equal(parseWorldChart("^FTSE", chart({ ...FTSE_META, regularMarketPrice: null })), null);
    assert.equal(parseWorldChart("^FTSE", chart({ ...FTSE_META, regularMarketPrice: 0 })), null);
    assert.equal(parseWorldChart("^FTSE", chart({ ...FTSE_META, regularMarketTime: undefined })), null);
    assert.equal(parseWorldChart("^FTSE", { chart: { result: null, error: { code: "Not Found" } } }), null);
    assert.equal(parseWorldChart("^FTSE", "nope"), null);
    assert.equal(parseWorldChart("^FTSE", null), null);
  });
});

describe("a stored or received quote", () => {
  const good: WorldQuote = { id: "^N225", price: 1, previousClose: null, asOf: 5, dayHigh: null, dayLow: null, sessionStart: null, sessionEnd: null };

  it("is accepted when it has the shape this module produces", () => {
    assert.equal(isWorldQuote(good), true);
    assert.equal(isWorldQuote(parseWorldChart("^N225", chart(NIKKEI_META))), true);
  });

  it("is accepted without an open - a level saved before the open was kept - but not with a bad one", () => {
    assert.equal(isWorldQuote({ ...good, open: undefined }), true);
    assert.equal(isWorldQuote({ ...good, open: 100 }), true);
    assert.equal(isWorldQuote({ ...good, open: null }), true);
    assert.equal(isWorldQuote({ ...good, open: "100" }), false);
  });

  it("is refused for an index the app doesn't list, a price that isn't one, or a field of the wrong kind", () => {
    assert.equal(isWorldQuote({ ...good, id: "^NSEI" }), false);
    assert.equal(isWorldQuote({ ...good, price: 0 }), false);
    assert.equal(isWorldQuote({ ...good, price: "5" }), false);
    assert.equal(isWorldQuote({ ...good, asOf: null }), false);
    assert.equal(isWorldQuote({ ...good, sessionEnd: "later" }), false);
    assert.equal(isWorldQuote(null), false);
    assert.equal(isWorldQuote([good]), false);
  });
});

describe("whether a market is open", () => {
  const ftse = parseWorldChart("^FTSE", chart(FTSE_META))!;
  const nikkei = parseWorldChart("^N225", chart(NIKKEI_META))!;
  const stockholm = parseWorldChart("^OMXS30", chart(STOCKHOLM_META))!;
  const def = (id: string) => worldIndexDef(id)!;

  it("is open mid-session with a price 15 minutes old, as the feed runs", () => {
    assert.equal(isSessionOpen(ftse, def("^FTSE"), NOW), true);
  });

  it("is shut once the window has ended, however recently it traded", () => {
    assert.equal(isSessionOpen(nikkei, def("^N225"), NOW), false);
    assert.equal(isSessionOpen({ ...ftse, asOf: at("2026-11-17T16:35:00Z") }, def("^FTSE"), at("2026-11-17T16:40:00Z")), false);
  });

  it("is shut before the window has begun, even with a fresh price (US pre-market)", () => {
    const early = at("2026-11-17T14:00:00Z");
    assert.equal(isSessionOpen({ ...stockholm, asOf: early }, { ignoreSessionWindow: false }, early), false);
  });

  it("is shut on a holiday: inside the window the day lists, but nothing has traded for days", () => {
    const holiday = { ...ftse, asOf: at("2026-11-13T16:30:00Z") };
    assert.equal(isSessionOpen(holiday, def("^FTSE"), NOW), false);
  });

  it("is shut once the last trade is older than the freshness limit, open just inside it", () => {
    assert.equal(isSessionOpen({ ...ftse, asOf: NOW - OPEN_FRESH_MS }, def("^FTSE"), NOW), true);
    assert.equal(isSessionOpen({ ...ftse, asOf: NOW - OPEN_FRESH_MS - 1 }, def("^FTSE"), NOW), false);
  });

  it("goes by freshness alone for an index Yahoo files under the wrong time zone (Stockholm)", () => {
    assert.equal(def("^OMXS30").ignoreSessionWindow, true);
    // Stockholm is open from 07:00 UTC; Yahoo's (New York) window would say shut until 14:30.
    const morning = at("2026-11-17T09:00:00Z");
    assert.equal(isSessionOpen({ ...stockholm, asOf: morning - 60_000 }, def("^OMXS30"), morning), true);
    // ... and shut once it has gone quiet.
    assert.equal(isSessionOpen({ ...stockholm, asOf: at("2026-11-17T16:30:00Z") }, def("^OMXS30"), at("2026-11-17T19:00:00Z")), false);
  });

  it("goes by freshness alone when Yahoo gave no window", () => {
    const noWindow = { ...ftse, sessionStart: null, sessionEnd: null };
    assert.equal(isSessionOpen(noWindow, def("^FTSE"), NOW), true);
    assert.equal(isSessionOpen({ ...noWindow, asOf: NOW - 5 * 3_600_000 }, def("^FTSE"), NOW), false);
  });
});

describe("the server feed", () => {
  beforeEach(() => resetWorldIndicesFeed());

  /** A fetch that answers a chart for each symbol it knows and a 429 for the rest, counting calls and how many ran at once. */
  function fakeFeed(known: ReadonlySet<string> | "all") {
    const calls: string[] = [];
    let active = 0;
    let peak = 0;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      assert.equal((init?.headers as Record<string, string>)["User-Agent"], "MarketDesk"); // generic, and present: Yahoo 429s without one
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      const symbol = decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
      if (known !== "all" && !known.has(symbol)) return new Response("Too Many Requests", { status: 429 });
      return Response.json(chart({ regularMarketPrice: 100, regularMarketTime: 1794593987, chartPreviousClose: 99 }));
    }) as typeof fetch;
    return { fetchImpl, calls, peak: () => peak };
  }

  it("asks once per index and returns them all", async () => {
    const feed = fakeFeed("all");
    const result = await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => 1000 });
    assert.equal(feed.calls.length, WORLD_INDICES.length);
    assert.equal(result.quotes.length, WORLD_INDICES.length);
    assert.deepEqual(result.missing, []);
    assert.equal(result.fetchedAt, 1000);
    assert.ok(isWorldIndicesError({ error: "x" }) && !isWorldIndicesError(result));
  });

  it("asks for symbols with ^ and . in them properly encoded, and never more than a few at once", async () => {
    const feed = fakeFeed("all");
    await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => 1 });
    assert.ok(feed.calls.some((u) => u.includes("/chart/%5EGSPC?")));
    assert.ok(feed.calls.some((u) => u.includes("/chart/000001.SS?")));
    assert.ok(feed.peak() <= WORLD_FEED_CONCURRENCY, `peak ${feed.peak()}`);
    assert.ok(feed.peak() > 1, "it should still run several at a time");
  });

  it("serves a second poll from the first fetch, then fetches again once it has expired", async () => {
    const feed = fakeFeed("all");
    let t = 1000;
    await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t });
    t += WORLD_FEED_TTL_MS - 1;
    await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t });
    assert.equal(feed.calls.length, WORLD_INDICES.length);
    t += 2;
    await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t });
    assert.equal(feed.calls.length, WORLD_INDICES.length * 2);
  });

  it("shares one fetch between polls that arrive together", async () => {
    const feed = fakeFeed("all");
    await Promise.all([1, 2, 3].map(() => getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => 1 })));
    assert.equal(feed.calls.length, WORLD_INDICES.length);
  });

  it("keeps the indices it did get when some fail, and names the ones it didn't", async () => {
    const known = new Set(WORLD_INDICES.map((d) => d.id).filter((id) => id !== "^N225" && id !== "^HSI"));
    const result = await getWorldIndices({ fetchImpl: fakeFeed(known).fetchImpl, now: () => 1 });
    assert.equal(result.quotes.length, WORLD_INDICES.length - 2);
    assert.deepEqual(result.missing.sort(), ["^HSI", "^N225"]);
  });

  it("retries a total failure sooner than a good result, but not on every poll", async () => {
    const feed = fakeFeed(new Set());
    let t = 1000;
    const first = await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t });
    assert.equal(first.quotes.length, 0);
    assert.equal(first.missing.length, WORLD_INDICES.length);
    t += WORLD_FEED_FAILURE_TTL_MS - 1;
    await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t });
    assert.equal(feed.calls.length, WORLD_INDICES.length); // still the first failure
    t += 2;
    await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t });
    assert.equal(feed.calls.length, WORLD_INDICES.length * 2);
    assert.ok(WORLD_FEED_FAILURE_TTL_MS < WORLD_FEED_TTL_MS);
  });

  it("counts a thrown fetch, or a body that isn't JSON, as a missing index", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n++;
      if (n === 1) throw new Error("socket hang up");
      if (n === 2) return new Response("<html>", { status: 200 });
      return Response.json(chart({ regularMarketPrice: 5, regularMarketTime: 1794593987 }));
    }) as typeof fetch;
    const result = await getWorldIndices({ fetchImpl, now: () => 1 });
    assert.equal(result.missing.length, 2);
    assert.equal(result.quotes.length, WORLD_INDICES.length - 2);
  });

  it("asks only for the indices named in ids, in the order of the list, and ignores ones it doesn't know", async () => {
    const feed = fakeFeed("all");
    const result = await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => 1, ids: ["^N225", "^GSPC", "NOPE", "^GSPC"] });
    assert.equal(feed.calls.length, 2);
    assert.deepEqual(result.quotes.map((q) => q.id), ["^GSPC", "^N225"]);
    assert.deepEqual(result.missing, []);
  });

  it("answers an empty ids with nothing, without asking Yahoo anything", async () => {
    const feed = fakeFeed("all");
    const result = await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => 5, ids: [] });
    assert.equal(feed.calls.length, 0);
    assert.deepEqual(result.quotes, []);
    assert.equal(result.fetchedAt, 5);
  });

  it("shares what each index fetched between a few and all - the ticker's eight and the tabs' forty-three cost forty-three", async () => {
    const feed = fakeFeed("all");
    await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => 1000, ids: ["^GSPC", "^N225", "^HSI"] });
    assert.equal(feed.calls.length, 3);
    const all = await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => 1000 });
    assert.equal(feed.calls.length, WORLD_INDICES.length); // only the other forty were fetched
    assert.equal(all.quotes.length, WORLD_INDICES.length);
  });

  it("shares in-flight fetches between overlapping calls for different sets", async () => {
    const feed = fakeFeed("all");
    const [few, all] = await Promise.all([
      getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => 1, ids: ["^GSPC", "^DJI"] }),
      getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => 1 }),
    ]);
    assert.equal(feed.calls.length, WORLD_INDICES.length); // each index once, not twice
    assert.equal(few.quotes.length, 2);
    assert.equal(all.quotes.length, WORLD_INDICES.length);
  });

  it("expires each index on its own clock", async () => {
    const feed = fakeFeed("all");
    let t = 1000;
    await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t, ids: ["^GSPC"] });
    t += WORLD_FEED_TTL_MS - 10;
    await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t, ids: ["^N225"] });
    t += 20; // ^GSPC has expired, ^N225 has not
    const both = await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t, ids: ["^GSPC", "^N225"] });
    assert.equal(feed.calls.length, 3);
    assert.equal(both.quotes.length, 2);
  });

  it("retries an index Yahoo had nothing for sooner than a good one, while the others stay cached", async () => {
    const feed = fakeFeed(new Set(["^GSPC"]));
    let t = 1000;
    const first = await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t, ids: ["^GSPC", "^N225"] });
    assert.deepEqual(first.missing, ["^N225"]);
    t += WORLD_FEED_FAILURE_TTL_MS + 1;
    await getWorldIndices({ fetchImpl: feed.fetchImpl, now: () => t, ids: ["^GSPC", "^N225"] });
    assert.equal(feed.calls.length, 3); // ^N225 again; ^GSPC still cached
  });
});
