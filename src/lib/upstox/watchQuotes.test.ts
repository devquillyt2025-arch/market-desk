import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_WATCH_ITEMS, parseQuoteEntry, parseWatchRequest, resolveQuoteKey } from "@/lib/upstox/watchQuotes";
import type { McxFuture } from "@/lib/upstox/mcx";

const near = (a: number | null, b: number, eps = 1e-6) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} vs ${b}`);

describe("parseWatchRequest", () => {
  const nifty = { itemKey: "NSE_INDEX|Nifty 50", kind: "index", symbol: "NIFTY" };
  const reliance = { itemKey: "NSE_EQ|INE002A01018", kind: "equity", symbol: "RELIANCE" };
  const crude = { itemKey: "MCX_COM|CRUDEOIL", kind: "commodity", symbol: "CRUDEOIL" };

  it("accepts the three kinds of instrument", () => {
    assert.deepEqual(parseWatchRequest({ items: [nifty, reliance, crude] }), [nifty, reliance, crude]);
    assert.deepEqual(parseWatchRequest({ items: [] }), []);
  });

  it("drops a repeat of the same instrument", () => {
    assert.equal(parseWatchRequest({ items: [nifty, nifty, crude] })?.length, 2);
  });

  it("refuses anything that isn't a clean list", () => {
    assert.equal(parseWatchRequest(null), null);
    assert.equal(parseWatchRequest({}), null);
    assert.equal(parseWatchRequest({ items: "NSE_INDEX|Nifty 50" }), null);
    assert.equal(parseWatchRequest({ items: [null] }), null);
    assert.equal(parseWatchRequest({ items: [{ ...nifty, kind: "futures" }] }), null);
  });

  it("refuses a key that could break out of the Upstox query", () => {
    const bad = ["NSE_INDEX|Nifty 50,NSE_EQ|INE002A01018", "NSE_INDEX|a/b", "NSE_INDEX|a|b", "https://evil.example", "NSE_INDEX|", "MCX_FO|123", "NSE_INDEX|x&instrument_key=y"];
    for (const itemKey of bad) {
      assert.equal(parseWatchRequest({ items: [{ ...nifty, itemKey }] }), null, itemKey);
    }
  });

  it("refuses a key that doesn't fit its kind", () => {
    assert.equal(parseWatchRequest({ items: [{ ...nifty, kind: "equity" }] }), null);
    assert.equal(parseWatchRequest({ items: [{ ...reliance, kind: "index" }] }), null);
  });

  it("refuses a commodity symbol that isn't one", () => {
    assert.equal(parseWatchRequest({ items: [{ ...crude, symbol: "crude oil" }] }), null);
    assert.equal(parseWatchRequest({ items: [{ ...crude, symbol: "A" }] }), null);
  });

  it("caps how many it will quote", () => {
    const many = Array.from({ length: MAX_WATCH_ITEMS + 1 }, (_, i) => ({ itemKey: `NSE_EQ|INE${String(i).padStart(9, "0")}`, kind: "equity", symbol: `S${i}` }));
    assert.equal(parseWatchRequest({ items: many }), null);
    assert.equal(parseWatchRequest({ items: many.slice(0, MAX_WATCH_ITEMS) })?.length, MAX_WATCH_ITEMS);
  });
});

describe("resolveQuoteKey", () => {
  const futures = new Map<string, McxFuture>([
    ["CRUDEOIL", { symbol: "CRUDEOIL", name: "CRUDE OIL", key: "MCX_FO|573422", expiry: "2026-11-19", tradingSymbol: "CRUDEOIL FUT 19 NOV 26" }],
  ]);

  it("quotes an index or stock by its own key", () => {
    assert.deepEqual(resolveQuoteKey({ itemKey: "NSE_INDEX|Nifty 50", kind: "index", symbol: "NIFTY" }, futures), { key: "NSE_INDEX|Nifty 50", contract: null });
  });

  it("quotes a commodity by whichever future is current, and says which month", () => {
    assert.deepEqual(resolveQuoteKey({ itemKey: "MCX_COM|CRUDEOIL", kind: "commodity", symbol: "CRUDEOIL" }, futures), {
      key: "MCX_FO|573422",
      contract: { label: "Nov 2026", expiry: "2026-11-19" },
    });
  });

  it("has nothing for a commodity the exchange lists no contract for", () => {
    assert.equal(resolveQuoteKey({ itemKey: "MCX_COM|OIL", kind: "commodity", symbol: "OIL" }, futures), null);
  });
});

describe("parseQuoteEntry", () => {
  // The shapes Upstox returned on 12 Nov 2026.
  const niftyEntry = { ohlc: { open: 25213.5, high: 25384.8, low: 25142.95, close: 25299.35 }, last_price: 25299.35, volume: null, net_change: 44.3, oi: null };
  const crudeEntry = { ohlc: { open: 8038, high: 8266, low: 7985, close: 8136 }, last_price: 8136, volume: 37379, net_change: -48, oi: 9208 };

  it("works out yesterday's close and the move from net_change", () => {
    const q = parseQuoteEntry(niftyEntry, null);
    near(q?.price ?? null, 25299.35);
    near(q?.prevClose ?? null, 25255.05);
    near(q?.change ?? null, 44.3);
    near(q?.changePct ?? null, (44.3 / 25255.05) * 100);
    assert.equal(q?.low, 25142.95);
    assert.equal(q?.high, 25384.8);
    assert.equal(q?.open, 25213.5);
    assert.equal(q?.volume, null);
  });

  it("handles a falling commodity, and carries the contract and volume through", () => {
    const contract = { label: "Nov 2026", expiry: "2026-11-19" };
    const q = parseQuoteEntry(crudeEntry, contract);
    near(q?.prevClose ?? null, 8184);
    near(q?.change ?? null, -48);
    near(q?.changePct ?? null, (-48 / 8184) * 100);
    assert.equal(q?.volume, 37379);
    assert.deepEqual(q?.contract, contract);
  });

  it("gives no quote when nothing has traded", () => {
    assert.equal(parseQuoteEntry({ ...crudeEntry, last_price: 0 }, null), null);
    assert.equal(parseQuoteEntry({ last_price: null }, null), null);
    assert.equal(parseQuoteEntry(null, null), null);
    assert.equal(parseQuoteEntry("nope", null), null);
  });

  it("keeps the price but not a move it can't back up", () => {
    const q = parseQuoteEntry({ last_price: 100, net_change: null, ohlc: { open: 0, high: 0, low: 0, close: 100 } }, null);
    assert.equal(q?.price, 100);
    assert.equal(q?.change, null);
    assert.equal(q?.changePct, null);
    assert.equal(q?.prevClose, null);
    assert.equal(q?.high, null);
  });

  it("copes with a missing ohlc block", () => {
    const q = parseQuoteEntry({ last_price: 50, net_change: 1 }, null);
    assert.equal(q?.open, null);
    near(q?.prevClose ?? null, 49);
  });
});

describe("GIFT Nifty - a global index on the list", () => {
  const gift = { itemKey: "GLOBAL_INDEX|SGX NIFTY", kind: "index", symbol: "GIFTNIFTY" };

  it("is accepted as an index, beside the others", () => {
    const nifty = { itemKey: "NSE_INDEX|Nifty 50", kind: "index", symbol: "NIFTY" };
    assert.deepEqual(parseWatchRequest({ items: [nifty, gift] }), [nifty, gift]);
  });

  it("is quoted under its own key, like any index", () => {
    assert.deepEqual(resolveQuoteKey({ itemKey: gift.itemKey, kind: "index", symbol: gift.symbol }, new Map()), { key: "GLOBAL_INDEX|SGX NIFTY", contract: null });
  });

  it("still refuses a global key filed as anything but an index, and a global key that could smuggle in a second key", () => {
    assert.equal(parseWatchRequest({ items: [{ ...gift, kind: "equity" }] }), null);
    assert.equal(parseWatchRequest({ items: [{ ...gift, itemKey: "GLOBAL_EQ|SGX NIFTY" }] }), null);
    assert.equal(parseWatchRequest({ items: [{ ...gift, itemKey: "GLOBAL_INDEX|SGX NIFTY,NSE_EQ|INE002A01018" }] }), null);
    assert.equal(parseWatchRequest({ items: [{ ...gift, itemKey: "GLOBAL_INDEX|SGX|NIFTY" }] }), null);
    assert.equal(parseWatchRequest({ items: [{ ...gift, itemKey: "GLOBAL_INDEX|" }] }), null);
    assert.equal(parseWatchRequest({ items: [{ ...gift, itemKey: "MCX_INDEX|SGX NIFTY" }] }), null);
  });

  it("reduces Upstox's own answer for it (17 Nov 2026, evening) to a price and the day's move", () => {
    const entry = {
      ohlc: { open: 25289, high: 25558.5, low: 25256.5, close: 25361.5 },
      instrument_token: "GLOBAL_INDEX|SGX NIFTY",
      last_price: 25361.5,
      volume: null,
      net_change: -16.5,
    };
    const quote = parseQuoteEntry(entry, null);
    near(quote?.price ?? null, 25361.5);
    near(quote?.prevClose ?? null, 25378); // the price less the change, as for every other index
    near(quote?.change ?? null, -16.5);
    near(quote?.changePct ?? null, (-16.5 / 25378) * 100, 1e-9);
    assert.deepEqual([quote?.open, quote?.high, quote?.low, quote?.volume], [25289, 25558.5, 25256.5, null]);
  });
});

describe("when an instrument last traded", () => {
  const entry = (last_trade_time: unknown) => ({ last_price: 25379.5, net_change: 1.5, last_trade_time });

  it("is read from Upstox's millisecond text", () => {
    assert.equal(parseQuoteEntry(entry("1794928739000"), null)?.asOf, 1794928739000);
    assert.equal(parseQuoteEntry(entry(1794928739000), null)?.asOf, 1794928739000);
  });

  it("is left out when it is missing or isn't a plausible time", () => {
    for (const bad of [undefined, null, "", "abc", "0", "-5", "1794928739"]) assert.equal(parseQuoteEntry(entry(bad), null)?.asOf, null, String(bad));
  });
});

describe("Dow futures - the second global index quoted by key", () => {
  it("is accepted as an index, like GIFT Nifty", () => {
    const dow = { itemKey: "GLOBAL_INDEX|DOW FUTURES", kind: "index", symbol: "DOWFUTURES" };
    assert.deepEqual(parseWatchRequest({ items: [dow] }), [dow]);
  });
});
