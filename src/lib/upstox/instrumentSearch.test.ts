import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cleanQuery, mapEquityRows, mapIndexRows, searchCommodities, searchGlobalIndices } from "@/lib/upstox/instrumentSearch";
import type { McxFuture } from "@/lib/upstox/mcx";

const fut = (symbol: string, name: string, expiry = "2026-11-19"): [string, McxFuture] => [symbol, { symbol, name, key: `MCX_FO|${symbol}`, expiry, tradingSymbol: `${symbol} FUT` }];
const futures = new Map<string, McxFuture>([
  fut("CRUDEOIL", "CRUDE OIL"),
  fut("CRUDEOILM", "CRUDE OIL"),
  fut("GOLD", "GOLD", "2026-12-04"),
  fut("GOLDM", "GOLD", "2026-12-04"),
  fut("GOLDPETAL", "GOLD", "2026-11-30"),
  fut("SILVER", "SILVER", "2026-12-04"),
  fut("MCXBULLDEX", "MCXBULLDEX"),
  // Listed by the exchange, but not offered by the app.
  fut("LEAD", "LEAD", "2026-11-30"),
  fut("LEADMINI", "LEAD", "2026-11-30"),
  fut("NICKEL", "NICKEL", "2026-12-16"),
  fut("CARDAMOM", "CARDAMOM", "2026-11-30"),
  fut("MENTHAOIL", "MENTHAOIL", "2026-11-30"),
]);

describe("cleanQuery", () => {
  it("trims and collapses, and wants at least two characters", () => {
    assert.equal(cleanQuery("  reli   ance "), "reli ance");
    assert.equal(cleanQuery("a"), null);
    assert.equal(cleanQuery(" a "), null);
    assert.equal(cleanQuery(null), null);
    assert.equal(cleanQuery("x".repeat(41)), null);
    assert.equal(cleanQuery("ab\u0000c"), "ab c");
  });
});

describe("searchCommodities", () => {
  it("does not offer Lead, Lead Mini, Nickel, Cardamom or Mentha Oil, though the exchange lists them", () => {
    for (const query of ["lead", "nickel", "cardamom", "mentha", "LEADMINI", "Mentha Oil", "ni", "ca"]) {
      const found = searchCommodities(futures, query).map((r) => r.symbol);
      for (const symbol of ["LEAD", "LEADMINI", "NICKEL", "CARDAMOM", "MENTHAOIL"]) assert.ok(!found.includes(symbol), `"${query}" found ${symbol}`);
    }
    assert.deepEqual(searchCommodities(futures, "lead"), []);
  });

  it("finds a commodity by name or symbol, case-insensitively", () => {
    assert.deepEqual(searchCommodities(futures, "crude").map((r) => r.symbol), ["CRUDEOIL", "CRUDEOILM"]);
    assert.deepEqual(searchCommodities(futures, "SILVER").map((r) => r.symbol), ["SILVER"]);
  });

  it("puts an exact symbol first, then names that start with the query", () => {
    assert.deepEqual(searchCommodities(futures, "gold").map((r) => r.symbol), ["GOLD", "GOLDM", "GOLDPETAL"]);
  });

  it("gives each commodity one row, named apart from its mini, with its month and unit", () => {
    const [full, mini] = searchCommodities(futures, "crude oil");
    assert.equal(full.name, "Crude Oil");
    assert.equal(mini.name, "Crude Oil Mini");
    assert.equal(full.itemKey, "MCX_COM|CRUDEOIL");
    assert.equal(full.kind, "commodity");
    assert.equal(full.detail, "MCX · Nov 2026 · ₹/bbl");
  });

  it("leaves the MCX indices out, and needs every word to match", () => {
    assert.deepEqual(searchCommodities(futures, "mcx"), []);
    assert.deepEqual(searchCommodities(futures, "gold silver"), []);
    assert.deepEqual(searchCommodities(futures, ""), []);
  });

  it("honours the limit", () => {
    assert.equal(searchCommodities(futures, "go", 2).length, 2);
  });
});

describe("mapEquityRows", () => {
  const body = {
    data: [
      { segment: "NSE_EQ", instrument_type: "EQ", trading_symbol: "RELIANCE", short_name: "Reliance Industries", name: "RELIANCE INDUSTRIES LTD", instrument_key: "NSE_EQ|INE002A01018" },
      { segment: "BSE_EQ", instrument_type: "A", trading_symbol: "RELIANCE", name: "RELIANCE INDUSTRIES LTD.", instrument_key: "BSE_EQ|INE002A01018" },
      { segment: "NSE_EQ", instrument_type: "EQ", trading_symbol: "RPOWER", name: "RELIANCE POWER LTD", instrument_key: "NSE_EQ|INE614G01033" },
      { segment: "NSE_EQ", instrument_type: "EQ", trading_symbol: "NOKEY", name: "no key" },
    ],
  };

  it("keeps NSE stocks, named the friendly way where Upstox has one", () => {
    assert.deepEqual(mapEquityRows(body), [
      { kind: "equity", itemKey: "NSE_EQ|INE002A01018", symbol: "RELIANCE", name: "Reliance Industries", detail: "NSE" },
      { kind: "equity", itemKey: "NSE_EQ|INE614G01033", symbol: "RPOWER", name: "RELIANCE POWER LTD", detail: "NSE" },
    ]);
  });

  it("survives a response that isn't what it expects", () => {
    assert.deepEqual(mapEquityRows(null), []);
    assert.deepEqual(mapEquityRows({ data: "x" }), []);
    assert.deepEqual(mapEquityRows({}), []);
  });

  it("honours the limit", () => {
    assert.equal(mapEquityRows(body, 1).length, 1);
  });
});

describe("mapIndexRows - fuzzy hits", () => {
  const body = {
    data: [
      { segment: "BSE_INDEX", instrument_type: "INDEX", trading_symbol: "BSECG", name: "BSE CAPITAL GOODS", instrument_key: "BSE_INDEX|BSECG" },
      { segment: "NSE_INDEX", instrument_type: "INDEX", trading_symbol: "NIFTYBANK", short_name: "Nifty Bank", instrument_key: "NSE_INDEX|Nifty Bank" },
      { segment: "NSE_INDEX", instrument_type: "INDEX", trading_symbol: "NIFTYNXT50", short_name: "Nifty Next 50", instrument_key: "NSE_INDEX|Nifty Next 50" },
    ],
  };

  it("drops an index that doesn't contain what was typed", () => {
    assert.deepEqual(mapIndexRows(body, 6, "gold").map((r) => r.name), []);
    assert.deepEqual(mapIndexRows(body, 6, "nifty").map((r) => r.name), ["Nifty Bank", "Nifty Next 50"]);
    assert.deepEqual(mapIndexRows(body, 6, "nifty next").map((r) => r.name), ["Nifty Next 50"]);
  });

  it("matches the symbol too, and keeps everything when no query is given", () => {
    assert.deepEqual(mapIndexRows(body, 6, "bsecg").map((r) => r.name), ["BSE CAPITAL GOODS"]);
    assert.equal(mapIndexRows(body).length, 3);
  });
});

describe("mapIndexRows", () => {
  it("keeps NSE and BSE indices and says which", () => {
    const body = {
      data: [
        { segment: "NSE_INDEX", instrument_type: "INDEX", trading_symbol: "NIFTY", short_name: "Nifty 50", instrument_key: "NSE_INDEX|Nifty 50" },
        { segment: "BSE_INDEX", instrument_type: "INDEX", trading_symbol: "SENSEX", name: "BSE SENSEX", instrument_key: "BSE_INDEX|SENSEX" },
        { segment: "NSE_EQ", instrument_type: "EQ", trading_symbol: "NIFTYBEES", instrument_key: "NSE_EQ|INF204KB14I2" },
      ],
    };
    assert.deepEqual(mapIndexRows(body), [
      { kind: "index", itemKey: "NSE_INDEX|Nifty 50", symbol: "NIFTY", name: "Nifty 50", detail: "NSE index" },
      { kind: "index", itemKey: "BSE_INDEX|SENSEX", symbol: "SENSEX", name: "BSE SENSEX", detail: "BSE index" },
    ]);
  });
});

describe("searchGlobalIndices - GIFT Nifty, which Upstox's own search never returns", () => {
  const gift = { kind: "index", itemKey: "GLOBAL_INDEX|SGX NIFTY", symbol: "GIFTNIFTY", name: "GIFT Nifty", detail: "NSE IX · GIFT City" };

  it("finds it by the words people use for it", () => {
    for (const q of ["gift", "GIFT Nifty", "gift nifty", "giftnifty", "sgx", "sgx nifty", "nse ix", "gift city", "nifty"]) {
      assert.deepEqual(searchGlobalIndices(q), [gift], q);
    }
  });

  it("is not offered for anything else", () => {
    for (const q of ["reliance", "gold", "nifty bank", "nifty 50", "vix", "sensex", ""]) {
      assert.deepEqual(searchGlobalIndices(q), [], q);
    }
  });
});
