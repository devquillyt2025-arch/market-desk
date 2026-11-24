/**
 * An MCX commodity future held in Live Portfolio: found under its own instrument key for any listed month, charged at MCX's
 * rates rather than the index futures', and priced by the same route as an index future.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateBrokerage, derivativeSegmentFor, futuresSegmentFor, optionsSegmentFor } from "@/lib/calculateBrokerage";
import { closedPositionCharges, computePortfolioRow, futureGroupKey, portfolioGroupKey, type FutureQuotes } from "@/lib/calculatePortfolio";
import { futureBasis, toLeg } from "@/lib/calculateRisk";
import { simulateFuture } from "@/lib/futureSimulator";
import { COMMODITY_INSTRUMENTS, INDEX_INSTRUMENTS, type TradeEntry } from "@/lib/types";
import { mcxChainExpiry, mcxFutureKey, parseMcxInstruments } from "@/lib/upstox/mcx";
import type { UpstoxOptionChainResult, UpstoxPosition } from "@/lib/upstox/types";
import { buildBook, buildUnderlyings } from "@/lib/whatIf";

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

// --- The natural gas future the user holds: NATURALGAS FUT 28 Dec 26. Its options end on 23 Dec, five days before it does, so
// --- asking for "the chain of 28 Dec" found nothing and Risk, Probability, Simulate and What-if had no volatility to work from.

describe("which option chain stands in for a future's expiry", () => {
  const optionRow = (key: string, underlyingKey: string, symbol: string, expiry: string, strike: number) => ({
    segment: "MCX_FO", instrument_type: "CE", underlying_symbol: symbol, instrument_key: key, underlying_key: underlyingKey, expiry: at(expiry), strike_price: strike, lot_size: 1250, qty_multiplier: 1250,
  });
  const futureRow = (key: string, symbol: string, expiry: string) => ({
    segment: "MCX_FO", instrument_type: "FUT", underlying_symbol: symbol, instrument_key: key, expiry: at(expiry), lot_size: 1250, qty_multiplier: 1250, trading_symbol: `${symbol} FUT ${expiry}`,
  });
  // The shape of Upstox's file on 24 Nov 2026: natural gas options end on 23 Dec (on the Dec future) and 21 Jan (on the Jan one); gold lists
  // two serial months on the same Feb future, nearer first.
  const parsed = parseMcxInstruments(
    [
      futureRow("MCX_FO|578249", "NATURALGAS", "2026-12-28"),
      futureRow("MCX_FO|581135", "NATURALGAS", "2027-01-25"),
      futureRow("MCX_FO|583829", "NATURALGAS", "2027-02-23"),
      optionRow("MCX_FO|c1", "MCX_FO|578249", "NATURALGAS", "2026-12-23", 300),
      optionRow("MCX_FO|c2", "MCX_FO|581135", "NATURALGAS", "2027-01-21", 300),
      futureRow("MCX_FO|559933", "GOLD", "2027-02-05"),
      optionRow("MCX_FO|g1", "MCX_FO|559933", "GOLD", "2027-01-29", 150000),
      optionRow("MCX_FO|g0", "MCX_FO|559933", "GOLD", "2026-12-31", 150000),
    ],
    "2026-11-24",
  );

  it("is the options' own expiry when that is what was asked for", () => {
    assert.ok(parsed);
    assert.equal(mcxChainExpiry(parsed, "NATURALGAS", "2026-12-23"), "2026-12-23");
  });

  it("is the expiry of the options written on the future, when its own date is asked for", () => {
    assert.ok(parsed);
    assert.equal(mcxChainExpiry(parsed, "NATURALGAS", "2026-12-28"), "2026-12-23");
    assert.equal(mcxChainExpiry(parsed, "NATURALGAS", "2027-01-25"), "2027-01-21");
  });

  it("takes the nearer of two option expiries written on the same future", () => {
    assert.ok(parsed);
    assert.equal(mcxChainExpiry(parsed, "GOLD", "2027-02-05"), "2026-12-31");
  });

  it("is nothing for a future with no options listed, or a date that isn't a contract", () => {
    assert.ok(parsed);
    assert.equal(mcxChainExpiry(parsed, "NATURALGAS", "2027-02-23"), null, "the Feb future has no options yet");
    assert.equal(mcxChainExpiry(parsed, "NATURALGAS", "2026-12-29"), null);
    assert.equal(mcxChainExpiry(parsed, "CRUDEOIL", "2026-12-28"), null, "another commodity's date is not this one's");
  });
});

describe("a commodity future in the risk models", () => {
  const FUT_EXPIRY = "2026-12-28";
  const OPT_EXPIRY = "2026-12-23";
  const NOW = Date.parse("2026-11-24T10:00:00Z");

  const entry: TradeEntry = {
    id: "ng1", user_id: null, entry_date: "2026-11-20", instrument: "NATURALGAS", strike_price: null, option_type: null, expiry_date: FUT_EXPIRY,
    closing_date: null, lots: 1, side: "buy", buy_price: 300, sell_price: 0, pnl: 0, status: "hold", remarks: null, created_at: "", updated_at: "",
  };
  // The future trades at 302.0; the chain's own reading of that same future, taken a moment apart, is 301.9.
  const quotes: FutureQuotes = { [futureGroupKey("NATURALGAS", FUT_EXPIRY)]: { instrumentKey: "MCX_FO|578249", ltp: 302, prevClose: 298, oi: 1000, volume: 500 } };
  const leg = (key: string) => ({
    instrument_key: key,
    market_data: { ltp: 9, oi: 100, volume: 10 },
    option_greeks: { iv: 62, delta: 0.5, gamma: 0.01, theta: -0.2, vega: 0.3 },
  });
  const chain: UpstoxOptionChainResult = {
    status: "success",
    data: [300, 305].map((strike) => ({ expiry: OPT_EXPIRY, strike_price: strike, underlying_key: "MCX_FO|578249", underlying_spot_price: 301.9, call_options: leg(`c${strike}`), put_options: leg(`p${strike}`) })),
  };
  const chains = { [portfolioGroupKey("NATURALGAS", FUT_EXPIRY)]: chain };

  it("is measured against its own price: the options are written on it, so there is no gap to an index", () => {
    const row = computePortfolioRow(entry, chains, undefined, quotes);
    assert.equal(row.status, "ok");
    assert.equal(row.underlyingSpot, 302, "its own quote, not the chain's reading a poll apart");
    assert.equal(futureBasis(row), 0);
  });

  it("takes its volatility from the options written on it", () => {
    const row = computePortfolioRow(entry, chains, undefined, quotes);
    assert.equal(row.nearbyIv, 62);
  });

  it("gets a risk leg - the one thing Risk, Probability, Simulate, What-if and Reward:Risk all start from", () => {
    const row = computePortfolioRow(entry, chains, undefined, quotes);
    const modelled = toLeg(row, new Date(NOW), "2026-11-24");
    assert.ok(modelled?.isFuture, "no leg: the tabs would be empty");
    assert.equal(modelled?.premium, 300, "breakeven is the entry price: nothing to subtract");
    assert.equal(modelled?.qty, 1250);
    const book = buildBook([row], NOW);
    assert.equal(book.legs.length, 1);
    assert.equal(book.skipped, 0);
    assert.equal(book.legs[0].basis, 0);
  });

  it("has no volatility, and so no leg, while the chain hasn't loaded - as before", () => {
    const row = computePortfolioRow(entry, {}, undefined, quotes);
    assert.equal(row.status, "ok");
    assert.equal(row.nearbyIv, null);
    assert.equal(toLeg(row, new Date(NOW), "2026-11-24"), null);
  });

  it("still measures an index future against the index, with the chain's level", () => {
    const nifty: TradeEntry = { ...entry, instrument: "NIFTY", expiry_date: "2026-12-29" };
    const niftyQuotes: FutureQuotes = { [futureGroupKey("NIFTY", "2026-12-29")]: { instrumentKey: "NSE_FO|58875", ltp: 25556.6, prevClose: 25450, oi: 1, volume: 1 } };
    const niftyChain: UpstoxOptionChainResult = { status: "success", data: [{ expiry: "2026-12-29", strike_price: 25400, underlying_spot_price: 25387.4, call_options: leg("c"), put_options: leg("p") }] };
    const row = computePortfolioRow(nifty, { [portfolioGroupKey("NIFTY", "2026-12-29")]: niftyChain }, undefined, niftyQuotes);
    assert.equal(row.underlyingSpot, 25387.4);
    assert.ok(Math.abs((futureBasis(row) ?? NaN) - 169.2) < 1e-6);
  });

  it("prices the options a what-if offers to the date they end on, not the future's later one", () => {
    const [under] = buildUnderlyings(chains, NOW);
    assert.equal(under.key, `NATURALGAS|${FUT_EXPIRY}`, "the key stays the future's so its leg finds the underlying");
    assert.equal(under.expiry, OPT_EXPIRY);
    assert.equal(under.dte, 29, "24 Nov -> 23 Dec, not 34 days to 28 Dec");
  });
});
