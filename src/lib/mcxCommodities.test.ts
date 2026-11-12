import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { HEATMAP_COMMODITIES, commodityGlyph, commodityName, commodityUnit, contractMonthLabel, isMcxCommodity } from "@/lib/mcxCommodities";

describe("commodity catalog", () => {
  it("names the full-size and mini contracts apart, though the exchange calls both 'CRUDE OIL'", () => {
    assert.equal(commodityName("CRUDEOIL", "CRUDE OIL"), "Crude Oil");
    assert.equal(commodityName("CRUDEOILM", "CRUDE OIL"), "Crude Oil Mini");
    assert.equal(commodityName("GOLDM", "GOLD"), "Gold Mini");
  });

  it("tidies the exchange's name for a commodity it doesn't know", () => {
    assert.equal(commodityName("NEWTHING", "NEW THING OIL"), "New Thing Oil");
    assert.equal(commodityName("NEWTHING"), "Newthing");
  });

  it("gives every heatmap commodity a name, glyph and unit", () => {
    for (const symbol of HEATMAP_COMMODITIES) {
      assert.ok(commodityName(symbol).length > 2, symbol);
      assert.ok(commodityGlyph(symbol).length >= 2, symbol);
      assert.ok(commodityUnit(symbol).startsWith("₹/"), symbol);
    }
  });

  it("uses chemical symbols for the metals", () => {
    assert.deepEqual(["GOLD", "SILVER", "COPPER", "ZINC", "ALUMINIUM", "LEAD", "NICKEL"].map(commodityGlyph), ["Au", "Ag", "Cu", "Zn", "Al", "Pb", "Ni"]);
  });

  it("quotes gold per 10 g and silver per kg", () => {
    assert.equal(commodityUnit("GOLD"), "₹/10 g");
    assert.equal(commodityUnit("SILVER"), "₹/kg");
    assert.equal(commodityUnit("UNKNOWN"), "");
  });

  it("tells the MCX indices from commodities", () => {
    assert.equal(isMcxCommodity("MCXBULLDEX"), false);
    assert.equal(isMcxCommodity("CRUDEOIL"), true);
  });

  it("labels a contract by its month", () => {
    assert.equal(contractMonthLabel("2026-11-19"), "Nov 2026");
    assert.equal(contractMonthLabel("2027-01-05"), "Jan 2027");
  });
});
