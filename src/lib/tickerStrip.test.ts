/**
 * What the ticker shows for each ticked price and how its status line reads. The figures are the real ones from the Watchlist
 * tests' day (17 Nov 2026, about 14:45 UTC): London mid-session and 15 minutes behind, Tokyo shut for hours, WTI and the rupee
 * from the strip's feed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { GlobalQuote } from "@/lib/globalMarkets";
import { tickerNeeds } from "@/lib/tickerPrefs";
import { buildTickerEntries, tickerStatus, type FeedHealth, type TickerSources } from "@/lib/tickerStrip";
import { GIFT_NIFTY_KEY, type WatchQuote } from "@/lib/watchlist";
import type { WorldQuote } from "@/lib/worldIndices";

const at = (iso: string) => Date.parse(iso);
const NOW = at("2026-11-17T14:45:00Z");

const wti: GlobalQuote = { id: "WTI", price: 86.52, previousClose: 85.72, asOf: NOW - 10 * 60_000, dayHigh: 87.1, dayLow: 85.4 };
const rate: GlobalQuote = { id: "USDINR", price: 93.46, previousClose: 93.91, asOf: NOW - 60 * 60_000, dayHigh: null, dayLow: null };
const gold: GlobalQuote = { id: "GOLD", price: 3863.7, previousClose: 3853.0, asOf: NOW - 5 * 24 * 3_600_000, dayHigh: null, dayLow: null }; // last traded 5 days ago

const ftse: WorldQuote = {
  id: "^FTSE",
  price: 10745.8,
  previousClose: 10881.55,
  asOf: at("2026-11-17T14:30:00Z"),
  dayHigh: 10890.1,
  dayLow: 10731.2,
  open: 10800,
  sessionStart: at("2026-11-17T08:00:00Z"),
  sessionEnd: at("2026-11-17T16:30:00Z"),
};
const nikkei: WorldQuote = {
  id: "^N225",
  price: 58860.43,
  previousClose: 59662.02,
  asOf: at("2026-11-17T06:45:00Z"),
  dayHigh: 59210,
  dayLow: 58702.5,
  open: 59000,
  sessionStart: at("2026-11-17T00:00:00Z"),
  sessionEnd: at("2026-11-17T06:30:00Z"),
};

const nifty: WatchQuote = { price: 25387.4, prevClose: 25291.1, change: 96.3, changePct: 0.380766, open: 25277.3, high: 25501.35, low: 25267.3, volume: null, asOf: NOW - 60_000, contract: null };
const gift: WatchQuote = { price: 25360.5, prevClose: 25344.5, change: 16, changePct: 0.0631, open: 25350, high: 25400, low: 25320, volume: null, asOf: NOW - 60_000, contract: null };

function sources(over: Partial<TickerSources> = {}): TickerSources {
  return {
    markets: { WTI: wti, USDINR: rate },
    world: { "^FTSE": ftse, "^N225": nikkei },
    upstox: { [GIFT_NIFTY_KEY]: gift },
    at: { markets: NOW, world: NOW, upstox: NOW },
    upstoxTokenExpired: false,
    ...over,
  };
}

const find = (entries: ReturnType<typeof buildTickerEntries>, id: string) => {
  const entry = entries.find((e) => e.id === id);
  assert.ok(entry, id);
  return entry;
};

describe("the ticker's tiles", () => {
  it("come in the order they were ticked, and skip an id that isn't on the list", () => {
    const entries = buildTickerEntries(["^N225", "NOPE", "WTI", "gift", "^FTSE"], sources());
    assert.deepEqual(entries.map((e) => e.id), ["^N225", "WTI", "gift", "^FTSE"]);
    assert.deepEqual(entries.map((e) => e.label), ["Nikkei 225", "WTI", "GIFT Nifty", "FTSE 100"]);
    assert.deepEqual(entries.map((e) => e.source), ["world", "markets", "upstox", "world"]);
  });

  it("show a commodity as dollars and its move since the previous close", () => {
    const e = find(buildTickerEntries(["WTI"], sources()), "WTI");
    assert.equal(e.price, "$86.52");
    assert.equal(e.percent, 0.93);
    assert.equal(e.open, true);
  });

  it("show WTI in rupees as the dollar price times the rate, once both are in", () => {
    assert.equal(find(buildTickerEntries(["WTI_INR"], sources()), "WTI_INR").price, "₹8,086");
    const noRate = find(buildTickerEntries(["WTI_INR"], sources({ markets: { WTI: wti } })), "WTI_INR");
    assert.equal(noRate.price, null);
  });

  it("show a world index to the paisa with Indian digit grouping and its move in percent", () => {
    const e = find(buildTickerEntries(["^FTSE"], sources()), "^FTSE");
    assert.equal(e.price, "10,745.80");
    assert.equal(e.percent, -1.25);
  });

  it("show GIFT Nifty from Upstox, using the move Upstox gave", () => {
    const e = find(buildTickerEntries(["gift"], sources()), "gift");
    assert.equal(e.price, "25,360.50");
    assert.equal(e.percent, 0.06);
    assert.equal(e.open, true);
  });

  it("show Nifty, Bank Nifty and Sensex from Upstox like any index", () => {
    const upstox = {
      "NSE_INDEX|Nifty 50": nifty,
      "NSE_INDEX|Nifty Bank": { ...nifty, price: 62273.25, changePct: 1.1325 },
      "BSE_INDEX|SENSEX": { ...nifty, price: 82532.19, changePct: -0.5205 },
    };
    const entries = buildTickerEntries(["sensex", "nifty", "banknifty"], sources({ upstox }));
    assert.deepEqual(entries.map((e) => [e.label, e.price, e.percent, e.open]), [
      ["Sensex", "82,532.19", -0.52, true],
      ["Nifty 50", "25,387.40", 0.38, true],
      ["Bank Nifty", "62,273.25", 1.13, true],
    ]);
    assert.ok(entries[0].tooltip.startsWith("Sensex · BSE\n"), entries[0].tooltip);
    assert.ok(entries[1].tooltip.startsWith("Nifty 50 · NSE\nDay range 25,267.30 - 25,501.35"), entries[1].tooltip);
  });

  it("mark the Indian indices closed once the session is over, and say the token lapsed when it has", () => {
    // 15:30 IST, the close, as the last trade - read at 00:45 IST the next day
    const atClose = Date.parse("2026-11-17T10:00:00Z");
    const shut = buildTickerEntries(["nifty"], sources({ upstox: { "NSE_INDEX|Nifty 50": { ...nifty, asOf: atClose } } }));
    assert.equal(find(shut, "nifty").open, false);
    assert.match(find(shut, "nifty").tooltip, /the market is closed/);
    const expired = buildTickerEntries(["nifty", "sensex"], sources({ upstox: {}, upstoxTokenExpired: true }));
    for (const e of expired) assert.match(e.tooltip, /Upstox token expired/);
  });

  it("round the move to what is shown, so a wobble that rounds to nothing reads as flat", () => {
    for (const wobble of [-0.00004, 0.00004]) {
      const flat = { ...ftse, previousClose: ftse.price * (1 - wobble) };
      const e = find(buildTickerEntries(["^FTSE"], sources({ world: { "^FTSE": flat } })), "^FTSE");
      assert.ok(Object.is(e.percent, 0), `${wobble}: ${String(e.percent)}`); // 0, not -0
    }
  });

  it("have no move without a previous close", () => {
    const e = find(buildTickerEntries(["^FTSE"], sources({ world: { "^FTSE": { ...ftse, previousClose: null } } })), "^FTSE");
    assert.equal(e.price, "10,745.80");
    assert.equal(e.percent, null);
  });
});

describe("open and closed", () => {
  it("marks a market closed when its price is old, whichever feed it came from", () => {
    const entries = buildTickerEntries(["^FTSE", "^N225", "GOLD", "WTI"], sources({ markets: { WTI: wti, GOLD: gold } }));
    assert.equal(find(entries, "^FTSE").open, true); // trading, 15 minutes behind
    assert.equal(find(entries, "^N225").open, false); // shut for hours
    assert.equal(find(entries, "GOLD").open, false); // last traded five days ago
    assert.equal(find(entries, "WTI").open, true);
  });

  it("marks an Upstox price closed once it has gone quiet, and says nothing when Upstox didn't say when it last traded", () => {
    const old = buildTickerEntries(["gift"], sources({ upstox: { [GIFT_NIFTY_KEY]: { ...gift, asOf: NOW - 3 * 3_600_000 } } }));
    assert.equal(find(old, "gift").open, false);
    const unknown = buildTickerEntries(["gift"], sources({ upstox: { [GIFT_NIFTY_KEY]: { ...gift, asOf: null } } }));
    assert.equal(find(unknown, "gift").open, null);
  });

  it("measures against the moment of the last fetch, not the clock", () => {
    // fetched while the market was shut: still shut then, whatever time it is when this runs
    const entries = buildTickerEntries(["^FTSE"], sources({ at: { markets: NOW, world: at("2026-11-17T20:00:00Z"), upstox: NOW } }));
    assert.equal(find(entries, "^FTSE").open, false);
  });
});

describe("the tooltip", () => {
  it("says what it is, the day's range and when it last updated, and that a shut market is shut", () => {
    const entries = buildTickerEntries(["^FTSE", "^N225"], sources());
    const open = find(entries, "^FTSE").tooltip;
    assert.match(open, /^FTSE 100 · United Kingdom\n/);
    assert.match(open, /Day range 10,731\.20 - 10,890\.10/);
    assert.match(open, /Last updated /);
    assert.doesNotMatch(open, /closed/);
    assert.match(find(entries, "^N225").tooltip, /the market is closed/);
  });

  it("names the unit of a commodity", () => {
    assert.match(find(buildTickerEntries(["WTI"], sources()), "WTI").tooltip, /\$\/bbl/);
  });

  it("says why a price is missing: no price yet, or the Upstox token has lapsed", () => {
    const none = buildTickerEntries(["^FTSE", "WTI", "gift"], sources({ markets: {}, world: {}, upstox: {} }));
    for (const e of none) {
      assert.equal(e.price, null);
      assert.equal(e.percent, null);
      assert.equal(e.open, null);
    }
    assert.match(find(none, "^FTSE").tooltip, /no price from the feed right now/);
    assert.match(find(none, "gift").tooltip, /no price from Upstox right now/);
    const expired = buildTickerEntries(["gift"], sources({ upstox: {}, upstoxTokenExpired: true }));
    assert.match(find(expired, "gift").tooltip, /Upstox token expired/);
  });
});

describe("the status line", () => {
  const ok: FeedHealth = { offline: false, error: null, loading: false };
  const feeds = (over: Partial<{ markets: FeedHealth; world: FeedHealth; upstox: FeedHealth }> = {}) => ({ markets: ok, world: ok, upstox: ok, ...over });
  const run = (ids: string[], over: Partial<TickerSources> = {}, f = feeds()) => {
    const entries = buildTickerEntries(ids, sources(over));
    return tickerStatus({ entries, needs: tickerNeeds(ids), feeds: f });
  };

  it("says so when nothing is chosen", () => {
    assert.deepEqual(run([]), { tone: "empty", tag: null, summary: "No prices chosen" });
  });

  it("is live, and names its sources and their delay", () => {
    assert.deepEqual(run(["^FTSE", "WTI"]), { tone: "live", tag: null, summary: "Delayed 10–15 min · Yahoo Finance" });
    assert.deepEqual(run(["gift"]), { tone: "live", tag: null, summary: "Up to 1 min behind · Upstox" });
    assert.match(run(["gift", "^FTSE"]).summary, /Yahoo Finance · Upstox up to 1 min/);
  });

  it("is offline when a feed it needs can't be reached, ahead of a feed error", () => {
    const status = run(["^FTSE", "WTI"], {}, feeds({ world: { offline: true, error: null, loading: false }, markets: { offline: false, error: "boom", loading: false } }));
    assert.equal(status.tag, "Offline");
    assert.equal(status.tone, "problem");
  });

  it("is down when a feed it needs answers with an error", () => {
    const status = run(["^FTSE"], {}, feeds({ world: { offline: false, error: "Couldn't reach the price feed", loading: false } }));
    assert.deepEqual([status.tone, status.tag, status.summary], ["problem", "Feed down", "Price feed unavailable"]);
  });

  it("ignores a feed nothing is ticked for", () => {
    // Upstox is offline and the world feed is down, but only crude is ticked
    const status = run(["WTI"], {}, feeds({ upstox: { offline: true, error: null, loading: false }, world: { offline: false, error: "boom", loading: false } }));
    assert.equal(status.tone, "live");
  });

  it("is loading until a price lands, but only when every feed it needs is still loading", () => {
    const loading: FeedHealth = { offline: false, error: null, loading: true };
    const empty = { markets: {}, world: {}, upstox: {} };
    assert.equal(run(["^FTSE", "WTI"], empty, feeds({ world: loading, markets: loading })).tone, "loading");
    // one feed has answered with nothing for these: not "loading" any more
    assert.notEqual(run(["^FTSE", "WTI"], empty, feeds({ world: loading })).tone, "loading");
  });

  it("is closed only when every price on it is old", () => {
    assert.deepEqual(run(["^N225", "GOLD"], { markets: { GOLD: gold } }), { tone: "closed", tag: "Closed", summary: "Markets closed · last prices" });
    assert.equal(run(["^N225", "^FTSE"]).tone, "live"); // London is trading
  });

  it("judges 'closed' on the prices it has, and calls nothing closed when it has none", () => {
    assert.equal(run(["^N225", "^GSPC"]).tone, "closed"); // no price for the S&P; the one that has a price is shut
    assert.notEqual(run(["^GSPC"], { world: {} }).tone, "closed"); // no price at all: a feed matter, not a closed market
  });
});
