import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  DEFAULT_WATCHLIST,
  changedPositions,
  commodityItemKey,
  dayRangePosition,
  formatMove,
  formatMovePct,
  formatPrice,
  formatRangeValue,
  hasItem,
  itemDetail,
  itemGlyph,
  marketBreadth,
  moveDirection,
  moveItem,
  nextSort,
  nextSortOrder,
  describeSort,
  matchesView,
  parseSort,
  sortItems,
  withSortOrder,
  type SortState,
  type WatchQuote,
  type WatchlistItem,
} from "@/lib/watchlist";

const item = (id: string, sortOrder: number, over: Partial<WatchlistItem> = {}): WatchlistItem => ({
  id,
  kind: "commodity",
  itemKey: `MCX_COM|${id}`,
  symbol: id,
  name: id,
  sortOrder,
  ...over,
});

const quote = (changePct: number | null, over: Partial<WatchQuote> = {}): WatchQuote => ({
  price: 100,
  prevClose: 100,
  change: changePct === null ? null : changePct,
  changePct,
  open: null,
  high: null,
  low: null,
  volume: null,
  contract: null,
  ...over,
});

describe("DEFAULT_WATCHLIST", () => {
  it("is the three indices followed by the nine commodities, numbered 1 to 12", () => {
    assert.equal(DEFAULT_WATCHLIST.length, 12);
    assert.deepEqual(DEFAULT_WATCHLIST.slice(0, 3).map((s) => s.symbol), ["NIFTY", "BANKNIFTY", "SENSEX"]);
    assert.ok(DEFAULT_WATCHLIST.slice(0, 3).every((s) => s.kind === "index"));
    assert.deepEqual(DEFAULT_WATCHLIST.slice(3).map((s) => s.symbol), ["CRUDEOIL", "NATURALGAS", "GOLD", "SILVER", "COPPER", "ZINC", "ALUMINIUM", "LEAD", "NICKEL"]);
    assert.ok(DEFAULT_WATCHLIST.slice(3).every((s) => s.kind === "commodity"));
    assert.deepEqual(DEFAULT_WATCHLIST.map((s) => s.sortOrder), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("identifies a commodity by its symbol, not by a contract that expires", () => {
    assert.equal(commodityItemKey("GOLD"), "MCX_COM|GOLD");
    assert.ok(DEFAULT_WATCHLIST.filter((s) => s.kind === "commodity").every((s) => s.itemKey === commodityItemKey(s.symbol)));
  });

  it("matches what the migration seeds into the database", () => {
    const sql = readFileSync("supabase/migrations/20261112100000_watchlist.sql", "utf8");
    const rows = [...sql.matchAll(/\('(index|commodity|equity)', '([^']+)', '([^']+)', '([^']+)', (\d+)\)/g)].map((m) => ({
      kind: m[1],
      itemKey: m[2],
      symbol: m[3],
      name: m[4],
      sortOrder: Number(m[5]),
    }));
    assert.deepEqual(rows, DEFAULT_WATCHLIST);
  });
});

describe("ordering", () => {
  const list = [item("a", 1), item("b", 2), item("c", 3), item("d", 4)];

  it("moves an item to a new position", () => {
    assert.deepEqual(moveItem(list, 0, 2).map((i) => i.id), ["b", "c", "a", "d"]);
    assert.deepEqual(moveItem(list, 3, 0).map((i) => i.id), ["d", "a", "b", "c"]);
  });

  it("clamps a move past either end, and ignores a position that isn't there", () => {
    assert.deepEqual(moveItem(list, 1, -5).map((i) => i.id), ["b", "a", "c", "d"]);
    assert.deepEqual(moveItem(list, 1, 99).map((i) => i.id), ["a", "c", "d", "b"]);
    assert.deepEqual(moveItem(list, 9, 0).map((i) => i.id), ["a", "b", "c", "d"]);
    assert.deepEqual(moveItem([], 0, 1), []);
  });

  it("leaves the original list alone", () => {
    moveItem(list, 0, 3);
    assert.deepEqual(list.map((i) => i.id), ["a", "b", "c", "d"]);
  });

  it("renumbers from 1 and reports only what moved", () => {
    const after = withSortOrder(moveItem(list, 3, 2)); // swap c and d
    assert.deepEqual(after.map((i) => [i.id, i.sortOrder]), [["a", 1], ["b", 2], ["d", 3], ["c", 4]]);
    assert.deepEqual(changedPositions(list, after).map((i) => i.id), ["d", "c"]);
    assert.deepEqual(changedPositions(list, list), []);
  });

  it("puts a new item at the end, even when the numbering has gaps", () => {
    assert.equal(nextSortOrder([]), 1);
    assert.equal(nextSortOrder([item("a", 1), item("b", 7)]), 8);
  });

  it("knows what is already on the list", () => {
    assert.ok(hasItem(list, "MCX_COM|b"));
    assert.ok(!hasItem(list, "MCX_COM|z"));
  });
});

describe("what a quote says", () => {
  it("calls a move up, down or flat on the percentage as shown", () => {
    assert.equal(moveDirection(0.18), "up");
    assert.equal(moveDirection(-0.6), "down");
    assert.equal(moveDirection(0), "flat");
    assert.equal(moveDirection(-0.001), "flat");
    assert.equal(moveDirection(0.004), "flat");
    assert.equal(moveDirection(null), "flat");
  });

  it("signs a move and a percentage", () => {
    assert.equal(formatMove(44.3), "+44.30");
    assert.equal(formatMove(-48), "-48.00");
    assert.equal(formatMove(0), "0.00");
    assert.equal(formatMove(-1234.5), "-1,234.50");
    assert.equal(formatMovePct(0.178), "+0.18%");
    assert.equal(formatMovePct(-2.654), "-2.65%");
    assert.equal(formatMovePct(-0.001), "0.00%");
  });

  it("shows an index as points and anything else in rupees, with Indian grouping", () => {
    assert.equal(formatPrice("index", 25299.35), "25,299.35");
    assert.equal(formatPrice("commodity", 136923), "₹1,36,923.00");
    assert.equal(formatPrice("equity", 1423.5), "₹1,423.50");
  });

  it("keeps a day-range label short", () => {
    assert.equal(formatRangeValue(136481), "1,36,481");
    assert.equal(formatRangeValue(25142.95), "25,143");
    assert.equal(formatRangeValue(311.8), "311.8");
    assert.equal(formatRangeValue(15.25), "15.25");
    assert.equal(formatRangeValue(1324.8), "1,325");
  });

  it("places the price within today's range, and says nothing when there is no range", () => {
    assert.equal(dayRangePosition(7985, 8266, 7985), 0);
    assert.equal(dayRangePosition(7985, 8266, 8266), 1);
    assert.ok(Math.abs((dayRangePosition(8000, 8200, 8100) ?? NaN) - 0.5) < 1e-9);
    assert.equal(dayRangePosition(8000, 8200, 9000), 1);
    assert.equal(dayRangePosition(8000, 8200, 7000), 0);
    assert.equal(dayRangePosition(8000, 8000, 8000), null);
    assert.equal(dayRangePosition(null, 8200, 8100), null);
  });

  it("counts how many items are up, down and flat, skipping the unquoted", () => {
    assert.deepEqual(marketBreadth([quote(1), quote(2.5), quote(-0.4), quote(0), undefined, quote(null)]), { up: 2, down: 1, flat: 2, total: 5 });
    assert.deepEqual(marketBreadth([]), { up: 0, down: 0, flat: 0, total: 0 });
  });
});

describe("how an item is drawn", () => {
  it("uses a commodity's glyph and a name's initials", () => {
    assert.equal(itemGlyph({ kind: "commodity", symbol: "GOLD", name: "Gold" }), "Au");
    assert.equal(itemGlyph({ kind: "index", symbol: "NIFTY", name: "Nifty 50" }), "N5");
    assert.equal(itemGlyph({ kind: "index", symbol: "BANKNIFTY", name: "Bank Nifty" }), "BN");
    assert.equal(itemGlyph({ kind: "equity", symbol: "RELIANCE", name: "Reliance Industries" }), "RI");
    assert.equal(itemGlyph({ kind: "equity", symbol: "TCS", name: "TCS" }), "TC");
  });

  it("says which month and unit a commodity is quoted in", () => {
    const crude = { kind: "commodity" as const, itemKey: "MCX_COM|CRUDEOIL", symbol: "CRUDEOIL" };
    assert.equal(itemDetail(crude, { contract: { label: "x", expiry: "2026-11-19" } }), "MCX Nov 2026 · ₹/bbl");
    assert.equal(itemDetail(crude), "MCX · ₹/bbl");
    assert.equal(itemDetail({ kind: "index", itemKey: "NSE_INDEX|Nifty 50", symbol: "NIFTY" }), "NSE index");
    assert.equal(itemDetail({ kind: "index", itemKey: "BSE_INDEX|SENSEX", symbol: "SENSEX" }), "BSE index");
    assert.equal(itemDetail({ kind: "equity", itemKey: "NSE_EQ|INE002A01018", symbol: "RELIANCE" }), "NSE");
  });
});

describe("the sort cycle", () => {
  it("starts a column its natural way: A to Z for names, biggest first for numbers", () => {
    assert.deepEqual(nextSort(null, "name"), { key: "name", dir: "asc" });
    assert.deepEqual(nextSort(null, "price"), { key: "price", dir: "desc" });
    assert.deepEqual(nextSort(null, "change"), { key: "change", dir: "desc" });
    assert.deepEqual(nextSort(null, "range"), { key: "range", dir: "desc" });
  });

  it("reverses on a second click, and lets go on a third", () => {
    const first = nextSort(null, "change");
    const second = nextSort(first, "change");
    assert.deepEqual(second, { key: "change", dir: "asc" });
    assert.equal(nextSort(second, "change"), null);
    const nameSecond = nextSort(nextSort(null, "name"), "name");
    assert.deepEqual(nameSecond, { key: "name", dir: "desc" });
    assert.equal(nextSort(nameSecond, "name"), null);
  });

  it("starts over when a different column is clicked", () => {
    assert.deepEqual(nextSort({ key: "change", dir: "asc" }, "price"), { key: "price", dir: "desc" });
  });

  it("says in words what the sort is", () => {
    assert.equal(describeSort({ key: "change", dir: "desc" }), "Change today, biggest gainers first");
    assert.equal(describeSort({ key: "change", dir: "asc" }), "Change today, biggest losers first");
    assert.equal(describeSort({ key: "name", dir: "asc" }), "Instrument, A to Z");
    assert.equal(describeSort({ key: "price", dir: "asc" }), "Price, lowest first");
    assert.equal(describeSort({ key: "range", dir: "desc" }), "Day range, nearest the day's high first");
  });
});

describe("sortItems", () => {
  const list = [item("gold", 1, { name: "Gold" }), item("crude", 2, { name: "Crude Oil" }), item("silver", 3, { name: "Silver" }), item("copper", 4, { name: "Copper" })];
  const q = (changePct: number | null, price = 100, over: Partial<WatchQuote> = {}) => quote(changePct, { price, ...over });
  const quotes: Record<string, WatchQuote | undefined> = {
    "MCX_COM|gold": q(-2.1, 136000, { low: 135000, high: 139000 }),
    "MCX_COM|crude": q(0.5, 8100, { low: 7985, high: 8266 }),
    "MCX_COM|silver": q(-2.7, 179000, { low: 178000, high: 183000 }),
    "MCX_COM|copper": q(0.5, 1325, { low: 1324, high: 1340 }),
  };
  const ids = (items: readonly WatchlistItem[]) => items.map((i) => i.id);

  it("leaves the list alone with no sort, and never changes the list it is given", () => {
    assert.deepEqual(ids(sortItems(list, quotes, null)), ["gold", "crude", "silver", "copper"]);
    sortItems(list, quotes, { key: "name", dir: "asc" });
    assert.deepEqual(ids(list), ["gold", "crude", "silver", "copper"]);
  });

  it("sorts by name, either way, ignoring case", () => {
    assert.deepEqual(ids(sortItems(list, quotes, { key: "name", dir: "asc" })), ["copper", "crude", "gold", "silver"]);
    assert.deepEqual(ids(sortItems(list, quotes, { key: "name", dir: "desc" })), ["silver", "gold", "crude", "copper"]);
    const mixed = [item("a", 1, { name: "zinc" }), item("b", 2, { name: "Aluminium" })];
    assert.deepEqual(ids(sortItems(mixed, {}, { key: "name", dir: "asc" })), ["b", "a"]);
  });

  it("sorts by price", () => {
    assert.deepEqual(ids(sortItems(list, quotes, { key: "price", dir: "desc" })), ["silver", "gold", "crude", "copper"]);
    assert.deepEqual(ids(sortItems(list, quotes, { key: "price", dir: "asc" })), ["copper", "crude", "gold", "silver"]);
  });

  it("sorts by change, gainers first or losers first, keeping a tie in list order", () => {
    // crude and copper are both +0.50%: crude is earlier in the list, so it stays ahead of copper both ways.
    assert.deepEqual(ids(sortItems(list, quotes, { key: "change", dir: "desc" })), ["crude", "copper", "gold", "silver"]);
    assert.deepEqual(ids(sortItems(list, quotes, { key: "change", dir: "asc" })), ["silver", "gold", "crude", "copper"]);
  });

  it("sorts by where the price sits in today's range", () => {
    // gold 136000 in 135000-139000 = 25%; crude 8100 in 7985-8266 ~ 41%; silver 179000 in 178000-183000 = 20%; copper 1325 in 1324-1340 ~ 6%.
    assert.deepEqual(ids(sortItems(list, quotes, { key: "range", dir: "desc" })), ["crude", "gold", "silver", "copper"]);
    assert.deepEqual(ids(sortItems(list, quotes, { key: "range", dir: "asc" })), ["copper", "silver", "gold", "crude"]);
  });

  it("puts a row with nothing to sort on last, whichever way", () => {
    const partial: Record<string, WatchQuote | undefined> = { "MCX_COM|gold": q(1), "MCX_COM|silver": q(-1) }; // crude and copper have no quote
    assert.deepEqual(ids(sortItems(list, partial, { key: "change", dir: "desc" })), ["gold", "silver", "crude", "copper"]);
    assert.deepEqual(ids(sortItems(list, partial, { key: "change", dir: "asc" })), ["silver", "gold", "crude", "copper"]);
    const noRange: Record<string, WatchQuote | undefined> = { ...quotes, "MCX_COM|crude": q(0.5, 8100) }; // no day range yet
    assert.equal(sortItems(list, noRange, { key: "range", dir: "desc" }).at(-1)?.id, "crude");
    assert.equal(sortItems(list, noRange, { key: "range", dir: "asc" }).at(-1)?.id, "crude");
  });
});

describe("matchesView", () => {
  const gold = { name: "Gold", symbol: "GOLD" };
  const nifty = { name: "Nifty Bank", symbol: "BANKNIFTY" };
  const none = { text: "", mover: null } as const;

  it("keeps everything when nothing is typed or chosen", () => {
    assert.ok(matchesView(gold, quote(1), none));
    assert.ok(matchesView(gold, undefined, none));
  });

  it("matches words in the name or the symbol, in any order, ignoring case", () => {
    assert.ok(matchesView(nifty, undefined, { text: "bank", mover: null }));
    assert.ok(matchesView(nifty, undefined, { text: "BANKNIFTY", mover: null }));
    assert.ok(matchesView(nifty, undefined, { text: "bank nifty", mover: null }));
    assert.ok(matchesView(nifty, undefined, { text: "nifty bank", mover: null }));
    assert.ok(!matchesView(nifty, undefined, { text: "gold", mover: null }));
    assert.ok(!matchesView(nifty, undefined, { text: "bank gold", mover: null }));
  });

  it("keeps only gainers or only losers", () => {
    assert.ok(matchesView(gold, quote(1.2), { text: "", mover: "up" }));
    assert.ok(!matchesView(gold, quote(-1.2), { text: "", mover: "up" }));
    assert.ok(matchesView(gold, quote(-1.2), { text: "", mover: "down" }));
    assert.ok(!matchesView(gold, quote(0), { text: "", mover: "down" }));
    assert.ok(!matchesView(gold, quote(-0.001), { text: "", mover: "down" })); // flat as shown, so not a loser
  });

  it("can't call a row with no price a gainer or a loser", () => {
    assert.ok(!matchesView(gold, undefined, { text: "", mover: "up" }));
    assert.ok(!matchesView(gold, quote(null), { text: "", mover: "down" }));
  });

  it("applies the text and the mover chip together", () => {
    assert.ok(matchesView(gold, quote(1), { text: "gold", mover: "up" }));
    assert.ok(!matchesView(gold, quote(1), { text: "silver", mover: "up" }));
  });
});

describe("parseSort", () => {
  it("reads back a saved sort", () => {
    const saved: SortState = { key: "change", dir: "asc" };
    assert.deepEqual(parseSort(JSON.parse(JSON.stringify(saved))), saved);
  });

  it("rejects anything that isn't one of the choices", () => {
    assert.equal(parseSort(null), null);
    assert.equal(parseSort("change"), null);
    assert.equal(parseSort({ key: "volume", dir: "asc" }), null);
    assert.equal(parseSort({ key: "price", dir: "sideways" }), null);
    assert.equal(parseSort({ key: "price" }), null);
  });
});
