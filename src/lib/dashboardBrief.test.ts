/** The Dashboard's figures: sessions and their countdowns, expiries, the daily P&L bars, the account and the market's breadth. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import type { ReportTrade } from "@/lib/calculateReports";
import type { BoardEntry } from "@/lib/commodityBoard";
import { breadthOf, compactDuration, dailyBars, dayLabel, expiryLadder, exposureOf, fundsBrief, lastTrades, moversOf, paperBrief, positionLines, sessionsAt } from "@/lib/dashboardBrief";
import { DEFAULT_LOT_SIZES, type PaperTradeEntry, type Payment, type TradeEntry } from "@/lib/types";
import type { HeatmapQuote, UpstoxReportTrade } from "@/lib/upstox/types";
import type { WatchQuote } from "@/lib/watchlist";

/** An instant from its India wall-clock time (IST is UTC+5:30 all year). */
const ist = (stamp: string) => Date.parse(`${stamp}:00+05:30`);
const byId = (now: number) => Object.fromEntries(sessionsAt(now).map((s) => [s.id, s]));

describe("sessionsAt", () => {
  it("reads a Tuesday evening: India shut until tomorrow's open, MCX trading to 23:55, New York about to open", () => {
    const now = ist("2026-11-24T19:30");
    const s = byId(now);
    assert.equal(s.NSE.open, false);
    assert.equal(s.NSE.at, ist("2026-11-25T09:15"));
    assert.equal(s.NSE.clock, "09:15");
    assert.equal(s.MCX.open, true);
    assert.equal(s.MCX.clock, "23:55", "the winter close - US clocks have gone back");
    assert.equal(s.NYSE.open, false);
    assert.equal(s.NYSE.clock, "20:00", "9:30 in New York is 20:00 in India outside US summer time");
    assert.equal(s.NYSE.at - now, 30 * 60_000);
  });

  it("closes MCX at 23:30 in US summer, and opens New York an hour earlier", () => {
    const s = byId(ist("2026-06-16T19:30"));
    assert.equal(s.MCX.clock, "23:30");
    assert.equal(s.NYSE.open, true, "9:30 in New York was 19:00 in India");
    assert.equal(s.NYSE.clock, "01:30", "closes at 16:00 in New York");
  });

  it("keeps New York open across midnight in India, closing on the next India date", () => {
    // Monday 15:30 in New York is Tuesday 02:00 here, half an hour before it closes.
    const now = ist("2026-11-24T02:00");
    const s = byId(now);
    assert.equal(s.NYSE.open, true);
    assert.equal(s.NYSE.clock, "02:30");
    assert.equal(s.NYSE.at - now, 30 * 60_000);
  });

  it("opens India at 09:15 and closes it at 15:30 on a weekday", () => {
    assert.deepEqual([byId(ist("2026-11-24T09:14")).NSE.open, byId(ist("2026-11-24T09:15")).NSE.open], [false, true]);
    const open = byId(ist("2026-11-24T14:00")).NSE;
    assert.equal(open.open, true);
    assert.equal(open.clock, "15:30");
    assert.equal(byId(ist("2026-11-24T15:30")).NSE.open, false);
  });

  it("waits out the weekend: Friday's close leads to Monday's open", () => {
    const friday = byId(ist("2026-11-27T16:00"));
    assert.equal(friday.NSE.at, ist("2026-11-30T09:15"));
    assert.equal(friday.MCX.open, true, "MCX trades on to its own close on Friday");
    const saturday = byId(ist("2026-11-28T12:00"));
    assert.deepEqual([saturday.NSE.open, saturday.MCX.open], [false, false]);
    assert.equal(saturday.MCX.at, ist("2026-11-30T09:00"));
  });
});

describe("compactDuration", () => {
  it("keeps the two biggest units of a wait", () => {
    assert.equal(compactDuration(30_000), "<1m");
    assert.equal(compactDuration(42 * 60_000), "42m");
    assert.equal(compactDuration((3 * 60 + 12) * 60_000), "3h 12m");
    assert.equal(compactDuration((2 * 24 + 4) * 3_600_000 + 5 * 60_000), "2d 4h");
    assert.equal(compactDuration(-5), "<1m");
  });
});

describe("expiryLadder", () => {
  const held = (instrument: TradeEntry["instrument"], expiry_date: string | null, lots: number) => ({ instrument, expiry_date, lots });
  const now = ist("2026-11-24T19:30");

  it("lists the nearest expiries first, adding up what expires on each date", () => {
    const ladder = expiryLadder([held("NIFTY", "2026-12-29", 1), held("NIFTY", "2026-12-08", 2), held("NIFTY", "2026-12-29", 2), held("NIFTY", null, 5)], now);
    assert.deepEqual(ladder, [
      { date: "2026-12-08", days: 14, lots: 2, positions: 1 },
      { date: "2026-12-29", days: 35, lots: 3, positions: 2 },
    ]);
  });

  it("counts an MCX contract expiring tonight but not an index option whose session has ended", () => {
    const ladder = expiryLadder([held("NIFTY", "2026-11-24", 1), held("NATURALGAS", "2026-11-24", 3)], now);
    assert.deepEqual(ladder, [{ date: "2026-11-24", days: 0, lots: 3, positions: 1 }]);
  });

  it("gives no more than the limit", () => {
    const dates = ["2026-12-01", "2026-12-08", "2026-12-15", "2026-12-22"];
    assert.equal(expiryLadder(dates.map((d) => held("NIFTY", d, 1)), now, 2).length, 2);
  });
});

const report = (id: string, closing: string, pnl: number, created = ""): UpstoxReportTrade =>
  ({ id, segment: "FO", instrument: "NIFTY", label: `NIFTY ${id}`, strike_price: null, option_type: null, expiry_date: null, entry_date: closing, closing_date: closing, side: null, quantity: 1, buy_price: 0, sell_price: 0, buy_amount: 0, sell_amount: 0, pnl, status: "squared_off", created_at: created }) as UpstoxReportTrade;

describe("dailyBars", () => {
  const trade = (closing: string, pnl: number): ReportTrade => report(`t${closing}${pnl}`, closing, pnl);

  it("gives one slot per weekday, oldest first, adding up what closed on each day", () => {
    // Wed 18 Nov to Tue 24 Nov, weekend left out.
    const bars = dailyBars([trade("2026-11-20", 100), trade("2026-11-20", -30), trade("2026-11-23", -400)], "2026-11-24", 7);
    assert.deepEqual(bars, [
      { date: "2026-11-18", pnl: null },
      { date: "2026-11-19", pnl: null },
      { date: "2026-11-20", pnl: 70 },
      { date: "2026-11-23", pnl: -400 },
      { date: "2026-11-24", pnl: null },
    ]);
  });
});

describe("lastTrades", () => {
  it("is the most recently closed first, and no more than asked", () => {
    const trades = [report("a", "2026-11-18", 10), report("b", "2026-11-23", -20), report("c", "2026-11-20", 30)];
    assert.deepEqual(lastTrades(trades, 2).map((t) => [t.label, t.date, t.pnl]), [["NIFTY b", "2026-11-23", -20], ["NIFTY c", "2026-11-20", 30]]);
  });
});

describe("fundsBrief", () => {
  const pay = (type: Payment["type"], amount: number, status: Payment["status"]): Payment => ({ id: `${type}${amount}`, user_id: null, entry_date: "2026-10-01", details: "", type, initial_fund: 0, profit: 0, payout_amount: amount, status, created_at: "", updated_at: "" });
  const trade = (pnl: number): ReportTrade => report(`t${pnl}`, "2026-11-10", pnl);

  it("counts only money that has moved as capital, and adds the closed trades to get equity", () => {
    const funds = fundsBrief([trade(30_000), trade(-10_000)], [pay("payin", 500_000, "paid"), pay("payin", 100_000, "pending"), pay("payout", 20_000, "paid")]);
    assert.ok(funds);
    assert.equal(funds.capital, 480_000);
    assert.equal(funds.equity, 500_000);
    assert.equal(funds.returnPct, 4.17);
    assert.equal(funds.paidOut, 20_000);
    assert.equal(funds.pending, 1);
  });

  it("has nothing to say about an empty ledger", () => {
    assert.equal(fundsBrief([trade(500)], []), null);
  });
});

describe("paperBrief", () => {
  const paper = (status: PaperTradeEntry["status"], pnl: number) => ({ status, pnl }) as PaperTradeEntry;
  it("counts open trades apart from closed ones, and books only what closed", () => {
    const brief = paperBrief([paper("hold", 9_999), paper("hold", 1), paper("squared_off", 500), paper("squared_off", -200), paper("squared_off", 100)]);
    assert.deepEqual([brief.open, brief.closed, brief.pnl], [2, 3, 400]);
    assert.ok(brief.winRatePct !== null && Math.abs(brief.winRatePct - 66.6667) < 0.001);
  });
  it("has no win rate before anything closes", () => {
    assert.equal(paperBrief([paper("hold", 0)]).winRatePct, null);
    assert.equal(paperBrief([]).open, 0);
  });
});

describe("breadthOf", () => {
  const q = (symbol: string, changePct: number | null): HeatmapQuote => ({ symbol, price: 100, changePct });

  it("counts the stocks up, down and flat, and names the movers biggest first", () => {
    const breadth = breadthOf([q("A", 2), q("B", 1), q("C", 0), q("D", -1), q("E", -3), q("F", null)]);
    assert.ok(breadth);
    assert.deepEqual([breadth.up, breadth.down, breadth.flat, breadth.total], [2, 2, 1, 5]);
    assert.deepEqual(breadth.leaders.map((x) => x.symbol), ["A", "B"]);
    assert.deepEqual(breadth.laggards.map((x) => x.symbol), ["E", "D"]);
  });

  it("is nothing until a stock has a move", () => {
    assert.equal(breadthOf(null), null);
    assert.equal(breadthOf([q("A", null)]), null);
  });
});

describe("positionLines", () => {
  const row = (id: string, livePnl: number | null) => ({ entry: { id, instrument: "NIFTY", strike_price: 25000, option_type: "CE", expiry_date: "2026-12-29", side: "sell", lots: 2 }, livePnl, entryPrice: 100, liveLtp: livePnl === null ? null : 90 }) as unknown as PortfolioRow;

  it("puts the biggest gain or loss first and the unpriced last", () => {
    const lines = positionLines([row("a", 500), row("b", -1200), row("c", null), row("d", 300)]);
    assert.deepEqual(lines.map((l) => l.id), ["b", "a", "d", "c"]);
    assert.deepEqual([lines[0].label, lines[0].side, lines[0].lots], ["NIFTY 25000 CE", "sell", 2]);
  });

  it("carries the entry price and the live one, which is missing while the position is unpriced", () => {
    const [priced, unpriced] = positionLines([row("a", 500), row("b", null)]);
    assert.deepEqual([priced.entry, priced.live], [100, 90]);
    assert.deepEqual([unpriced.entry, unpriced.live], [100, null]);
  });
});

describe("exposureOf", () => {
  const lot = DEFAULT_LOT_SIZES.NATURALGAS;
  const row = (over: Record<string, unknown>) => ({ entry: { instrument: "NATURALGAS", lots: 3 }, underlyingSpot: null, liveLtp: null, ...over }) as unknown as PortfolioRow;

  it("is lots x lot size x price: the future's own price, or the underlying an option is written on", () => {
    assert.equal(exposureOf([row({ liveLtp: 338.4 })]), 3 * lot * 338.4);
    assert.equal(exposureOf([row({ underlyingSpot: 340, liveLtp: 12 })]), 3 * lot * 340);
  });

  it("counts longs and shorts alike, skips what has no price, and is nothing for an empty book", () => {
    const long = row({ liveLtp: 300, entry: { instrument: "NATURALGAS", lots: 1, side: "buy" } });
    const short = row({ liveLtp: 300, entry: { instrument: "NATURALGAS", lots: 1, side: "sell" } });
    assert.equal(exposureOf([long, short, row({})]), 2 * lot * 300);
    assert.equal(exposureOf([]), 0);
  });
});

describe("moversOf", () => {
  const quote = (changePct: number | null): WatchQuote => ({ price: 100, prevClose: 100, change: changePct, changePct, open: null, high: null, low: null, volume: null, contract: null });
  const board = (pairs: [BoardEntry["symbol"], number | null][]): BoardEntry[] => pairs.map(([symbol, pct]) => ({ symbol, quote: pct === null ? undefined : quote(pct) }));
  const entries = board([["GOLD", 1.2], ["SILVER", 4.5], ["CRUDEOIL", -1.8], ["NATURALGAS", -4.7], ["COPPER", 0], ["ZINC", null], ["ALUMINI", 2.1]]);

  it("lists the biggest risers and the biggest fallers, each biggest first", () => {
    const { up, down } = moversOf(entries, 2);
    assert.deepEqual(up.map((e) => e.symbol), ["SILVER", "ALUMINI"]);
    assert.deepEqual(down.map((e) => e.symbol), ["NATURALGAS", "CRUDEOIL"]);
  });

  it("leaves out a flat move and an unquoted contract, and gives fewer when there are fewer", () => {
    const { up, down } = moversOf(board([["GOLD", 0], ["ZINC", null], ["SILVER", 1]]), 3);
    assert.deepEqual(up.map((e) => e.symbol), ["SILVER"]);
    assert.deepEqual(down, []);
  });
});

describe("dayLabel", () => {
  it("writes a day the short way", () => {
    assert.equal(dayLabel("2026-12-28"), "28 Dec");
    assert.equal(dayLabel("not a date"), "");
  });
});
