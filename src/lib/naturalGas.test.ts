/**
 * MCX natural gas in Live Portfolio and the P&L report. The fixtures are the real shapes seen from Upstox on
 * 13 Nov 2026 for a long 2-lot NATURALGAS 330 PE (20 Nov 2026 expiry): bought at 29, LTP 27, previous close 24.5,
 * delta -0.7148. A natural gas lot is 1,250 mmBtu (Mini: 250) and the premium is per mmBtu.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateBrokerage, optionsSegmentFor } from "@/lib/calculateBrokerage";
import { computePortfolioRow } from "@/lib/calculatePortfolio";
import { planPositionSync } from "@/lib/upstoxSync";
import {
  COMMODITY_INSTRUMENTS,
  DEFAULT_LOT_SIZES,
  INSTRUMENT_LABELS,
  ORDER_QUANTITY_PER_LOT,
  STRIKE_STEPS,
  isCommodityInstrument,
  sessionCloseIst,
  underlyingFamily,
  type LivePortfolioEntry,
} from "@/lib/types";
import { parseMcxInstruments } from "@/lib/upstox/mcx";
import { groupReportRows, parseScrip, reportQuantityInUnits, tradesFromGroups } from "@/lib/upstox/pnlTrades";
import type { UpstoxOptionChainResult, UpstoxPosition } from "@/lib/upstox/types";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

describe("natural gas instruments", () => {
  it("is tracked as a commodity, full size and mini", () => {
    assert.ok(COMMODITY_INSTRUMENTS.includes("NATURALGAS") && COMMODITY_INSTRUMENTS.includes("NATGASMINI"));
    assert.ok(isCommodityInstrument("NATURALGAS") && isCommodityInstrument("NATGASMINI"));
    assert.equal(INSTRUMENT_LABELS.NATURALGAS, "Natural Gas");
    assert.equal(INSTRUMENT_LABELS.NATGASMINI, "Natural Gas Mini");
  });

  it("has a 1,250 mmBtu lot (Mini 250), strikes 5 apart, and margin asked for in lots", () => {
    assert.equal(DEFAULT_LOT_SIZES.NATURALGAS, 1250);
    assert.equal(DEFAULT_LOT_SIZES.NATGASMINI, 250);
    assert.equal(STRIKE_STEPS.NATURALGAS, 5);
    assert.equal(STRIKE_STEPS.NATGASMINI, 5);
    assert.equal(ORDER_QUANTITY_PER_LOT.NATURALGAS, 1);
    assert.equal(ORDER_QUANTITY_PER_LOT.NATGASMINI, 1);
  });

  it("keeps the mini with its full-size contract, apart from crude, gold and the indices", () => {
    assert.equal(underlyingFamily("NATURALGAS"), underlyingFamily("NATGASMINI"));
    for (const other of ["CRUDEOIL", "CRUDEOILM", "GOLD", "GOLDM", "NIFTY", "BANKNIFTY", "SENSEX"] as const) {
      assert.notEqual(underlyingFamily("NATURALGAS"), underlyingFamily(other), other);
    }
  });

  it("runs into the night like the other MCX contracts (23:55 in winter), and is billed as a commodity option", () => {
    assert.equal(sessionCloseIst("NATURALGAS", "2026-11-20"), "23:55");
    assert.equal(optionsSegmentFor("NATURALGAS"), "COMMODITY_OPTIONS");
    assert.equal(optionsSegmentFor("NATGASMINI"), "COMMODITY_OPTIONS");
  });
});

describe("natural gas contracts in Upstox's MCX list", () => {
  // The shapes seen in MCX.json: lot_size and qty_multiplier agree for natural gas.
  const NOV_20_2026 = Date.parse("2026-11-20T23:59:59+05:30");
  const row = (over: Record<string, unknown>) => ({
    segment: "MCX_FO",
    instrument_type: "PE",
    underlying_symbol: "NATURALGAS",
    instrument_key: "MCX_FO|583912",
    underlying_key: "MCX_FO|574319",
    expiry: NOV_20_2026,
    strike_price: 330,
    lot_size: 1250,
    qty_multiplier: 1250,
    ...over,
  });
  const parsed = parseMcxInstruments([
    row({}),
    row({ instrument_key: "MCX_FO|590394", instrument_type: "CE", underlying_symbol: "NATGASMINI", underlying_key: "MCX_FO|581136", strike_price: 490, lot_size: 250, qty_multiplier: 250 }),
    row({ instrument_key: "MCX_FO|silver", underlying_symbol: "SILVER" }), // still not tracked
  ]);

  it("keeps natural gas and its mini, at their own lot sizes", () => {
    assert.ok(parsed);
    assert.deepEqual([...parsed.contracts.keys()].sort(), ["MCX_FO|583912", "MCX_FO|590394"]);
    assert.deepEqual(parsed.contracts.get("MCX_FO|583912"), {
      instrument: "NATURALGAS",
      strike: 330,
      optionType: "PE",
      expiry: "2026-11-20",
      lotSize: 1250,
    });
    assert.equal(parsed.contracts.get("MCX_FO|590394")?.lotSize, 250);
    assert.equal(parsed.underlyingKeys.get("NATURALGAS|2026-11-20"), "MCX_FO|574319");
  });
});

/** What /api/upstox/positions returns for the real position: quantities already reduced to units (2 lots x 1,250). */
const NATGAS_POSITION: UpstoxPosition = {
  instrumentKey: "MCX_FO|583912",
  instrument: "NATURALGAS",
  strike: 330,
  optionType: "PE",
  expiry: "2026-11-20",
  lotSize: 1250,
  quantity: 2500,
  overnightQuantity: 0,
  averagePrice: 29,
  buyQuantity: 2500,
  buyValue: 72500,
  sellQuantity: 0,
  sellValue: 0,
  dayBuyQuantity: 2500,
  dayBuyValue: 72500,
  daySellQuantity: 0,
  daySellValue: 0,
  lastPrice: 27.05,
  closePrice: 24.5,
  openedOn: null,
};

describe("syncing a natural gas position into Live Portfolio", () => {
  it("opens a 2-lot long at the price it was bought at - 2,500 mmBtu is two lots, not two thousand", () => {
    const plan = planPositionSync([], [NATGAS_POSITION], "2026-11-13");
    assert.equal(plan.inserts.length, 1);
    const { input } = plan.inserts[0];
    assert.equal(input.instrument, "NATURALGAS");
    assert.equal(input.lots, 2);
    assert.equal(input.side, "buy");
    assert.equal(input.strikePrice, 330);
    assert.equal(input.optionType, "PE");
    assert.equal(input.expiryDate, "2026-11-20");
    assert.equal(input.buyPrice, 29);
    assert.equal(input.status, "hold");
    assert.equal(input.entryDate, "2026-11-13");
  });

  it("opens a mini position in lots of 250", () => {
    const mini: UpstoxPosition = { ...NATGAS_POSITION, instrument: "NATGASMINI", lotSize: 250, quantity: 750, dayBuyQuantity: 750, buyQuantity: 750 };
    assert.equal(planPositionSync([], [mini], "2026-11-13").inserts[0].input.lots, 3);
  });
});

describe("pricing a natural gas position from the assembled chain", () => {
  const entry: LivePortfolioEntry = {
    id: "r1",
    user_id: null,
    entry_date: "2026-11-13",
    instrument: "NATURALGAS",
    strike_price: 330,
    option_type: "PE",
    expiry_date: "2026-11-20",
    closing_date: null,
    lots: 2,
    side: "buy",
    buy_price: 29,
    sell_price: 29,
    pnl: 0,
    status: "hold",
    remarks: null,
    created_at: "2026-11-13T12:00:00Z",
    updated_at: "2026-11-13T12:00:00Z",
  };
  const chain: UpstoxOptionChainResult = {
    status: "success",
    data: [
      {
        expiry: "2026-11-20",
        strike_price: 330,
        underlying_key: "MCX_FO|574319",
        underlying_spot_price: 308.3,
        put_options: {
          instrument_key: "MCX_FO|583912",
          market_data: { ltp: 27, close_price: 24.5, oi: 702, volume: 2527 },
          option_greeks: { delta: -0.7148, gamma: 0.0102, theta: -0.7919, vega: 0.1466, iv: 77.15 },
        },
      },
    ],
  };

  it("works out P&L over the 1,250 mmBtu lot, and the margin key", () => {
    const row = computePortfolioRow(entry, { "NATURALGAS|2026-11-20": chain });
    assert.equal(row.status, "ok");
    assert.equal(row.instrumentKey, "MCX_FO|583912");
    near(row.livePnl ?? NaN, (27 - 29) * 1250 * 2, 0.01); // -5,000
    assert.equal(row.underlyingSpot, 308.3);
    assert.equal(row.prevClose, 24.5);
  });

  it("estimates the exit charges at the commodity rates", () => {
    const row = computePortfolioRow(entry, { "NATURALGAS|2026-11-20": chain });
    const expected = calculateBrokerage("COMMODITY_OPTIONS", [{ buyPrice: 29, sellPrice: 27 }], 2500).totalCharges;
    near(row.brokerageIfClosed ?? NaN, expected, 0.001);
  });
});

describe("natural gas in the P&L report", () => {
  it("reads the report's name for it, full size and mini", () => {
    assert.deepEqual(parseScrip("NATURALGAS 20 Nov 2026 PE 330", "OPT"), {
      name: "NATURALGAS",
      instrument: "NATURALGAS",
      expiry: "2026-11-20",
      optionType: "PE",
      strike: 330,
    });
    assert.equal(parseScrip("NATGASMINI 20 Nov 2026 CE 310", "OPT")?.instrument, "NATGASMINI");
  });

  it("counts report quantities as lots: 2 lots is 2,500 mmBtu", () => {
    assert.equal(reportQuantityInUnits("NATURALGAS", 2), 2500);
    assert.equal(reportQuantityInUnits("NATGASMINI", 2), 500);
  });

  it("turns a closed round trip into a 2-lot trade whose P&L is Upstox's own amount", () => {
    // MCX rows: quantity in lots, amounts already include the 1,250 multiplier (29 x 1,250 = 36,250 a lot).
    const rows = [
      { quantity: 2, scrip_name: "NATURALGAS 20 Nov 2026 PE 330", trade_type: "OPT", buy_date: "13-11-2026", sell_date: "16-11-2026", buy_amount: 72500, sell_amount: 82500 },
    ];
    const { groups, otherCount, grossPnl } = groupReportRows(rows);
    const [trade] = tradesFromGroups(groups, new Map());
    assert.equal(otherCount, 0);
    assert.equal(trade.instrument, "NATURALGAS");
    assert.equal(trade.lots, 2);
    assert.equal(trade.quantity, 2500);
    assert.equal(trade.buyPrice, 29);
    assert.equal(trade.sellPrice, 33);
    assert.equal(trade.pnl, 10000);
    assert.equal(grossPnl, 10000);
    assert.equal(Math.round((trade.sellPrice - trade.buyPrice) * 1250 * trade.lots * 100) / 100, trade.pnl);
  });
});
