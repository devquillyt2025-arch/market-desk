import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MCX_CHAIN_WINDOW, parseMcxInstruments, selectStrikes, type McxStrike } from "@/lib/upstox/mcx";

// Epoch ms Upstox sends for an expiry: 23:59:59 IST on the day.
const NOV_17_2026 = Date.parse("2026-11-17T23:59:59+05:30");
const NOV_27_2026 = Date.parse("2026-11-27T23:59:59+05:30");

function option(over: Record<string, unknown>) {
  return {
    segment: "MCX_FO",
    instrument_type: "CE",
    underlying_symbol: "CRUDEOIL",
    instrument_key: "MCX_FO|1",
    underlying_key: "MCX_FO|573422",
    expiry: NOV_17_2026,
    strike_price: 7800,
    lot_size: 100,
    qty_multiplier: 100,
    ...over,
  };
}

describe("parseMcxInstruments", () => {
  const parsed = parseMcxInstruments([
    option({ instrument_key: "MCX_FO|582835", strike_price: 7800 }),
    option({ instrument_key: "MCX_FO|582985", strike_price: 7800, instrument_type: "PE" }),
    option({ instrument_key: "MCX_FO|582836", strike_price: 7850 }),
    // Gold: Upstox's lot_size is 1 but the premium is per 10 g, so a lot is worth 100 units.
    option({
      instrument_key: "MCX_FO|900",
      underlying_symbol: "GOLD",
      underlying_key: "MCX_FO|495213",
      expiry: NOV_27_2026,
      strike_price: 150000,
      lot_size: 1,
      qty_multiplier: 100,
    }),
    // None of these is a tracked option.
    option({ instrument_key: "MCX_FO|fut", instrument_type: "FUT", strike_price: 0 }),
    option({ instrument_key: "MCX_FO|silver", underlying_symbol: "SILVER" }),
    option({ instrument_key: "NSE_FO|1", segment: "NSE_FO" }),
    option({ instrument_key: "MCX_FO|nostrike", strike_price: 0 }),
  ]);

  it("keeps only the crude and gold options", () => {
    assert.ok(parsed);
    assert.deepEqual([...parsed.contracts.keys()].sort(), ["MCX_FO|582835", "MCX_FO|582836", "MCX_FO|582985", "MCX_FO|900"]);
  });

  it("reduces a row to instrument, strike, side and the IST expiry date", () => {
    assert.deepEqual(parsed?.contracts.get("MCX_FO|582985"), {
      instrument: "CRUDEOIL",
      strike: 7800,
      optionType: "PE",
      expiry: "2026-11-17",
      lotSize: 100,
    });
  });

  it("counts a lot in the units its premium is quoted in, not Upstox's lot_size", () => {
    assert.equal(parsed?.contracts.get("MCX_FO|900")?.lotSize, 100);
  });

  it("remembers the futures contract each expiry is written on", () => {
    assert.equal(parsed?.underlyingKeys.get("CRUDEOIL|2026-11-17"), "MCX_FO|573422");
    assert.equal(parsed?.underlyingKeys.get("GOLD|2026-11-27"), "MCX_FO|495213");
    assert.equal(parsed?.underlyingKeys.get("CRUDEOIL|2026-11-27"), undefined);
  });

  it("builds each expiry's strike ladder, calls and puts together", () => {
    assert.deepEqual(parsed?.ladders.get("CRUDEOIL|2026-11-17"), [
      { strike: 7800, ce: "MCX_FO|582835", pe: "MCX_FO|582985" },
      { strike: 7850, ce: "MCX_FO|582836", pe: null },
    ]);
  });

  it("lists the expiries per instrument, soonest first", () => {
    assert.deepEqual(parsed?.expiries.get("CRUDEOIL"), ["2026-11-17"]);
    assert.deepEqual(parsed?.expiries.get("GOLD"), ["2026-11-27"]);
    assert.equal(parsed?.expiries.get("GOLDM"), undefined);
  });

  it("rejects anything that isn't a list", () => {
    assert.equal(parseMcxInstruments({ data: [] }), null);
    assert.equal(parseMcxInstruments(null), null);
  });
});

describe("selectStrikes", () => {
  // 100 strikes, 7,000 to 11,950 in steps of 50.
  const ladder: McxStrike[] = Array.from({ length: 100 }, (_, i) => ({ strike: 7000 + i * 50, ce: `c${i}`, pe: `p${i}` }));

  it("takes a window of strikes each side of the money", () => {
    // 9,520 is nearest 9,500 (index 50): 30 strikes below and 30 above, plus the money itself.
    const picked = selectStrikes(ladder, 9520, []);
    assert.equal(picked.length, 2 * MCX_CHAIN_WINDOW + 1);
    assert.equal(picked[0].strike, 9500 - MCX_CHAIN_WINDOW * 50);
    assert.equal(picked[picked.length - 1].strike, 9500 + MCX_CHAIN_WINDOW * 50);
  });

  it("stops at the edge of the ladder rather than inventing strikes", () => {
    // 8,080 is nearest 8,100 (index 22): the window would start at index -8, so it starts at 0.
    const picked = selectStrikes(ladder, 8080, []);
    assert.equal(picked.length, 22 + MCX_CHAIN_WINDOW + 1);
    assert.equal(picked[0].strike, 7000);
    assert.ok(picked.some((s) => s.strike === 8100));
  });

  it("keeps the ladder in ascending order", () => {
    const strikes = selectStrikes(ladder, 9500, [7000]).map((s) => s.strike);
    assert.deepEqual(strikes, [...strikes].sort((a, b) => a - b));
  });

  it("always includes a strike that is held, however far from the money", () => {
    const picked = selectStrikes(ladder, 11000, [7000]);
    assert.ok(picked.some((s) => s.strike === 7000));
    assert.ok(!selectStrikes(ladder, 11000, []).some((s) => s.strike === 7000));
  });

  it("ignores held strikes that aren't listed", () => {
    assert.equal(selectStrikes(ladder, 9500, [1234]).length, 2 * MCX_CHAIN_WINDOW + 1);
  });

  it("falls back to the middle of the ladder when there is no spot", () => {
    const picked = selectStrikes(ladder, null, []);
    assert.ok(picked.some((s) => s.strike === ladder[50].strike));
  });

  it("returns nothing for an empty ladder", () => {
    assert.deepEqual(selectStrikes([], 8000, [7800]), []);
  });
});

describe("parseMcxInstruments - futures", () => {
  const fut = (over: Record<string, unknown>) => ({
    segment: "MCX_FO",
    instrument_type: "FUT",
    underlying_symbol: "CRUDEOIL",
    name: "CRUDE OIL",
    instrument_key: "MCX_FO|1",
    trading_symbol: "CRUDEOIL FUT 19 NOV 26",
    expiry: Date.parse("2026-11-19T23:59:59+05:30"),
    ...over,
  });

  const parsed = parseMcxInstruments(
    [
      fut({ instrument_key: "MCX_FO|dec", trading_symbol: "CRUDEOIL FUT 18 DEC 26", expiry: Date.parse("2026-12-18T23:59:59+05:30") }),
      fut({ instrument_key: "MCX_FO|nov" }),
      fut({ instrument_key: "MCX_FO|old", trading_symbol: "CRUDEOIL FUT 19 OCT 26", expiry: Date.parse("2026-10-19T23:59:59+05:30") }),
      fut({ instrument_key: "MCX_FO|gold", underlying_symbol: "GOLD", name: "GOLD", trading_symbol: "GOLD FUT 04 DEC 26", expiry: Date.parse("2026-12-04T23:59:59+05:30") }),
      fut({ instrument_key: "MCX_FO|idx", underlying_symbol: "MCXBULLDEX", name: "MCXBULLDEX" }),
      { segment: "NSE_COM", instrument_type: "FUT", underlying_symbol: "SILVER", instrument_key: "NSE_COM|1", expiry: Date.parse("2026-12-04T23:59:59+05:30") },
    ],
    "2026-11-12",
  );

  it("keeps each commodity's nearest contract that hasn't expired", () => {
    assert.equal(parsed?.futures.get("CRUDEOIL")?.key, "MCX_FO|nov");
    assert.equal(parsed?.futures.get("CRUDEOIL")?.expiry, "2026-11-19");
    assert.equal(parsed?.futures.get("CRUDEOIL")?.tradingSymbol, "CRUDEOIL FUT 19 NOV 26");
    assert.equal(parsed?.futures.get("GOLD")?.key, "MCX_FO|gold");
  });

  it("skips a month that expired before today, and futures from another exchange", () => {
    assert.ok(![...(parsed?.futures.values() ?? [])].some((f) => f.key === "MCX_FO|old"));
    assert.equal(parsed?.futures.has("SILVER"), false);
  });

  it("still counts a contract on its last day", () => {
    const onExpiry = parseMcxInstruments([fut({ instrument_key: "MCX_FO|last" })], "2026-11-19");
    assert.equal(onExpiry?.futures.get("CRUDEOIL")?.key, "MCX_FO|last");
    const after = parseMcxInstruments([fut({ instrument_key: "MCX_FO|last" })], "2026-11-20");
    assert.equal(after?.futures.has("CRUDEOIL"), false);
  });

  it("keeps the exchange's own name, shared by a commodity's mini contract", () => {
    assert.equal(parsed?.futures.get("CRUDEOIL")?.name, "CRUDE OIL");
  });
});
