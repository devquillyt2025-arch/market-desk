/**
 * Upstox's trade-wise P&L report read as Reports' trades. The rows are real ones from the account (20 Nov 2026): the
 * Nifty future of 17-18 Nov (named just "NIFTY", no expiry), two fills of the same crude oil trade, FINNIFTY and a stock
 * option from FY 2024-25, and an equity delivery. One row is one trade - Upstox's own count.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { reportRowsToTrades, reportRowToTrade } from "@/lib/upstox/reportTrades";
import { isReportTrade, parseStoredReport } from "@/lib/upstox/reportCache";

const NIFTY_FUT = { quantity: 130, isin: null, scrip_name: "NIFTY", trade_type: "FUT", buy_date: "18-11-2026", buy_average: 25400, sell_date: "17-11-2026", sell_average: 25575, buy_amount: 3302000, sell_amount: 3324750 };
const NIFTY_PE = { quantity: 65, isin: null, scrip_name: "NIFTY 22 Sep 2026 PE 23650", trade_type: "OPT", buy_date: "17-09-2026", buy_average: 350, sell_date: "11-09-2026", sell_average: 421.55, buy_amount: 22750, sell_amount: 27400.75 };
const CRUDE_1 = { quantity: 1, isin: null, scrip_name: "CRUDEOIL 17 Nov 2026 CE 7800", trade_type: "OPT", buy_date: "12-11-2026", buy_average: 365.4, sell_date: "12-11-2026", sell_average: 440, buy_amount: 36540, sell_amount: 44000 };
const CRUDE_2 = { ...CRUDE_1, buy_average: 365.5, buy_amount: 36550 };
const FINNIFTY = { quantity: 25, isin: "", scrip_name: "FINNIFTY 13 Aug 2024 CE 22900", trade_type: "OPT", buy_date: "09-08-2024", buy_average: 197.5, sell_date: "09-08-2024", sell_average: 189.25, buy_amount: 4937.5, sell_amount: 4731.25 };
const DIXON = { quantity: 50, isin: "INE935N01020", scrip_name: "Dixon Technologies (India) Lim 26 Dec 2024 PE 18750", trade_type: "OPT", buy_date: "16-12-2024", buy_average: 420, sell_date: "19-12-2024", sell_average: 430, buy_amount: 21000, sell_amount: 21500 };
const JINDAL = { quantity: 370, isin: "INE749A01030", scrip_name: "JINDAL STEEL", trade_type: "EQ", buy_date: "03-01-2025", buy_average: 952, sell_date: "03-01-2025", sell_average: 949.55, buy_amount: 352240, sell_amount: 351333.5 };

describe("one report row as one trade", () => {
  it("reads the Nifty future Upstox names just 'NIFTY': a short, sold on the 17th and bought back on the 18th", () => {
    const t = reportRowToTrade(NIFTY_FUT, "FO", 0)!;
    assert.equal(t.instrument, "NIFTY");
    assert.equal(t.label, "NIFTY FUT");
    assert.equal(t.strike_price, null);
    assert.equal(t.option_type, null);
    assert.equal(t.side, "sell"); // sold first
    assert.equal(t.entry_date, "2026-11-17");
    assert.equal(t.closing_date, "2026-11-18");
    assert.equal(t.pnl, 22750);
    assert.equal(t.buy_amount, 3302000);
    assert.equal(t.sell_price, 25575);
    assert.equal(t.status, "squared_off");
  });

  it("reads an option's underlying, strike, type and expiry, and a long as a buy", () => {
    const t = reportRowToTrade(NIFTY_PE, "FO", 3)!;
    // Bought on the 17th, sold on the 11th: sold first, so a short - the dates decide, not the order of the columns.
    assert.equal(t.side, "sell");
    assert.deepEqual([t.instrument, t.label, t.strike_price, t.option_type, t.expiry_date], ["NIFTY", "NIFTY 23650 PE", 23650, "PE", "2026-09-22"]);
    assert.equal(t.entry_date, "2026-09-11");
    assert.equal(t.closing_date, "2026-09-17");
    assert.equal(t.pnl, 4650.75);
    assert.equal(reportRowToTrade({ ...NIFTY_PE, buy_date: "11-09-2026", sell_date: "17-09-2026" }, "FO", 0)?.side, "buy");
  });

  it("calls a trade bought and sold on the same day 'no side' - the report doesn't give the order", () => {
    const t = reportRowToTrade(CRUDE_1, "COM", 0)!;
    assert.equal(t.side, null);
    assert.equal(t.entry_date, t.closing_date);
    assert.equal(t.pnl, 7460);
    assert.equal(t.segment, "COM");
  });

  it("keeps every underlying Upstox reports - FINNIFTY, a stock's option, equity - not just the journal's", () => {
    assert.deepEqual([reportRowToTrade(FINNIFTY, "FO", 0)!.instrument, reportRowToTrade(FINNIFTY, "FO", 0)!.label], ["FINNIFTY", "FINNIFTY 22900 CE"]);
    const dixon = reportRowToTrade(DIXON, "FO", 0)!;
    assert.deepEqual([dixon.instrument, dixon.label, dixon.strike_price, dixon.option_type], ["Dixon Technologies (India) Lim", "Dixon Technologies (India) Lim 18750 PE", 18750, "PE"]);
    const stock = reportRowToTrade(JINDAL, "EQ", 0)!;
    assert.deepEqual([stock.instrument, stock.label, stock.option_type, stock.strike_price, stock.expiry_date, stock.segment], ["JINDAL STEEL", "JINDAL STEEL", null, null, null, "EQ"]);
    assert.equal(stock.pnl, -906.5);
  });

  it("reads a stock future named with spaces, and an MCX future, as futures of their underlying", () => {
    assert.equal(reportRowToTrade({ ...NIFTY_FUT, scrip_name: "COFORGE LIMITED" }, "FO", 0)?.label, "COFORGE LIMITED FUT");
    assert.equal(reportRowToTrade({ ...NIFTY_FUT, scrip_name: "CRUDEOIL" }, "COM", 0)?.label, "CRUDEOIL FUT");
    assert.equal(reportRowToTrade({ ...NIFTY_FUT, scrip_name: "NIFTY 29 Dec 2026" }, "FO", 0)?.expiry_date, "2026-12-29");
  });

  it("leaves out a row it can't read - no quantity, or dates that aren't dates", () => {
    assert.equal(reportRowToTrade({ ...NIFTY_FUT, quantity: 0 }, "FO", 0), null);
    assert.equal(reportRowToTrade({ ...NIFTY_FUT, buy_date: "yesterday" }, "FO", 0), null);
    assert.equal(reportRowToTrade({ ...NIFTY_FUT, sell_date: null }, "FO", 0), null);
    assert.equal(reportRowToTrade({ ...NIFTY_FUT, scrip_name: undefined }, "FO", 0)?.label, "Unknown FUT");
  });
});

describe("a report as a list of trades", () => {
  it("makes one trade per row - two fills of one crude trade stay two trades, as Upstox counts them", () => {
    const trades = reportRowsToTrades([CRUDE_1, CRUDE_2, { ...CRUDE_1, quantity: 0 }], "COM");
    assert.equal(trades.length, 2);
    assert.equal(new Set(trades.map((t) => t.id)).size, 2); // identical-looking rows still get their own id
    assert.equal(trades.reduce((sum, t) => sum + t.pnl, 0), 14910);
  });

  it("keeps the report's order for trades of the same day", () => {
    const [a, b] = reportRowsToTrades([CRUDE_1, CRUDE_2], "COM");
    assert.ok(a.created_at < b.created_at);
  });
});

describe("the copy kept on the device", () => {
  const trades = reportRowsToTrades([NIFTY_FUT, JINDAL], "FO");

  it("reads back what was saved", () => {
    const saved = JSON.stringify({ fetchedAt: 1_700_000_000_000, trades });
    assert.deepEqual(parseStoredReport(saved), { fetchedAt: 1_700_000_000_000, trades });
    assert.ok(trades.every(isReportTrade));
  });

  it("ignores anything that isn't a saved report - storage can hold anything", () => {
    assert.equal(parseStoredReport(null), null);
    assert.equal(parseStoredReport(""), null);
    assert.equal(parseStoredReport("{not json"), null);
    assert.equal(parseStoredReport("42"), null);
    assert.equal(parseStoredReport(JSON.stringify({ fetchedAt: "yesterday", trades })), null);
    assert.equal(parseStoredReport(JSON.stringify({ fetchedAt: 1, trades: "no" })), null);
    // One damaged trade spoils the copy - a chart with a hole in it is worse than the loading message.
    assert.equal(parseStoredReport(JSON.stringify({ fetchedAt: 1, trades: [...trades, { ...trades[0], pnl: "n/a" }] })), null);
    assert.equal(parseStoredReport(JSON.stringify({ fetchedAt: 1, trades: [{ ...trades[0], closing_date: "18-11-2026" }] })), null);
    assert.equal(parseStoredReport(JSON.stringify({ fetchedAt: 1, trades: [{ ...trades[0], side: "short" }] })), null);
  });
});
