import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { iconTone, instrumentIconKind } from "@/lib/instrumentIcon";
import { HEATMAP_COMMODITIES } from "@/lib/mcxCommodities";

describe("which icon an instrument gets", () => {
  it("draws the commodities the Watchlist starts with", () => {
    const kinds = Object.fromEntries(HEATMAP_COMMODITIES.map((symbol) => [symbol, instrumentIconKind({ kind: "commodity", symbol })]));
    assert.deepEqual(kinds, {
      CRUDEOIL: "oil",
      NATURALGAS: "gas",
      GOLD: "gold",
      SILVER: "silver",
      COPPER: "copper",
      ZINC: "metal",
      ALUMINIUM: "metal",
      LEAD: "metal",
      NICKEL: "metal",
    });
  });

  it("gives a mini contract the icon of its full-size one", () => {
    for (const [mini, full] of [["CRUDEOILM", "CRUDEOIL"], ["NATGASMINI", "NATURALGAS"], ["GOLDM", "GOLD"], ["SILVERM", "SILVER"], ["ZINCMINI", "ZINC"]]) {
      assert.equal(instrumentIconKind({ kind: "commodity", symbol: mini }), instrumentIconKind({ kind: "commodity", symbol: full }), mini);
    }
  });

  it("gives indices and stocks a monogram, and a commodity it has no drawing for", () => {
    assert.equal(instrumentIconKind({ kind: "index", symbol: "NIFTY" }), "monogram");
    assert.equal(instrumentIconKind({ kind: "equity", symbol: "RELIANCE" }), "monogram");
    assert.equal(instrumentIconKind({ kind: "commodity", symbol: "SOMETHINGNEW" }), "monogram");
  });

  it("does not take a symbol that merely shares a name with a commodity for one - only commodities are drawn", () => {
    assert.equal(instrumentIconKind({ kind: "equity", symbol: "GOLD" }), "monogram");
    assert.equal(instrumentIconKind({ kind: "index", symbol: "CRUDEOIL" }), "monogram");
  });
});

describe("the tile's colour", () => {
  it("is the same for the same stock every time, and not always the same across stocks", () => {
    const tone = (symbol: string) => iconTone({ kind: "equity", symbol });
    assert.equal(tone("RELIANCE"), tone("RELIANCE"));
    const tones = new Set(["RELIANCE", "TCS", "INFY", "HDFCBANK", "ITC", "SBIN", "WIPRO", "LT", "AXISBANK", "MARUTI"].map(tone));
    assert.ok(tones.size > 1);
  });

  it("is never the red or green that already mean a fall and a rise", () => {
    for (const symbol of ["A", "B", "C", "D", "E", "F", "G", "H", "TCS", "INFY", "RELIANCE"]) {
      const tone = iconTone({ kind: "equity", symbol });
      assert.ok(!/success|danger|profit|loss/.test(tone), tone);
    }
  });

  it("is the accent for an index and amber for a commodity that has no drawing", () => {
    assert.equal(iconTone({ kind: "index", symbol: "NIFTY" }), "var(--accent)");
    assert.equal(iconTone({ kind: "commodity", symbol: "SOMETHINGNEW" }), "var(--warning)");
  });

  it("gives every drawn commodity its own colour treatment", () => {
    const tone = (symbol: string) => iconTone({ kind: "commodity", symbol });
    assert.notEqual(tone("GOLD"), tone("SILVER"));
    assert.notEqual(tone("CRUDEOIL"), tone("NATURALGAS"));
    assert.notEqual(tone("COPPER"), tone("ZINC"));
  });
});
