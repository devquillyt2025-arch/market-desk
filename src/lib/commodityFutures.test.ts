/**
 * An MCX commodity future held in Live Portfolio: found under its own instrument key for any listed month, charged at MCX's
 * rates rather than the index futures', and priced by the same route as an index future.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateBrokerage, derivativeSegmentFor, futuresSegmentFor, optionsSegmentFor } from "@/lib/calculateBrokerage";
import { closedPositionCharges } from "@/lib/calculatePortfolio";
import { simulateFuture } from "@/lib/futureSimulator";
import { COMMODITY_INSTRUMENTS, INDEX_INSTRUMENTS } from "@/lib/types";
import { mcxFutureKey, parseMcxInstruments } from "@/lib/upstox/mcx";
import type { UpstoxPosition } from "@/lib/upstox/types";

const near = (actual: number, expected: number, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const at = (iso: string) => Date.parse(`${iso}T23:59:59+05:30`);

describe("which charges a future is billed under", () => {
  it("bills an index future at the index futures rates and a commodity future at MCX's", () => {
    for (const index of INDEX_INSTRUMENTS) assert.equal(futuresSegmentFor(index), "FUTURES", index);
    for (const commodity of COMMODITY_INSTRUMENTS) assert.equal(futuresSegmentFor(commodity), "COMMODITY_FUTURES", commodity);
  });

  it("picks between a future's segment and an option's from the one flag", () => {
    assert.equal(derivativeSegmentFor("NIFTY", true), "FUTURES");
    assert.equal(derivativeSegmentFor("NIFTY", false), optionsSegmentFor("NIFTY"));
    assert.equal(derivativeSegmentFor("GOLD", true), "COMMODITY_FUTURES");
    assert.equal(derivativeSegmentFor("GOLD", false), "COMMODITY_OPTIONS");
  });
});

describe("MCX commodity-futures charges", () => {
  // One lot of Crude Oil (100 bbl), bought at 6,000 and sold at 6,050: ₹6,00,000 in, ₹6,05,000 out.
  const crude = calculateBrokerage("COMMODITY_FUTURES", [{ buyPrice: 6000, sellPrice: 6050 }], 100);

  it("charges CTT on the sell side only, at 0.01%", () => {
    near(crude.stt, 605000 * 0.0001);
  });

  it("charges MCX's transaction charge on both sides, and stamp duty on the buy", () => {
    near(crude.transactionCharges, (600000 + 605000) * 0.000021);
    near(crude.stampDuty, 600000 * 0.00002);
  });

  it("caps brokerage at ₹20 an order, so a lot this size pays the flat fee both ways", () => {
    near(crude.brokerage, 40);
  });

  it("is far cheaper in tax than the same trade billed as an index future (0.05% STT, NSE charge)", () => {
    const asIndex = calculateBrokerage("FUTURES", [{ buyPrice: 6000, sellPrice: 6050 }], 100);
    assert.ok(asIndex.stt > crude.stt * 4, `index STT ${asIndex.stt} vs CTT ${crude.stt}`);
    assert.ok(asIndex.totalCharges > crude.totalCharges);
  });

  it("has the lines add up to the total, like every other segment", () => {
    const { brokerage, stt, transactionCharges, clearingCharges, dpCharges, stampDuty, sebiCharges, gst } = crude;
    near(crude.totalCharges, brokerage + stt + transactionCharges + clearingCharges + dpCharges + stampDuty + sebiCharges + gst, 0.011);
  });

  it("is not affected by the April 2026 index STT hike when charging an older trade", () => {
    const before = calculateBrokerage("COMMODITY_FUTURES", [{ buyPrice: 6000, sellPrice: 6050 }], 100, "2026-03-31");
    assert.equal(before.stt, crude.stt);
  });
});

describe("a closed commodity future", () => {
  // 100 units (one 1 kg lot, quoted per 10 g) bought at 150,000 and sold at 151,000, so flat.
  const closedGold: UpstoxPosition = {
    instrumentKey: "MCX_FO|477041",
    instrument: "GOLD",
    strike: null,
    optionType: null,
    expiry: "2026-12-04",
    lotSize: 100,
    quantity: 0,
    overnightQuantity: 0,
    averagePrice: null,
    buyQuantity: 100,
    buyValue: 15_000_000,
    sellQuantity: 100,
    sellValue: 15_100_000,
    dayBuyQuantity: 100,
    dayBuyValue: 15_000_000,
    daySellQuantity: 100,
    daySellValue: 15_100_000,
    lastPrice: 151000,
    closePrice: 150000,
    openedOn: null,
  };

  it("is billed at MCX's futures rates, not the index futures'", () => {
    const charges = closedPositionCharges(closedGold);
    assert.ok(charges);
    near(charges.totalCharges, calculateBrokerage("COMMODITY_FUTURES", [{ buyPrice: 150000, sellPrice: 151000 }], 100).totalCharges);
    near(charges.stt, 15_100_000 * 0.0001); // CTT, 0.01% of what was sold
  });
});

describe("simulating a commodity future", () => {
  const position = { side: "buy" as const, lots: 1, lotSize: 100, avgPrice: 6000, livePrice: 6050 };

  it("charges the order at MCX's rates when it knows the commodity", () => {
    const sim = simulateFuture({ ...position, instrument: "CRUDEOIL" }, { kind: "exit", lots: 1, price: 6050 });
    near(sim.charges, calculateBrokerage("COMMODITY_FUTURES", [{ buyPrice: 0, sellPrice: 6050 }], 100).totalCharges);
  });

  it("keeps the index futures' rates when no instrument is given", () => {
    const sim = simulateFuture(position, { kind: "exit", lots: 1, price: 6050 });
    near(sim.charges, calculateBrokerage("FUTURES", [{ buyPrice: 0, sellPrice: 6050 }], 100).totalCharges);
  });
});

describe("finding a commodity future's instrument key", () => {
  const future = (key: string, symbol: string, expiry: string) => ({
    segment: "MCX_FO",
    instrument_type: "FUT",
    underlying_symbol: symbol,
    name: symbol,
    instrument_key: key,
    trading_symbol: `${symbol} FUT`,
    expiry: at(expiry),
    lot_size: 1,
    qty_multiplier: 100,
  });
  const parsed = parseMcxInstruments(
    [
      future("MCX_FO|nov", "CRUDEOIL", "2026-11-19"),
      future("MCX_FO|dec", "CRUDEOIL", "2026-12-18"),
      future("MCX_FO|gold", "GOLD", "2026-12-04"),
      // An option on the same expiry as a future must never be mistaken for it.
      { segment: "MCX_FO", instrument_type: "CE", underlying_symbol: "CRUDEOIL", instrument_key: "MCX_FO|opt", underlying_key: "MCX_FO|nov", expiry: at("2026-12-18"), strike_price: 6000, lot_size: 100, qty_multiplier: 100 },
    ],
    "2026-11-10",
  );

  it("finds a month that is not the nearest - a position can be in a later one", () => {
    assert.ok(parsed);
    assert.equal(mcxFutureKey(parsed.contracts, "CRUDEOIL", "2026-11-19"), "MCX_FO|nov");
    assert.equal(mcxFutureKey(parsed.contracts, "CRUDEOIL", "2026-12-18"), "MCX_FO|dec");
    assert.equal(parsed.futures.get("CRUDEOIL")?.key, "MCX_FO|nov", "the nearest-month map is unchanged");
  });

  it("keeps commodities apart and finds nothing for a month that isn't listed", () => {
    assert.ok(parsed);
    assert.equal(mcxFutureKey(parsed.contracts, "GOLD", "2026-12-04"), "MCX_FO|gold");
    assert.equal(mcxFutureKey(parsed.contracts, "GOLD", "2026-12-18"), null);
    assert.equal(mcxFutureKey(parsed.contracts, "SILVER", "2026-12-04"), null);
    assert.equal(mcxFutureKey(parsed.contracts, "CRUDEOIL", "2026-01-01"), null);
  });

  it("does not hand back an option's key for a future", () => {
    assert.ok(parsed);
    assert.notEqual(mcxFutureKey(parsed.contracts, "CRUDEOIL", "2026-12-18"), "MCX_FO|opt");
  });
});
