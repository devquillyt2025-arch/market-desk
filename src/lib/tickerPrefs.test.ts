/**
 * The ticker across the top of every page: what can be ticked, what a first visit shows, how a saved choice is read back (it is
 * only ever as good as what localStorage hands over), and the moves the editor makes - tick, untick, reorder.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DOW_FUTURES_KEY } from "@/lib/globalIndicesTable";
import {
  clampSpeed,
  DEFAULT_TICKER_IDS,
  DEFAULT_TICKER_PREFS,
  DOW_FUTURES_TICKER_ID,
  GIFT_TICKER_ID,
  isDefaultTickerPrefs,
  moveTickerItem,
  parseTickerPrefs,
  serializeTickerPrefs,
  TICKER_ITEMS,
  TICKER_SECTIONS,
  TICKER_SPEED_DEFAULT,
  TICKER_SPEED_MAX,
  TICKER_SPEED_MIN,
  TICKER_UPSTOX,
  tickerItemDef,
  tickerLoopSeconds,
  tickerNeeds,
  tickerSections,
  toggleTickerItem,
  type TickerPrefs,
} from "@/lib/tickerPrefs";
import { parseWatchRequest } from "@/lib/upstox/watchQuotes";
import { GIFT_NIFTY_KEY } from "@/lib/watchlist";
import { WORLD_INDICES } from "@/lib/worldIndices";

const prefs = (ids: string[], extra: Partial<TickerPrefs> = {}): TickerPrefs => ({ ids, loop: true, speed: TICKER_SPEED_DEFAULT, ...extra });

describe("what can be ticked", () => {
  it("has each price once", () => {
    const ids = TICKER_ITEMS.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("carries the six prices the strip always showed, in its order, WTI in rupees right after the rate it is built from", () => {
    const prices = TICKER_ITEMS.filter((item) => item.source === "markets").map((item) => item.id);
    assert.deepEqual(prices, ["WTI", "BRENT", "USDINR", "WTI_INR", "NATGAS", "GOLD"]);
    assert.equal(tickerItemDef("WTI_INR")?.label, "WTI in ₹");
  });

  it("carries every world index, filed under its own region, and the Upstox ones: Nifty, Bank Nifty, Sensex, GIFT Nifty, the Dow futures", () => {
    for (const index of WORLD_INDICES) {
      const item = tickerItemDef(index.id);
      assert.ok(item, index.id);
      assert.equal(item.source, "world");
      assert.equal(item.section, index.region);
      assert.equal(item.label, index.name);
    }
    assert.equal(tickerItemDef(GIFT_TICKER_ID)?.source, "upstox");
    assert.equal(tickerItemDef(DOW_FUTURES_TICKER_ID)?.source, "upstox");
    for (const [id, label, title] of [
      ["nifty", "Nifty 50", "Nifty 50 · NSE"],
      ["banknifty", "Bank Nifty", "Bank Nifty · NSE"],
      ["sensex", "Sensex", "Sensex · BSE"],
    ]) {
      const item = tickerItemDef(id);
      assert.deepEqual([item?.label, item?.title, item?.section, item?.source], [label, title, "india", "upstox"], id);
    }
    assert.equal(TICKER_ITEMS.length, 6 + 5 + WORLD_INDICES.length);
  });

  it("points the Upstox prices at the instruments the Watchlist already asks for", () => {
    assert.deepEqual(TICKER_UPSTOX.map((u) => [u.id, u.itemKey]), [
      ["nifty", "NSE_INDEX|Nifty 50"],
      ["banknifty", "NSE_INDEX|Nifty Bank"],
      ["sensex", "BSE_INDEX|SENSEX"],
      [GIFT_TICKER_ID, GIFT_NIFTY_KEY],
      [DOW_FUTURES_TICKER_ID, DOW_FUTURES_KEY],
    ]);
  });

  it("asks Upstox in a form the server accepts - every instrument, in one request", () => {
    const body = { items: TICKER_UPSTOX.map((u) => ({ itemKey: u.itemKey, kind: "index", symbol: u.symbol })) };
    assert.equal(parseWatchRequest(body)?.length, TICKER_UPSTOX.length);
  });

  it("lists the Indian indices first in the editor", () => {
    assert.deepEqual(tickerSections().map((s) => s.label).slice(0, 3), ["Indian indices", "GIFT Nifty & futures", "Commodities & rupee"]);
    assert.deepEqual(tickerSections()[0].items.map((i) => i.label), ["Nifty 50", "Bank Nifty", "Sensex"]);
  });

  it("lists every group in the editor, none of them empty, and every price in exactly one", () => {
    const sections = tickerSections();
    assert.deepEqual(sections.map((s) => s.id), TICKER_SECTIONS.map((s) => s.id));
    assert.ok(sections.every((s) => s.items.length > 0));
    assert.equal(sections.reduce((n, s) => n + s.items.length, 0), TICKER_ITEMS.length);
  });
});

describe("what a first visit shows", () => {
  it("is the world's headline indices and the prices the strip always carried - every one of them on the list, none twice", () => {
    assert.equal(DEFAULT_TICKER_IDS.length, 14);
    assert.ok(DEFAULT_TICKER_IDS.every((id) => tickerItemDef(id)));
    assert.equal(new Set(DEFAULT_TICKER_IDS).size, DEFAULT_TICKER_IDS.length);
    assert.equal(DEFAULT_TICKER_IDS[0], GIFT_TICKER_ID); // India's own read first
    for (const id of ["WTI", "BRENT", "USDINR", "WTI_INR", "NATGAS", "GOLD"]) assert.ok(DEFAULT_TICKER_IDS.includes(id), id);
    assert.equal(DEFAULT_TICKER_PREFS.loop, true);
  });
});

describe("reading a saved choice", () => {
  it("falls back to the default for nothing, for garbage, and for a value that isn't an object", () => {
    for (const raw of [undefined, null, "", "not json", "null", "42", '"text"']) {
      assert.equal(parseTickerPrefs(raw), DEFAULT_TICKER_PREFS, String(raw));
    }
  });

  it("round-trips a choice", () => {
    const choice = prefs(["^GSPC", "WTI", "gift"], { loop: false, speed: 80 });
    assert.deepEqual(parseTickerPrefs(serializeTickerPrefs(choice)), choice);
  });

  it("drops ids it doesn't know (an index dropped from the list since) and repeats, keeping the order", () => {
    const raw = JSON.stringify({ ids: ["^N225", "GONE", "WTI", "^N225", 7, null, "^GSPC"], loop: true, speed: 50 });
    assert.deepEqual(parseTickerPrefs(raw).ids, ["^N225", "WTI", "^GSPC"]);
  });

  it("keeps an empty list - everything unticked is a real choice, not a missing one", () => {
    assert.deepEqual(parseTickerPrefs(JSON.stringify({ ids: [], loop: true, speed: 50 })).ids, []);
  });

  it("uses the default ids when the saved ones aren't a list", () => {
    assert.deepEqual(parseTickerPrefs(JSON.stringify({ ids: "WTI", loop: false })).ids, DEFAULT_TICKER_IDS);
    assert.deepEqual(parseTickerPrefs(JSON.stringify({ loop: false })).ids, DEFAULT_TICKER_IDS);
  });

  it("turns the loop off only for an explicit false", () => {
    assert.equal(parseTickerPrefs(JSON.stringify({ ids: [], loop: false })).loop, false);
    for (const loop of [undefined, null, 0, "false", true]) {
      assert.equal(parseTickerPrefs(JSON.stringify({ ids: [], loop })).loop, true, String(loop));
    }
  });

  it("keeps the speed within its range, and uses the default for anything that isn't a number", () => {
    assert.equal(parseTickerPrefs(JSON.stringify({ ids: [], speed: 1 })).speed, TICKER_SPEED_MIN);
    assert.equal(parseTickerPrefs(JSON.stringify({ ids: [], speed: 9999 })).speed, TICKER_SPEED_MAX);
    assert.equal(parseTickerPrefs(JSON.stringify({ ids: [], speed: 62.4 })).speed, 62);
    assert.equal(parseTickerPrefs(JSON.stringify({ ids: [], speed: "fast" })).speed, TICKER_SPEED_DEFAULT);
    assert.equal(parseTickerPrefs(JSON.stringify({ ids: [], speed: null })).speed, TICKER_SPEED_DEFAULT);
    assert.equal(clampSpeed(0), TICKER_SPEED_MIN);
  });
});

describe("ticking, unticking and reordering", () => {
  it("puts a newly ticked price at the end and takes an unticked one out", () => {
    const start = prefs(["WTI", "^GSPC"]);
    assert.deepEqual(toggleTickerItem(start, "^N225").ids, ["WTI", "^GSPC", "^N225"]);
    assert.deepEqual(toggleTickerItem(start, "WTI").ids, ["^GSPC"]);
    assert.deepEqual(start.ids, ["WTI", "^GSPC"]); // the original is untouched
  });

  it("keeps the loop and the speed when the list changes", () => {
    const next = toggleTickerItem(prefs(["WTI"], { loop: false, speed: 90 }), "GOLD");
    assert.equal(next.loop, false);
    assert.equal(next.speed, 90);
  });

  it("ignores an id that isn't on the list", () => {
    const start = prefs(["WTI"]);
    assert.equal(toggleTickerItem(start, "NOPE"), start);
  });

  it("moves a price to a place, the others keeping their order", () => {
    const start = prefs(["WTI", "BRENT", "GOLD", "NATGAS"]);
    assert.deepEqual(moveTickerItem(start, "WTI", 2).ids, ["BRENT", "GOLD", "WTI", "NATGAS"]);
    assert.deepEqual(moveTickerItem(start, "NATGAS", 0).ids, ["NATGAS", "WTI", "BRENT", "GOLD"]);
    assert.deepEqual(moveTickerItem(start, "BRENT", 2).ids, ["WTI", "GOLD", "BRENT", "NATGAS"]);
  });

  it("clamps a move past either end, and does nothing for the same place or for a price that isn't shown", () => {
    const start = prefs(["WTI", "BRENT", "GOLD"]);
    assert.deepEqual(moveTickerItem(start, "WTI", Infinity).ids, ["BRENT", "GOLD", "WTI"]);
    assert.deepEqual(moveTickerItem(start, "GOLD", -Infinity).ids, ["GOLD", "WTI", "BRENT"]);
    assert.equal(moveTickerItem(start, "BRENT", 1), start);
    assert.equal(moveTickerItem(start, "^GSPC", 0), start);
  });

  it("knows the default when it sees it, whatever else has changed", () => {
    assert.equal(isDefaultTickerPrefs(DEFAULT_TICKER_PREFS), true);
    assert.equal(isDefaultTickerPrefs(prefs([...DEFAULT_TICKER_IDS])), true);
    assert.equal(isDefaultTickerPrefs({ ...DEFAULT_TICKER_PREFS, loop: false }), false);
    assert.equal(isDefaultTickerPrefs({ ...DEFAULT_TICKER_PREFS, speed: 70 }), false);
    assert.equal(isDefaultTickerPrefs(toggleTickerItem(DEFAULT_TICKER_PREFS, "GOLD")), false);
    assert.equal(isDefaultTickerPrefs(moveTickerItem(DEFAULT_TICKER_PREFS, "GOLD", 0)), false);
  });
});

describe("which feeds a choice needs", () => {
  it("splits the ticked prices by where they come from", () => {
    const needs = tickerNeeds(["gift", "^GSPC", "WTI", "^N225", "WTI_INR"]);
    assert.equal(needs.markets, true);
    assert.deepEqual(needs.world, ["^GSPC", "^N225"]);
    assert.deepEqual(needs.upstox.map((u) => u.id), ["gift"]);
  });

  it("needs nothing from a feed nothing is ticked for", () => {
    const yahooOnly = tickerNeeds(["^GSPC"]);
    assert.equal(yahooOnly.markets, false);
    assert.equal(yahooOnly.upstox.length, 0);
    const none = tickerNeeds([]);
    assert.deepEqual([none.markets, none.world, none.upstox.length], [false, [], 0]);
  });

  it("asks Upstox for the Indian indices ticked, in the order of the instruments", () => {
    const needs = tickerNeeds(["sensex", "^GSPC", "nifty"]);
    assert.deepEqual(needs.upstox.map((u) => u.id), ["nifty", "sensex"]);
    assert.deepEqual(needs.world, ["^GSPC"]);
    assert.equal(needs.markets, false);
  });

  it("keeps the order of the ticked world indices, and asks for both Upstox prices when both are ticked", () => {
    const needs = tickerNeeds(["^N225", "dow-futures", "^GSPC", "gift"]);
    assert.deepEqual(needs.world, ["^N225", "^GSPC"]);
    assert.deepEqual(needs.upstox.map((u) => u.id), ["gift", "dow-futures"]); // the order of the instruments, not of the ticker
  });
});

describe("how long one trip of the loop takes", () => {
  it("is the row's width over the speed", () => {
    assert.equal(tickerLoopSeconds(2000, 50), 40);
    assert.equal(tickerLoopSeconds(2000, 100), 20);
  });

  it("is never so short it blurs, and survives a speed of nothing", () => {
    assert.equal(tickerLoopSeconds(100, 140), 8);
    assert.ok(Number.isFinite(tickerLoopSeconds(2000, 0)));
  });
});
