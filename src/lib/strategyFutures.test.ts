/**
 * An index future in the Analysis tab: importing one from Live Portfolio, saving it, and valuing it beside options.
 * The fixture is the real position: short 2 lots of the NIFTY Dec 2026 future (130 units), sold at 25,575 on
 * 17 Nov 2026 with the index at 25,380 and the future last at 25,556.6 - 176.6 points above the index.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  analyzeStrategy,
  chartDomain,
  expiryCloseMs,
  legGreeks,
  priceLegs,
  strategyGreeks,
  strategyPnl,
  type StrategyLeg,
} from "@/lib/calculateStrategy";
import { loadSavedAnalysis, saveAnalysis } from "@/lib/savedAnalysis";
import { atmIvOfRows, futureBasisOf, spotOfRows } from "@/lib/strategyFutures";
import { buildStrategyExport, isImportableEntry, parseStrategyImport, tradeEntryToLeg } from "@/lib/strategyTransfer";
import type { TradeEntry } from "@/lib/types";
import type { UpstoxOptionChainStrike } from "@/lib/upstox/types";

const LOT = 65;
const NOW = Date.parse("2026-11-17T17:00:00+05:30");
const SPOT = 25380;
const FUT_EXPIRY = "2026-12-29";
const BASIS = 25556.6 - SPOT; // 176.6

function futureLeg(over: Partial<StrategyLeg> = {}): StrategyLeg {
  return { id: "f", enabled: true, side: "sell", type: "FUT", strike: 0, expiry: FUT_EXPIRY, lots: 2, price: 25575, chainIv: 12, basis: BASIS, ...over };
}
function callLeg(over: Partial<StrategyLeg> = {}): StrategyLeg {
  return { id: "c", enabled: true, side: "buy", type: "CE", strike: 25400, expiry: FUT_EXPIRY, lots: 2, price: 450, chainIv: 12, ...over };
}
const priced = (legs: StrategyLeg[]) => priceLegs(legs, SPOT, NOW, LOT, "NIFTY");
const close = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} is not within ${tol} of ${b}`);

function entry(over: Partial<TradeEntry>): TradeEntry {
  return {
    id: "r1",
    user_id: null,
    entry_date: "2026-11-17",
    instrument: "NIFTY",
    strike_price: null,
    option_type: null,
    expiry_date: FUT_EXPIRY,
    closing_date: null,
    lots: 2,
    side: "sell",
    buy_price: 25575,
    sell_price: 25575,
    pnl: 0,
    status: "hold",
    remarks: null,
    created_at: "2026-11-17T09:30:00Z",
    updated_at: "2026-11-17T09:30:00Z",
    ...over,
  };
}

describe("what a future reads from its expiry's chain", () => {
  const rows = [
    { strike_price: 25300, underlying_spot_price: SPOT, call_options: { option_greeks: { iv: 14 } }, put_options: { option_greeks: { iv: 16 } } },
    { strike_price: 25400, underlying_spot_price: SPOT, call_options: { option_greeks: { iv: 11 } }, put_options: { option_greeks: { iv: 13 } } },
    { strike_price: 25500, underlying_spot_price: SPOT, call_options: { option_greeks: { iv: 20 } }, put_options: { option_greeks: { iv: 22 } } },
  ] as unknown as UpstoxOptionChainStrike[];

  it("takes the index level from any row, and the at-the-money IV from the strike nearest it", () => {
    assert.equal(spotOfRows(rows), SPOT);
    assert.equal(atmIvOfRows(rows, SPOT), 12); // 25,400 is nearest: (11 + 13) / 2
    assert.equal(spotOfRows(undefined), null);
    assert.equal(atmIvOfRows(undefined, SPOT), null);
    assert.equal(atmIvOfRows(rows, null), null);
  });

  it("measures the gap to the index as the future's price less the level, and gives none when either is missing", () => {
    close(futureBasisOf(25556.6, SPOT)!, BASIS);
    assert.equal(futureBasisOf(null, SPOT), null);
    assert.equal(futureBasisOf(25556.6, null), null);
    assert.equal(futureBasisOf(0, SPOT), null);
  });
});

describe("importing a future into Analysis", () => {
  it("offers an open index future, with no strike or CE/PE, as a leg of its own kind", () => {
    assert.equal(isImportableEntry(entry({})), true);
    assert.deepEqual(tradeEntryToLeg(entry({}), "entry"), {
      enabled: true,
      side: "sell",
      type: "FUT",
      strike: 0,
      expiry: FUT_EXPIRY,
      lots: 2,
      price: "25575",
    });
    assert.equal(tradeEntryToLeg(entry({}), "live")?.price, ""); // filled from the future's own quote
  });

  it("still leaves out a squared-off future, a row with no expiry, and a strike without its CE/PE", () => {
    assert.equal(isImportableEntry(entry({ status: "squared_off", closing_date: "2026-11-17" })), false);
    assert.equal(isImportableEntry(entry({ expiry_date: null })), false);
    assert.equal(isImportableEntry(entry({ strike_price: 25400 })), false);
  });

  it("does not take a commodity row with no strike for a future - only the three indices have them", () => {
    assert.equal(isImportableEntry(entry({ instrument: "NATURALGAS" })), false);
  });

  it("keeps an option's import as it was", () => {
    const leg = tradeEntryToLeg(entry({ strike_price: 25400, option_type: "PE", expiry_date: "2026-11-23", side: "buy", buy_price: 358.5 }), "entry");
    assert.deepEqual(leg, { enabled: true, side: "buy", type: "PE", strike: 25400, expiry: "2026-11-23", lots: 2, price: "358.5" });
  });

  it("brings a future in from a trade-entries export alongside the options of the same index", () => {
    const put = entry({ id: "p", strike_price: 25400, option_type: "PE", expiry_date: "2026-11-23" });
    const parsed = parseStrategyImport([entry({}), put]);
    assert.equal(parsed.instrument, "NIFTY");
    assert.deepEqual(parsed.legs.map((l) => l.type).sort(), ["FUT", "PE"]);
    assert.equal(parsed.skipped, 0);
  });

  it("writes a strategy file with a future in it and reads it back", () => {
    const draft = { id: "a", enabled: true, side: "sell" as const, type: "FUT" as const, strike: 0, expiry: FUT_EXPIRY, lots: 2, price: "25575" };
    const parsed = parseStrategyImport(JSON.parse(JSON.stringify(buildStrategyExport("NIFTY", [draft]))));
    assert.deepEqual(parsed.legs, [{ enabled: true, side: "sell", type: "FUT", strike: 0, expiry: FUT_EXPIRY, lots: 2, price: "25575" }]);
  });

  it("refuses a file whose future carries a strike", () => {
    const file = { format: "marketdesk-strategy", version: 1, instrument: "NIFTY", legs: [{ side: "sell", type: "FUT", strike: 25400, expiry: FUT_EXPIRY, lots: 1, price: 25575 }] };
    assert.throws(() => parseStrategyImport(file), /future, which has no strike/);
  });
});

describe("the saved strategy with a future in it", () => {
  const realStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  function stubStorage() {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    });
  }
  afterEach(() => {
    if (realStorage) Object.defineProperty(globalThis, "localStorage", realStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("survives a reload - the future isn't dropped for having no strike", () => {
    stubStorage();
    const legs = [
      { id: "f", enabled: true, side: "sell" as const, type: "FUT" as const, strike: 0, expiry: FUT_EXPIRY, lots: 2, price: "25575" },
      { id: "c", enabled: true, side: "buy" as const, type: "CE" as const, strike: 25400, expiry: FUT_EXPIRY, lots: 2, price: "450" },
    ];
    saveAnalysis({ instrument: "NIFTY", legs, spotOverride: "" });
    assert.deepEqual(loadSavedAnalysis()?.legs, legs);
  });

  it("still drops an option saved without a strike, and a future saved with one", () => {
    stubStorage();
    const bad = [
      { id: "a", enabled: true, side: "buy" as const, type: "CE" as const, strike: 0, expiry: FUT_EXPIRY, lots: 1, price: "1" },
      { id: "b", enabled: true, side: "sell" as const, type: "FUT" as const, strike: 25400, expiry: FUT_EXPIRY, lots: 1, price: "1" },
    ];
    saveAnalysis({ instrument: "NIFTY", legs: bad, spotOverride: "" });
    assert.deepEqual(loadSavedAnalysis()?.legs, []);
  });
});

describe("valuing a future in a strategy", () => {
  it("leaves a future out until its gap to the index is known", () => {
    assert.equal(priced([futureLeg({ basis: null })]).length, 0);
    assert.equal(priced([futureLeg({ basis: undefined })]).length, 0);
    assert.equal(priced([futureLeg()]).length, 1);
  });

  it("agrees with the position's own P&L today: sold at 25,575, last 25,556.6, 2 lots - up 18.4 points a unit", () => {
    const legs = priced([futureLeg()]);
    close(strategyPnl(legs, SPOT, NOW), (25575 - 25556.6) * 2 * LOT, 0.5); // +2,392 - the Live Portfolio's figure
    // The index 100 points higher costs a short 100 points a unit.
    close(strategyPnl(legs, SPOT + 100, NOW) - strategyPnl(legs, SPOT, NOW), -100 * 2 * LOT, 0.01);
  });

  it("runs the gap down to nothing by expiry, so with the index unmoved the short has kept the whole of it", () => {
    const legs = priced([futureLeg()]);
    const expiry = expiryCloseMs(FUT_EXPIRY, "NIFTY");
    close(strategyPnl(legs, SPOT, expiry), (25575 - SPOT) * 2 * LOT, 0.01); // priced as the index itself
    // Half way there, half of it.
    const half = NOW + (expiry - NOW) / 2;
    close(strategyPnl(legs, SPOT, half), (25575 - (SPOT + BASIS / 2)) * 2 * LOT, 0.01);
    // And it never swings past either end.
    close(strategyPnl(legs, SPOT, expiry + 86_400_000), strategyPnl(legs, SPOT, expiry), 0.01);
    close(strategyPnl(legs, SPOT, NOW - 86_400_000), strategyPnl(legs, SPOT, NOW), 0.01);
  });

  it("is a straight line in the index: a long future gains what a short loses", () => {
    const long = priced([futureLeg({ side: "buy" })]);
    const short = priced([futureLeg()]);
    for (const s of [24000, SPOT, 27000]) close(strategyPnl(long, s, NOW), -strategyPnl(short, s, NOW), 0.01);
  });

  it("has a delta of the units held and no gamma, theta or vega", () => {
    const [leg] = priced([futureLeg()]);
    const g = legGreeks(leg, SPOT, NOW);
    close(g.delta, -2 * LOT, 1e-9);
    // A short leg's zero is -0 (zero times -1); only its size matters.
    assert.equal(Math.abs(g.gamma), 0);
    assert.equal(Math.abs(g.theta), 0);
    assert.equal(Math.abs(g.vega), 0);
  });
});

describe("a strategy with a future in it", () => {
  const expiryMs = expiryCloseMs(FUT_EXPIRY, "NIFTY");

  it("is unlimited on the upside for a short future, and has no premium to pay or collect", () => {
    const metrics = analyzeStrategy(priced([futureLeg()]), SPOT, NOW)!;
    assert.equal(metrics.maxLoss, null); // the index can rise without limit
    assert.notEqual(metrics.maxProfit, null);
    assert.equal(metrics.netPremium, 0); // 2 lots sold at 25,575 is not ₹33 lakh "received"
    assert.equal(metrics.expiryMs, expiryMs);
  });

  it("breaks even where the index reaches the price it was sold at, once the gap has closed", () => {
    const metrics = analyzeStrategy(priced([futureLeg()]), SPOT, NOW)!;
    assert.equal(metrics.breakevens.length, 1);
    close(metrics.breakevens[0], 25575, 2);
  });

  it("gives the odds of profit from the at-the-money IV of its expiry: a bit better than even for a short sold above the index", () => {
    const metrics = analyzeStrategy(priced([futureLeg()]), SPOT, NOW)!;
    assert.ok(metrics.pop !== null && metrics.pop > 0.5 && metrics.pop < 0.8, `pop ${metrics.pop}`);
    assert.ok(metrics.sdPct > 0); // there is a spread of outcomes to draw, from the IV
  });

  it("caps the loss when the short is hedged with as many bought calls", () => {
    const metrics = analyzeStrategy(priced([futureLeg(), callLeg()]), SPOT, NOW)!;
    assert.notEqual(metrics.maxLoss, null);
    assert.ok(metrics.maxLoss! > 0);
    // Only the call's premium moves the totals: 2 lots at 450.
    close(metrics.netPremium, -450 * 2 * LOT, 0.01);
  });

  it("takes a bought call alone as a call still (a future leg must not change how options count)", () => {
    const metrics = analyzeStrategy(priced([callLeg()]), SPOT, NOW)!;
    assert.equal(metrics.maxProfit, null);
    assert.notEqual(metrics.maxLoss, null);
  });

  it("nets the future's delta against the hedge's, and keeps the future out of the chart's strike range", () => {
    const legs = priced([futureLeg(), callLeg()]);
    const net = strategyGreeks(legs, SPOT, NOW);
    assert.ok(net.delta > -2 * LOT && net.delta < 0, `net delta ${net.delta}`); // the call gives back part of the short's -130
    const [lo, hi] = chartDomain(legs, SPOT, 0.05);
    assert.ok(lo > SPOT * 0.5 && hi > SPOT, `domain ${lo}..${hi}`); // a "strike" of 0 hasn't dragged it to the floor
  });

  it("still analyses a strategy of options alone exactly as before", () => {
    const put: StrategyLeg = { id: "p", enabled: true, side: "sell", type: "PE", strike: 25400, expiry: "2026-11-23", lots: 2, price: 405, chainIv: 12 };
    const metrics = analyzeStrategy(priced([put]), SPOT, NOW)!;
    assert.notEqual(metrics.maxProfit, null);
    assert.equal(metrics.maxLoss !== null, true); // a short put's loss is bounded by the strike
    close(metrics.netPremium, 405 * 2 * LOT, 0.01);
  });
});
