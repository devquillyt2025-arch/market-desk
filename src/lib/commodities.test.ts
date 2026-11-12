/**
 * MCX crude oil and gold in Live Portfolio. The fixtures are the real shapes seen from Upstox on
 * 12 Nov 2026 for a long 2-lot CRUDEOIL 7800 CE (17 Nov expiry): bought at 365.45, LTP 359.8,
 * previous close 456.2, delta 0.73.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateBrokerage, optionsSegmentFor } from "@/lib/calculateBrokerage";
import { computePortfolioRow } from "@/lib/calculatePortfolio";
import { yearsToExpiry } from "@/lib/calculateRisk";
import { expiryCloseMs, upcomingWeeklyExpiries } from "@/lib/calculateStrategy";
import { isMarketOpen } from "@/lib/averaging";
import { planPositionSync } from "@/lib/upstoxSync";
import {
  COMMODITY_INSTRUMENTS,
  DEFAULT_LOT_SIZES,
  INDEX_INSTRUMENTS,
  INSTRUMENTS,
  ORDER_QUANTITY_PER_LOT,
  STRIKE_STEPS,
  isCommodityInstrument,
  isIndexInstrument,
  sessionCloseIst,
  underlyingFamily,
  type LivePortfolioEntry,
} from "@/lib/types";
import type { UpstoxOptionChainResult, UpstoxPosition } from "@/lib/upstox/types";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

describe("instrument tables", () => {
  it("lists every instrument once, indices first", () => {
    assert.deepEqual([...INSTRUMENTS], [...INDEX_INSTRUMENTS, ...COMMODITY_INSTRUMENTS]);
    assert.equal(new Set(INSTRUMENTS).size, INSTRUMENTS.length);
  });

  it("has a lot size, order quantity and strike step for each", () => {
    for (const i of INSTRUMENTS) {
      assert.ok(DEFAULT_LOT_SIZES[i] > 0, i);
      assert.ok(ORDER_QUANTITY_PER_LOT[i] > 0, i);
      assert.ok(STRIKE_STEPS[i] > 0, i);
    }
  });

  it("values a ₹1 move at 100 units a lot for crude and gold, 10 for the minis", () => {
    assert.deepEqual(
      [DEFAULT_LOT_SIZES.CRUDEOIL, DEFAULT_LOT_SIZES.CRUDEOILM, DEFAULT_LOT_SIZES.GOLD, DEFAULT_LOT_SIZES.GOLDM],
      [100, 10, 100, 10],
    );
  });

  it("asks margin for MCX in lots but for the indices in units", () => {
    assert.equal(ORDER_QUANTITY_PER_LOT.CRUDEOIL, 1);
    assert.equal(ORDER_QUANTITY_PER_LOT.GOLDM, 1);
    assert.equal(ORDER_QUANTITY_PER_LOT.NIFTY, DEFAULT_LOT_SIZES.NIFTY);
  });

  it("tells commodities from indices, and groups the minis with their full-size contract", () => {
    assert.ok(isCommodityInstrument("GOLD") && !isCommodityInstrument("NIFTY"));
    assert.ok(isIndexInstrument("SENSEX") && !isIndexInstrument("CRUDEOILM"));
    assert.equal(underlyingFamily("CRUDEOIL"), underlyingFamily("CRUDEOILM"));
    assert.equal(underlyingFamily("GOLD"), underlyingFamily("GOLDM"));
    assert.notEqual(underlyingFamily("CRUDEOIL"), underlyingFamily("GOLD"));
    assert.notEqual(underlyingFamily("NIFTY"), underlyingFamily("GOLD"));
    assert.equal(underlyingFamily("BANKNIFTY"), underlyingFamily("NIFTY"));
  });
});

describe("session close", () => {
  it("is 15:30 for the indices and 23:30 for MCX", () => {
    assert.equal(sessionCloseIst("NIFTY"), "15:30");
    assert.equal(sessionCloseIst(), "15:30");
    assert.equal(sessionCloseIst("CRUDEOIL"), "23:30");
    assert.equal(expiryCloseMs("2026-11-17"), Date.parse("2026-11-17T15:30:00+05:30"));
    assert.equal(expiryCloseMs("2026-11-17", "CRUDEOIL"), Date.parse("2026-11-17T23:30:00+05:30"));
  });

  it("keeps a crude option alive through the evening of its expiry day", () => {
    const evening = new Date("2026-11-17T20:00:00+05:30");
    assert.equal(yearsToExpiry("2026-11-17", evening, "NIFTY"), 0);
    near(yearsToExpiry("2026-11-17", evening, "CRUDEOIL") * 365 * 24, 3.5, 1e-9);
  });

  it("has MCX open 09:00 to 23:30, weekdays", () => {
    const at = (t: string) => Date.parse(`2026-11-12T${t}:00+05:30`); // a Thursday
    assert.equal(isMarketOpen(at("20:00"), "CRUDEOIL"), true);
    assert.equal(isMarketOpen(at("20:00"), "NIFTY"), false);
    assert.equal(isMarketOpen(at("09:00"), "GOLD"), true);
    assert.equal(isMarketOpen(at("08:59"), "GOLD"), false);
    assert.equal(isMarketOpen(at("23:30"), "GOLD"), false);
    assert.equal(isMarketOpen(Date.parse("2026-11-14T12:00:00+05:30"), "CRUDEOIL"), false); // Saturday
  });

  it("has no weekly expiry pattern to guess for a commodity", () => {
    assert.deepEqual(upcomingWeeklyExpiries("2026-11-12", "CRUDEOIL", Date.parse("2026-11-12T12:00:00+05:30")), []);
    assert.equal(upcomingWeeklyExpiries("2026-11-12", "NIFTY", Date.parse("2026-11-12T12:00:00+05:30")).length, 8);
  });
});

describe("commodity options charges", () => {
  it("bills commodity options under their own segment", () => {
    assert.equal(optionsSegmentFor("CRUDEOIL"), "COMMODITY_OPTIONS");
    assert.equal(optionsSegmentFor("GOLDM"), "COMMODITY_OPTIONS");
    assert.equal(optionsSegmentFor("NIFTY"), "OPTIONS");
  });

  it("charges CTT of 0.05% on the sell side only, and MCX's 0.0418% exchange fee on both", () => {
    // Buy 200 units at 365.45 (₹73,090), sell at 400 (₹80,000).
    const c = calculateBrokerage("COMMODITY_OPTIONS", [{ buyPrice: 365.45, sellPrice: 400 }], 200);
    near(c.netBuyValue, 73090, 0.01);
    near(c.netSellValue, 80000, 0.01);
    near(c.stt, 80000 * 0.0005, 0.01);
    near(c.transactionCharges, (73090 + 80000) * 0.000418, 0.01);
    near(c.stampDuty, 73090 * 0.00003, 0.01);
    near(c.brokerage, 40, 0.01); // ₹20 a side
  });

  it("charges less tax on a crude option than the same trade priced as an index option", () => {
    const leg = [{ buyPrice: 365.45, sellPrice: 400 }];
    const crude = calculateBrokerage("COMMODITY_OPTIONS", leg, 200);
    const index = calculateBrokerage("OPTIONS", leg, 200);
    near(index.stt, crude.stt * 2, 0.02);
    assert.ok(crude.totalCharges < index.totalCharges);
  });
});

/** What /api/upstox/positions returns for the real position: quantities already reduced to units. */
const CRUDE_POSITION: UpstoxPosition = {
  instrumentKey: "MCX_FO|582835",
  instrument: "CRUDEOIL",
  strike: 7800,
  optionType: "CE",
  expiry: "2026-11-17",
  lotSize: 100,
  quantity: 200,
  overnightQuantity: 0,
  averagePrice: 365.45,
  buyQuantity: 200,
  buyValue: 73090,
  sellQuantity: 0,
  sellValue: 0,
  dayBuyQuantity: 200,
  dayBuyValue: 73090,
  daySellQuantity: 0,
  daySellValue: 0,
  lastPrice: 359.5,
  closePrice: 456.2,
  openedOn: null,
};

describe("syncing a crude position into Live Portfolio", () => {
  it("opens a 2-lot long at the price it was bought at", () => {
    const plan = planPositionSync([], [CRUDE_POSITION], "2026-11-12");
    assert.equal(plan.inserts.length, 1);
    const { input } = plan.inserts[0];
    assert.equal(input.instrument, "CRUDEOIL");
    assert.equal(input.lots, 2);
    assert.equal(input.side, "buy");
    assert.equal(input.strikePrice, 7800);
    assert.equal(input.optionType, "CE");
    assert.equal(input.expiryDate, "2026-11-17");
    assert.equal(input.buyPrice, 365.45);
    assert.equal(input.status, "hold");
    assert.equal(input.entryDate, "2026-11-12");
  });

  it("leaves the row alone on the next poll, and squares it off once the position is gone", () => {
    const first = planPositionSync([], [CRUDE_POSITION], "2026-11-12").inserts[0].input;
    const row: LivePortfolioEntry = {
      id: "r1",
      user_id: null,
      entry_date: first.entryDate,
      instrument: first.instrument,
      strike_price: first.strikePrice ?? null,
      option_type: first.optionType ?? null,
      expiry_date: first.expiryDate ?? null,
      closing_date: null,
      lots: first.lots,
      side: first.side,
      buy_price: first.buyPrice,
      sell_price: first.sellPrice,
      pnl: 0,
      status: "hold",
      remarks: null,
      created_at: "2026-11-12T12:00:00Z",
      updated_at: "2026-11-12T12:00:00Z",
    };
    const again = planPositionSync([row], [CRUDE_POSITION], "2026-11-12");
    assert.deepEqual([again.inserts.length, again.updates.length, again.closes.length], [0, 0, 0]);
    const gone = planPositionSync([row], [], "2026-11-13");
    assert.equal(gone.closes.length, 1);
  });
});

describe("pricing a crude position from the assembled chain", () => {
  const entry: LivePortfolioEntry = {
    id: "r1",
    user_id: null,
    entry_date: "2026-11-12",
    instrument: "CRUDEOIL",
    strike_price: 7800,
    option_type: "CE",
    expiry_date: "2026-11-17",
    closing_date: null,
    lots: 2,
    side: "buy",
    buy_price: 365.45,
    sell_price: 365.45,
    pnl: 0,
    status: "hold",
    remarks: null,
    created_at: "2026-11-12T12:00:00Z",
    updated_at: "2026-11-12T12:00:00Z",
  };
  const chain: UpstoxOptionChainResult = {
    status: "success",
    data: [
      {
        expiry: "2026-11-17",
        strike_price: 7800,
        underlying_key: "MCX_FO|573422",
        underlying_spot_price: 8080,
        call_options: {
          instrument_key: "MCX_FO|582835",
          market_data: { ltp: 359.8, close_price: 456.2, oi: 439, volume: 5339 },
          option_greeks: { delta: 0.7296, gamma: 0.0007, theta: -15.4552, vega: 3.2054, iv: 50.6 },
        },
      },
    ],
  };

  it("works out P&L over the 100-unit lot, and the margin key", () => {
    const row = computePortfolioRow(entry, { "CRUDEOIL|2026-11-17": chain });
    assert.equal(row.status, "ok");
    assert.equal(row.instrumentKey, "MCX_FO|582835");
    near(row.livePnl ?? NaN, (359.8 - 365.45) * 100 * 2, 0.01); // -1,130
    assert.equal(row.underlyingSpot, 8080);
    assert.equal(row.prevClose, 456.2);
  });

  it("estimates the exit charges at the commodity rates", () => {
    const row = computePortfolioRow(entry, { "CRUDEOIL|2026-11-17": chain });
    const expected = calculateBrokerage("COMMODITY_OPTIONS", [{ buyPrice: 365.45, sellPrice: 359.8 }], 200).totalCharges;
    near(row.brokerageIfClosed ?? NaN, expected, 0.001);
  });

  it("reports a strike the chain window doesn't hold as unmatched, not as a price", () => {
    const row = computePortfolioRow({ ...entry, strike_price: 9000 }, { "CRUDEOIL|2026-11-17": chain });
    assert.equal(row.status, "no_match");
  });
});
