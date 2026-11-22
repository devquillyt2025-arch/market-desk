import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { STARTING_COMMODITIES, commodityFutures, commodityGlyph, commodityName, commodityUnit, contractMonthLabel, isMcxCommodity, isOfferedCommodity, NOT_OFFERED_COMMODITIES } from "@/lib/mcxCommodities";
import { DEFAULT_WATCHLIST } from "@/lib/watchlist";
import { COMMODITY_INSTRUMENTS, DEFAULT_LOT_SIZES, INSTRUMENT_LABELS, INSTRUMENTS, STRIKE_STEPS, underlyingFamily } from "@/lib/types";

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

  it("gives every commodity a new Watchlist starts with a name, glyph and unit", () => {
    for (const symbol of STARTING_COMMODITIES) {
      assert.ok(commodityName(symbol).length > 2, symbol);
      assert.ok(commodityGlyph(symbol).length >= 2, symbol);
      assert.ok(commodityUnit(symbol).startsWith("₹/"), symbol);
    }
  });

  it("uses chemical symbols for the metals", () => {
    assert.deepEqual(["GOLD", "SILVER", "COPPER", "ZINC", "ALUMINIUM"].map(commodityGlyph), ["Au", "Ag", "Cu", "Zn", "Al"]);
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

/** Every commodity contract Upstox listed on 21 Nov 2026 (the two MCX indices apart) - the tiles of the Heatmap's Commodities tab. */
const LISTED_ON_MCX = {
  CRUDEOIL: "Crude Oil",
  CRUDEOILM: "Crude Oil Mini",
  NATURALGAS: "Natural Gas",
  NATGASMINI: "Natural Gas Mini",
  GOLD: "Gold",
  GOLDM: "Gold Mini",
  GOLDTEN: "Gold Ten",
  GOLDGUINEA: "Gold Guinea",
  GOLDPETAL: "Gold Petal",
  SILVER: "Silver",
  SILVERM: "Silver Mini",
  SILVERMIC: "Silver Micro",
  SILVER100: "Silver 100",
  COPPER: "Copper",
  ZINC: "Zinc",
  ZINCMINI: "Zinc Mini",
  ALUMINIUM: "Aluminium",
  ALUMINI: "Aluminium Mini",
  COTTON: "Cotton",
  COTTONOIL: "Cottonseed Oil",
  KAPAS: "Kapas",
  SUNOIL: "Sunflower Oil",
  ELECDMBL: "Electricity",
} as const;

describe("the Heatmap's commodities", () => {
  // Everything Upstox lists - the five commodities the app doesn't offer and the two MCX indices included.
  const exchange = [...Object.keys(LISTED_ON_MCX), ...NOT_OFFERED_COMMODITIES, "MCXBULLDEX", "MCXMETLDEX"].map((symbol) => ({ symbol, key: `MCX_FO|${symbol}` }));

  it("are every commodity the exchange lists that the app offers - the mini and micro contracts too - and not its indices", () => {
    const tiles = commodityFutures(exchange);
    assert.equal(tiles.length, Object.keys(LISTED_ON_MCX).length);
    assert.deepEqual(tiles.map((t) => t.symbol), Object.keys(LISTED_ON_MCX));
    assert.ok(!tiles.some((t) => t.symbol.startsWith("MCX")));
  });

  it("keep the exchange's own fields and order, and take a commodity that starts trading later without a code change", () => {
    const tiles = commodityFutures([{ symbol: "NEWGRAIN", key: "MCX_FO|new", expiry: "2026-12-31" }, { symbol: "MCXBULLDEX", key: "x", expiry: "" }, { symbol: "GOLD", key: "MCX_FO|gold", expiry: "2026-12-04" }]);
    assert.deepEqual(tiles, [{ symbol: "NEWGRAIN", key: "MCX_FO|new", expiry: "2026-12-31" }, { symbol: "GOLD", key: "MCX_FO|gold", expiry: "2026-12-04" }]);
    assert.deepEqual(commodityFutures([]), []);
  });

  it("have a readable name on their tile - the exchange calls five of them just 'GOLD' and four 'SILVER'", () => {
    for (const [symbol, name] of Object.entries(LISTED_ON_MCX)) assert.equal(commodityName(symbol), name, symbol);
    assert.equal(new Set(Object.keys(LISTED_ON_MCX).map((s) => commodityName(s))).size, Object.keys(LISTED_ON_MCX).length, "no two tiles share a name");
  });

  it("start with the same commodities the Watchlist's starting list does, as a subset", () => {
    for (const symbol of STARTING_COMMODITIES) assert.ok(symbol in LISTED_ON_MCX, symbol);
  });
});

describe("commodities the app does not offer: Mentha Oil, Cardamom, Lead, Lead Mini, Nickel", () => {
  const removed = ["MENTHAOIL", "CARDAMOM", "LEAD", "LEADMINI", "NICKEL"];

  it("are exactly the five, and are not offered whatever the exchange lists", () => {
    assert.deepEqual([...NOT_OFFERED_COMMODITIES].sort(), [...removed].sort());
    for (const symbol of removed) {
      assert.equal(isMcxCommodity(symbol), true, `${symbol} is still an MCX commodity - just not one we offer`);
      assert.equal(isOfferedCommodity(symbol), false, symbol);
    }
    assert.equal(isOfferedCommodity("GOLD"), true);
    assert.equal(isOfferedCommodity("COPPER"), true);
    assert.equal(isOfferedCommodity("MCXBULLDEX"), false);
  });

  it("have no name, glyph or unit of their own any more - a tile for one would read as an unknown commodity", () => {
    for (const symbol of removed) assert.equal(commodityUnit(symbol), "", symbol);
    assert.equal(commodityName("LEAD"), "Lead"); // only the fallback: the exchange's own name, tidied
    assert.equal(commodityGlyph("NICKEL"), "NI"); // the fallback glyph, not the chemical symbol
  });

  it("are in none of the app's instrument lists", () => {
    for (const symbol of removed) {
      assert.ok(!(INSTRUMENTS as readonly string[]).includes(symbol), `INSTRUMENTS has ${symbol}`);
      assert.ok(!(COMMODITY_INSTRUMENTS as readonly string[]).includes(symbol), `COMMODITY_INSTRUMENTS has ${symbol}`);
      assert.ok(!(symbol in INSTRUMENT_LABELS), `INSTRUMENT_LABELS has ${symbol}`);
      assert.ok(!(symbol in DEFAULT_LOT_SIZES), `DEFAULT_LOT_SIZES has ${symbol}`);
      assert.ok(!(symbol in STRIKE_STEPS), `STRIKE_STEPS has ${symbol}`);
      assert.ok(!(STARTING_COMMODITIES as readonly string[]).includes(symbol), `STARTING_COMMODITIES has ${symbol}`);
      assert.ok(!DEFAULT_WATCHLIST.some((item) => item.symbol === symbol), `DEFAULT_WATCHLIST has ${symbol}`);
    }
    // ...and no position family was left behind for them.
    assert.equal(INSTRUMENTS.every((i) => !["lead", "nickel"].includes(underlyingFamily(i))), true);
  });
});

