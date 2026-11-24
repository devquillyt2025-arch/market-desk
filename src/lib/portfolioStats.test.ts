/** The Live Portfolio's headline figures, shared with the Dashboard: unrealised P&L, option value and today's P&L. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { computePortfolioStats } from "@/lib/portfolioStats";
import { DEFAULT_LOT_SIZES, type TradeEntry } from "@/lib/types";
import type { UpstoxPosition } from "@/lib/upstox/types";

const TODAY = "2026-11-24";
const LOT = DEFAULT_LOT_SIZES.NIFTY;

const entry = (over: Partial<TradeEntry>): TradeEntry => ({
  id: "e1", user_id: null, entry_date: "2026-11-20", instrument: "NIFTY", strike_price: 25000, option_type: "CE", expiry_date: "2026-12-30", closing_date: null,
  lots: 1, side: "sell", buy_price: 0, sell_price: 100, pnl: 0, status: "hold", remarks: null, created_at: "", updated_at: "", ...over,
});
const row = (e: TradeEntry, over: Partial<PortfolioRow>): PortfolioRow => ({ entry: e, status: "ok", livePnl: 0, liveLtp: 90, entryPrice: 100, prevClose: 95, stale: false, asOf: null, ...over }) as unknown as PortfolioRow;

const position = (over: Partial<UpstoxPosition>): UpstoxPosition => ({
  instrumentKey: "NSE_FO|1", instrument: "NIFTY", strike: 25000, optionType: "CE", expiry: "2026-12-30", lotSize: LOT, quantity: -LOT, overnightQuantity: -LOT, averagePrice: 100,
  buyQuantity: 0, buyValue: 0, sellQuantity: LOT, sellValue: 100 * LOT, dayBuyQuantity: 0, dayBuyValue: 0, daySellQuantity: 0, daySellValue: 0, lastPrice: 90, closePrice: 95, openedOn: null, ...over,
});

describe("computePortfolioStats", () => {
  it("adds the live P&L of every open row, and values the options at their live price", () => {
    const a = row(entry({ id: "a" }), { livePnl: 650, liveLtp: 90 });
    const b = row(entry({ id: "b", strike_price: 25200 }), { livePnl: -200, liveLtp: 40 });
    const stats = computePortfolioStats([a, b], null, TODAY);
    assert.equal(stats.unrealizedPnl, 450);
    assert.equal(stats.value, 90 * LOT + 40 * LOT);
  });

  it("has no option value for a book of futures only, but still counts their P&L", () => {
    const fut = row(entry({ strike_price: null, option_type: null }), { livePnl: -16612, liveLtp: 337.9 });
    const stats = computePortfolioStats([fut], null, TODAY);
    assert.equal(stats.value, null);
    assert.equal(stats.unrealizedPnl, -16612);
  });

  it("without positions from today, measures each open row from the previous close", () => {
    // Sold at 100 a few days ago, 95 at yesterday's close, 90 now: a 5-point gain on the day.
    const stats = computePortfolioStats([row(entry({}), { livePnl: 650 })], null, TODAY);
    assert.equal(stats.todayPnl, 5 * LOT);
    assert.equal(stats.bookedToday, 0);
  });

  it("measures a row opened today from its entry price instead", () => {
    const stats = computePortfolioStats([row(entry({ entry_date: TODAY }), { entryPrice: 100, liveLtp: 90 })], null, TODAY);
    assert.equal(stats.todayPnl, 10 * LOT);
  });

  it("has no figure for today when there is no price to measure against", () => {
    const stats = computePortfolioStats([row(entry({}), { liveLtp: null })], null, TODAY);
    assert.equal(stats.todayPnl, null);
  });

  it("takes today from Upstox's positions when there are some, and counts a squared-off one as booked", () => {
    const open = position({});
    // Carried in short at the 95 close, now 90: +5 a unit. The second was opened and closed today: sold 80, bought back 60.
    const closed = position({ instrumentKey: "NSE_FO|2", strike: 25200, quantity: 0, overnightQuantity: 0, averagePrice: null, dayBuyQuantity: LOT, dayBuyValue: 60 * LOT, daySellQuantity: LOT, daySellValue: 80 * LOT, lastPrice: 55 });
    const rowOpen = row(entry({}), { liveLtp: 90 });
    const stats = computePortfolioStats([rowOpen], [open, closed], TODAY);
    assert.equal(stats.bookedToday, 20 * LOT);
    assert.equal(stats.todayPnl, 5 * LOT + 20 * LOT);
  });
});
