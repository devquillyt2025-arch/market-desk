/**
 * Reports' time frame and the maths behind its sections. The figures are the real ones from the account on 20 Nov 2026
 * (checked against Upstox's own report that day): two BANKNIFTY trades opened on 12 Oct and closed on 27 Oct (-14,955 and
 * +23,992.50) sit inside "last 30 days" by when they closed, and outside it by when they were opened - and Upstox's report
 * files a trade under the day it closed.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildReportCsv,
  computePnlByDayOfWeek,
  computePnlByInstrument,
  computePnlByMonth,
  computePnlBySide,
  filterEntriesByClosingRange,
  filterEntriesByRange,
  rangeBounds,
  reportWindow,
  summarizeEntries,
  summarizeTrades,
  tradeDay,
} from "@/lib/calculateReports";
import { localIsoDate } from "@/lib/localDate";
import type { TradeEntry } from "@/lib/types";
import type { UpstoxReportTrade } from "@/lib/upstox/types";

function entry(over: Partial<TradeEntry>): TradeEntry {
  return {
    id: "e",
    user_id: null,
    entry_date: "2026-11-11",
    instrument: "NIFTY",
    strike_price: 25650,
    option_type: "PE",
    expiry_date: "2026-11-17",
    closing_date: "2026-11-11",
    lots: 3,
    side: "buy",
    buy_price: 100,
    sell_price: 110,
    pnl: 1950,
    status: "squared_off",
    remarks: null,
    created_at: "2026-11-11T10:00:00Z",
    updated_at: "2026-11-11T10:00:00Z",
    ...over,
  };
}

/** A device clock, at local noon on that day - away from midnight, so the day it is can't be argued. */
const clock = (isoDay: string) => new Date(`${isoDay}T12:00:00`);
const TODAY = clock("2026-11-20");

const HELD_LONG = [
  entry({ id: "a", entry_date: "2026-10-12", closing_date: "2026-10-27", pnl: -14955, instrument: "BANKNIFTY" }),
  entry({ id: "b", entry_date: "2026-10-12", closing_date: "2026-10-27", pnl: 23992.5, instrument: "BANKNIFTY" }),
];

describe("the day a range's dates are worked out on", () => {
  it("is the device's own calendar day, not UTC's", () => {
    // 2:00 am in India on the 20th is still the 19th in UTC - toISOString() would start every window a day early.
    const earlyMorning = new Date("2026-11-20T02:00:00");
    assert.equal(localIsoDate(0, earlyMorning), "2026-11-20");
    assert.equal(localIsoDate(7, earlyMorning), "2026-11-13");
    assert.equal(localIsoDate(30, earlyMorning), "2026-10-21");
  });

  it("gives the same window to the cumulative chart's closing-date filter", () => {
    const earlyMorning = new Date("2026-11-20T02:00:00");
    const trades = [entry({ id: "x", closing_date: "2026-11-13" }), entry({ id: "y", closing_date: "2026-11-12" })];
    assert.deepEqual(filterEntriesByClosingRange(trades, "7d", earlyMorning).map((e) => e.id), ["x"]);
  });

  it("reads each range as inclusive bounds, open on the sides it has none", () => {
    assert.deepEqual(rangeBounds("30d", undefined, TODAY), { from: "2026-10-21", to: null });
    assert.deepEqual(rangeBounds("all", undefined, TODAY), { from: null, to: null });
    assert.deepEqual(rangeBounds("custom", { from: "2026-11-01", to: "" }, TODAY), { from: "2026-11-01", to: null });
    assert.deepEqual(rangeBounds("custom", { from: "", to: "" }, TODAY), { from: null, to: null });
  });
});

describe("Performance's range filter", () => {
  it("counts a trade on the day it closed - a position held across the window's start is in it", () => {
    assert.equal(tradeDay(HELD_LONG[0]), "2026-10-27");
    assert.deepEqual(filterEntriesByRange(HELD_LONG, "30d", undefined, TODAY).map((e) => e.id), ["a", "b"]); // opened before the 21st, closed after
    assert.deepEqual(filterEntriesByRange(HELD_LONG, "7d", undefined, TODAY), []);
  });

  it("falls back to the day it was opened for a position that hasn't closed", () => {
    const open = entry({ id: "h", entry_date: "2026-11-19", closing_date: null, status: "hold", pnl: 0 });
    assert.equal(tradeDay(open), "2026-11-19");
    assert.deepEqual(filterEntriesByRange([open], "7d", undefined, TODAY).map((e) => e.id), ["h"]);
  });

  it("applies a custom range to the close date on both ends, and an empty one to everything", () => {
    const trades = [entry({ id: "a", closing_date: "2026-11-05" }), entry({ id: "b", closing_date: "2026-11-12" })];
    assert.deepEqual(filterEntriesByRange(trades, "custom", { from: "2026-11-06", to: "2026-11-15" }, TODAY).map((e) => e.id), ["b"]);
    assert.deepEqual(filterEntriesByRange(trades, "custom", { from: "", to: "2026-11-10" }, TODAY).map((e) => e.id), ["a"]);
    assert.equal(filterEntriesByRange(trades, "custom", { from: "", to: "" }, TODAY).length, 2);
    assert.equal(filterEntriesByRange(trades, "all", undefined, TODAY).length, 2);
  });
});


describe("the window Upstox's charges are asked for", () => {
  it("is the same window the trades are cut to, up to today", () => {
    assert.deepEqual(reportWindow("7d", undefined, TODAY), { from: "2026-11-13", to: "2026-11-20" });
    assert.deepEqual(reportWindow("30d", undefined, TODAY), { from: "2026-10-21", to: "2026-11-20" });
    assert.deepEqual(reportWindow("custom", { from: "2026-11-01", to: "2026-11-10" }, TODAY), { from: "2026-11-01", to: "2026-11-10" });
  });

  it("reaches back to the financial year two before this one for 'All' or an open custom start, as far as the report is read", () => {
    assert.deepEqual(reportWindow("all", undefined, TODAY), { from: "2024-04-01", to: "2026-11-20" });
    assert.deepEqual(reportWindow("custom", { from: "", to: "" }, TODAY), { from: "2024-04-01", to: "2026-11-20" });
    // Before April the financial year is still the one that began last year.
    assert.equal(reportWindow("all", undefined, clock("2027-02-10")).from, "2024-04-01");
    assert.equal(reportWindow("all", undefined, clock("2027-04-10")).from, "2025-04-01");
  });

  it("never runs a custom end past today", () => {
    assert.equal(reportWindow("custom", { from: "2026-11-01", to: "2026-12-31" }, TODAY).to, "2026-11-20");
  });
});

/** Rows of the account's real Upstox report, read as trades (see reportTrades.test.ts): a FINNIFTY option from 2024, an equity trade, the Nifty future of 17-18 Nov, and crude fills. */
function upstoxTrade(over: Partial<UpstoxReportTrade>): UpstoxReportTrade {
  return {
    id: "t",
    segment: "FO",
    instrument: "NIFTY",
    label: "NIFTY 25400 PE",
    strike_price: 25400,
    option_type: "PE",
    expiry_date: "2026-11-24",
    entry_date: "2026-11-13",
    closing_date: "2026-11-13",
    side: null,
    quantity: 65,
    buy_price: 100,
    sell_price: 110,
    buy_amount: 6500,
    sell_amount: 7150,
    pnl: 650,
    status: "squared_off",
    created_at: "2026-11-13#000000",
    ...over,
  };
}

const FUTURE = upstoxTrade({ id: "f", label: "NIFTY FUT", strike_price: null, option_type: null, entry_date: "2026-11-17", closing_date: "2026-11-18", side: "sell", quantity: 130, buy_amount: 3302000, sell_amount: 3324750, pnl: 22750, created_at: "2026-11-18#000001" });
const FINNIFTY = upstoxTrade({ id: "x", instrument: "FINNIFTY", label: "FINNIFTY 22900 CE", strike_price: 22900, option_type: "CE", entry_date: "2024-08-09", closing_date: "2024-08-09", pnl: -206.25, buy_amount: 4937.5, sell_amount: 4731.25, created_at: "2024-08-09#000002" });
const STOCK = upstoxTrade({ id: "s", segment: "EQ", instrument: "JINDAL STEEL", label: "JINDAL STEEL", strike_price: null, option_type: null, expiry_date: null, entry_date: "2025-01-03", closing_date: "2025-01-03", pnl: -906.5, buy_amount: 352240, sell_amount: 351333.5, created_at: "2025-01-03#000003" });
const CRUDE_FILL = upstoxTrade({ id: "c", segment: "COM", instrument: "CRUDEOIL", label: "CRUDEOIL 7800 CE", strike_price: 7800, option_type: "CE", entry_date: "2026-11-12", closing_date: "2026-11-12", pnl: 7460, buy_amount: 36540, sell_amount: 44000, created_at: "2026-11-12#000004" });

describe("Reports from Upstox's own rows", () => {
  it("counts every row as a trade, with the charges Upstox gave instead of an estimate", () => {
    const secondFill = upstoxTrade({ id: "c2", segment: "COM", instrument: "CRUDEOIL", pnl: 7450, closing_date: "2026-11-12", entry_date: "2026-11-12", created_at: "2026-11-12#000005" });
    const s = summarizeTrades([FUTURE, CRUDE_FILL, secondFill], 541.76);
    assert.equal(s.totalTrades, 3); // the two crude fills are two trades, as Upstox's report counts them
    assert.equal(s.winCount, 3);
    assert.equal(s.totalPnl, 22750 + 7460 + 7450);
    assert.equal(s.totalCharges, 541.76);
    assert.equal(s.netPnl, 22750 + 7460 + 7450 - 541.76);
    assert.equal(s.grossProfit, 37660);
    assert.equal(s.grossLoss, 0);
    assert.equal(s.profitFactor, null);
    assert.equal(s.squaredOffCount, 3);
  });

  it("splits winners and losers into the sums the Upstox card shows", () => {
    const s = summarizeTrades([FUTURE, FINNIFTY, STOCK], 0);
    assert.equal(s.winCount, 1);
    assert.equal(s.lossCount, 2);
    assert.equal(s.grossProfit, 22750);
    assert.equal(s.grossLoss, -1112.75);
    assert.equal(s.profitFactor, 20.44); // 22,750 / 1,112.75
    assert.equal(s.bestTrade?.label, "NIFTY FUT"); // an Upstox row names its own contract
    assert.equal(s.worstTrade?.label, "JINDAL STEEL");
  });

  it("keeps the journal page's own estimate of charges, per entry", () => {
    const s = summarizeEntries([entry({})]);
    assert.ok(s.totalCharges > 0);
    assert.equal(s.netPnl, Math.round((s.totalPnl - s.totalCharges) * 100) / 100);
  });

  it("orders streaks and drawdown by when P&L was realised, not when a position opened", () => {
    const heldLong = upstoxTrade({ id: "h", entry_date: "2026-10-01", closing_date: "2026-11-18", pnl: -500, created_at: "2026-11-18#000009" });
    const quick = upstoxTrade({ id: "q", entry_date: "2026-11-10", closing_date: "2026-11-10", pnl: 300, created_at: "2026-11-10#000009" });
    const s = summarizeTrades([heldLong, quick], 0);
    // By opening date the long hold came first and the streak would be a win; by closing it is the last thing that happened.
    assert.deepEqual(s.currentStreak, { type: "loss", count: 1 });
    assert.equal(s.maxDrawdown, 500); // up to +300, then down to -200
  });

  it("shows every underlying, the journal's own first and the rest by name", () => {
    const bars = computePnlByInstrument([FINNIFTY, STOCK, FUTURE, CRUDE_FILL, upstoxTrade({ id: "b", instrument: "BANKNIFTY", pnl: 100 })]);
    assert.equal(bars.length, 5);
    // The tracked ones come first, in their usual order; the others follow alphabetically.
    assert.deepEqual(bars.slice(-2).map((b) => b.label), ["FINNIFTY", "JINDAL STEEL"]);
    assert.equal(bars.reduce((sum, b) => Math.round((sum + b.pnl) * 100) / 100, 0), 22750 + 7460 - 206.25 - 906.5 + 100);
  });

  it("calls a trade opened and closed the same day 'Same day' - the report doesn't say which leg came first", () => {
    const bars = computePnlBySide([FUTURE, upstoxTrade({ side: "buy", pnl: 50 }), upstoxTrade({ side: null, pnl: 20 }), upstoxTrade({ side: null, pnl: 30 })]);
    assert.deepEqual(bars.map((b) => [b.label, b.pnl]), [["Buy", 50], ["Sell", 22750], ["Same day", 50]]);
  });

  it("buckets months and weekdays by the day a trade closed", () => {
    const held = upstoxTrade({ entry_date: "2026-10-12", closing_date: "2026-11-02", pnl: 1000 }); // opened in October, closed Monday 2 Nov
    assert.deepEqual(computePnlByMonth([held]).map((b) => b.label), [new Date(2026, 10, 1).toLocaleDateString("en-IN", { month: "short", year: "2-digit" })]);
    assert.deepEqual(computePnlByDayOfWeek([held]).map((b) => b.label), ["Mon"]);
  });

  it("writes Upstox's rows as a CSV, oldest close first, with a trade whose order is unknown as 'Same day'", () => {
    const csv = buildReportCsv([FUTURE, FINNIFTY]).split("\r\n");
    assert.equal(csv[0], "Closed,Opened,Segment,Underlying,Contract,Strike,Type,Expiry,Side,Quantity,Buy Avg,Sell Avg,Buy Value,Sell Value,P&L");
    assert.equal(csv.length, 3);
    assert.ok(csv[1].startsWith("2024-08-09,2024-08-09,FO,FINNIFTY,FINNIFTY 22900 CE,22900,CE,2026-11-24,Same day,"));
    assert.ok(csv[2].startsWith("2026-11-18,2026-11-17,FO,NIFTY,NIFTY FUT,,,2026-11-24,Sell,130,"));
    // A name with a comma or a quote is escaped rather than breaking the row.
    assert.ok(buildReportCsv([upstoxTrade({ label: 'A, "B"' })]).includes('"A, ""B"""'));
  });
});
