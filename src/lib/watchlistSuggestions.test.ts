import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseWatchRequest } from "@/lib/upstox/watchQuotes";
import { suggestedInstruments } from "@/lib/watchlistSuggestions";

describe("suggestedInstruments", () => {
  const all = suggestedInstruments(new Set());

  it("offers a few of each kind", () => {
    assert.ok(all.indices.length >= 3 && all.commodities.length >= 3 && all.stocks.length >= 4);
    assert.ok(all.indices.every((s) => s.kind === "index"));
    assert.ok(all.commodities.every((s) => s.kind === "commodity"));
    assert.ok(all.stocks.every((s) => s.kind === "equity"));
  });

  it("names every stock from the Heatmap's table, with its ISIN as the key", () => {
    const reliance = all.stocks.find((s) => s.symbol === "RELIANCE");
    assert.deepEqual(reliance, { kind: "equity", itemKey: "NSE_EQ|INE002A01018", symbol: "RELIANCE", name: "Reliance Industries", detail: "NSE" });
  });

  it("offers the mini commodities, whose full-size contracts are already on the starting list", () => {
    assert.deepEqual(all.commodities.map((s) => s.symbol), ["CRUDEOILM", "GOLDM", "SILVERM", "NATGASMINI"]);
    assert.equal(all.commodities[0].itemKey, "MCX_COM|CRUDEOILM");
    assert.equal(all.commodities[0].name, "Crude Oil Mini");
  });

  it("leaves out what is already listed", () => {
    const some = suggestedInstruments(new Set(["NSE_INDEX|India VIX", "MCX_COM|GOLDM", "NSE_EQ|INE002A01018"]));
    assert.ok(!some.indices.some((s) => s.symbol === "INDIA VIX"));
    assert.ok(!some.commodities.some((s) => s.symbol === "GOLDM"));
    assert.ok(!some.stocks.some((s) => s.symbol === "RELIANCE"));
    assert.equal(some.stocks.length, all.stocks.length - 1);
  });

  it("only suggests what the server will agree to quote", () => {
    for (const s of [...all.indices, ...all.commodities, ...all.stocks]) {
      const parsed = parseWatchRequest({ items: [{ itemKey: s.itemKey, kind: s.kind, symbol: s.symbol.replace(/\s/g, "") }] });
      assert.ok(parsed !== null && parsed.length === 1, s.itemKey);
    }
  });
});

describe("GIFT Nifty as a suggestion", () => {
  it("heads the indices, with where it trades", () => {
    const first = suggestedInstruments(new Set()).indices[0];
    assert.deepEqual(first, { kind: "index", itemKey: "GLOBAL_INDEX|SGX NIFTY", symbol: "GIFTNIFTY", name: "GIFT Nifty", detail: "NSE IX · GIFT City" });
  });

  it("is left out once it is on the list, and the NSE ones keep their own detail", () => {
    const some = suggestedInstruments(new Set(["GLOBAL_INDEX|SGX NIFTY"]));
    assert.ok(!some.indices.some((s) => s.symbol === "GIFTNIFTY"));
    assert.ok(some.indices.every((s) => s.detail === "NSE index"));
  });
});
