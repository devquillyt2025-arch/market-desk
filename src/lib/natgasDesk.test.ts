/**
 * The natural gas desk's rules: the graded gap label, the price ages, a typed-in NYMEX price, NYMEX's hours in IST, and the
 * P&L of the natural gas positions at the expected open. The market fixtures follow Friday 13 / Saturday 14 Nov 2026
 * (see expectedOpen.test.ts): MCX last traded at 307.9, NYMEX Dec 26 went from 3.255 to 3.236.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { normCdf, yearsToExpiry } from "@/lib/calculateRisk";
import type { ExpectedOpenItem } from "@/lib/expectedOpen";
import {
  ageText,
  CLEAR_GAP_FROM_PCT,
  dayBars,
  deskFigures,
  gapSignal,
  istStamp,
  NO_GAP_BELOW_PCT,
  nymexOutlook,
  nymexState,
  parseNymexInput,
  positionsAtOpen,
  sessionHours,
  tabPreview,
  TYPICAL_MISS_PCT,
  windowRows,
} from "@/lib/natgasDesk";
import { DEFAULT_LOT_SIZES, type TradeEntry } from "@/lib/types";

const at = (iso: string) => Date.parse(iso);
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

describe("gapSignal", () => {
  it("calls a move inside the estimate's own noise no clear gap", () => {
    for (const move of [0, 0.1, -0.19, NO_GAP_BELOW_PCT - 0.001, Number.NaN]) {
      const signal = gapSignal(move);
      assert.equal(signal.strength, "none");
      assert.equal(signal.direction, "flat");
      assert.equal(signal.headline, "No clear gap");
    }
  });

  it("leans up or down for a small gap", () => {
    assert.deepEqual([gapSignal(0.2).strength, gapSignal(0.2).direction, gapSignal(0.2).headline], ["lean", "up", "Leaning up"]);
    assert.deepEqual([gapSignal(-0.35).strength, gapSignal(-0.35).direction, gapSignal(-0.35).headline], ["lean", "down", "Leaning down"]);
    assert.equal(gapSignal(CLEAR_GAP_FROM_PCT - 0.001).strength, "lean");
  });

  it("is a clear gap from half a percent, either way", () => {
    assert.deepEqual([gapSignal(0.5).strength, gapSignal(0.5).headline], ["clear", "Clear gap up"]);
    assert.deepEqual([gapSignal(-1.2).strength, gapSignal(-1.2).headline], ["clear", "Clear gap down"]);
  });

  it("says it in plain words: which way NYMEX has moved, by how much, and what that means for MCX", () => {
    assert.equal(gapSignal(0.1).detail, "NYMEX has barely moved since MCX closed, so MCX should open close to where it closed.");
    assert.equal(gapSignal(0.36).detail, "NYMEX is up 0.36% since MCX closed, so MCX may open a little higher. A flat open is still possible.");
    assert.equal(gapSignal(-0.35).detail, "NYMEX is down 0.35% since MCX closed, so MCX may open a little lower. A flat open is still possible.");
    assert.equal(gapSignal(3.145).detail, "NYMEX is up 3.15% since MCX closed, so MCX is likely to open higher.");
    assert.equal(gapSignal(-0.9).detail, "NYMEX is down 0.90% since MCX closed, so MCX is likely to open lower.");
  });
});

describe("ageText and istStamp", () => {
  it("counts the way a person would", () => {
    assert.equal(ageText(-5), "just now");
    assert.equal(ageText(59_000), "just now");
    assert.equal(ageText(90_000), "1 min");
    assert.equal(ageText(23 * 60_000), "23 min");
    assert.equal(ageText((9 * 60 + 6) * 60_000), "9h 06m");
    assert.equal(ageText((49 * 60) * 60_000), "2d 1h");
  });

  it("shows the weekday only when it was not today", () => {
    const now = at("2026-11-14T00:51:00+05:30");
    assert.equal(istStamp(at("2026-11-14T00:30:00+05:30"), now), "00:30");
    assert.equal(istStamp(at("2026-11-13T23:54:59+05:30"), now), "Fri 23:54");
  });
});

// --- deskFigures ---------------------------------------------------------------------

const ITEM: ExpectedOpenItem = {
  market: "NATURALGAS",
  contract: { label: "Nov 2026", expiry: "2026-11-24" },
  mcxClose: 307.9,
  mcxClosedAt: at("2026-11-13T23:54:59+05:30"),
  nymex: { symbol: "NGZ26.NYM", label: "Dec 26", atClose: 3.255, now: 3.236, asOf: at("2026-11-14T00:41:00+05:30"), stale: true },
  movePct: ((3.236 / 3.255 - 1) * 100),
  expectedOpen: 307.9 * (3.236 / 3.255),
};

describe("deskFigures", () => {
  it("reads the feed's own numbers", () => {
    const f = deskFigures(ITEM, null);
    assert.equal(f.typed, false);
    assert.equal(f.nymexNow, 3.236);
    assert.equal(f.nymexShut, true);
    near(f.movePct, ITEM.movePct);
    near(f.expectedOpen, ITEM.expectedOpen);
    near(f.changeRupees, ITEM.expectedOpen - 307.9);
    assert.ok(f.changeRupees < 0);
    assert.equal(f.signal.headline, "Clear gap down"); // -0.58%
  });

  it("puts one typical miss either side of the expected open", () => {
    const f = deskFigures(ITEM, null);
    near(f.missRupees, (f.expectedOpen * TYPICAL_MISS_PCT) / 100);
    near(f.high - f.expectedOpen, f.missRupees);
    near(f.expectedOpen - f.low, f.missRupees);
  });

  it("works from a typed NYMEX price, with that price's own time, and is never 'shut'", () => {
    const typedAt = at("2026-11-16T08:57:00+05:30");
    const f = deskFigures(ITEM, { price: 3.3, at: typedAt });
    assert.equal(f.typed, true);
    assert.equal(f.nymexNow, 3.3);
    assert.equal(f.nymexAsOf, typedAt);
    assert.equal(f.nymexShut, false);
    near(f.movePct, (3.3 / 3.255 - 1) * 100);
    near(f.expectedOpen, 307.9 * (3.3 / 3.255));
    assert.ok(f.changeRupees > 0);
  });

  it("shows NYMEX in rupees at the feed's rate, then and now, and what MCX pays over it", () => {
    const f = deskFigures(ITEM, null, { rate: 92.6, asOf: at("2026-11-14T00:40:00+05:30") });
    assert.equal(f.rate, 92.6);
    assert.equal(f.rateAsOf, at("2026-11-14T00:40:00+05:30"));
    near(f.nymexAtCloseInr!, 3.255 * 92.6);
    near(f.nymexNowInr!, 3.236 * 92.6);
    // MCX 307.9 against 3.255 x 92.6 = 301.4: MCX was dearer
    near(f.premiumPct!, (307.9 / (3.255 * 92.6) - 1) * 100);
    assert.ok(f.premiumPct! > 0);
    // the move is the same in either currency - the rate is held still
    near((f.nymexNowInr! / f.nymexAtCloseInr! - 1) * 100, f.movePct);
  });

  it("has no rupee figures without a rate, and says so by leaving them null", () => {
    for (const none of [null, { rate: 0, asOf: 1 }]) {
      const f = deskFigures(ITEM, null, none);
      assert.deepEqual([f.rate, f.rateAsOf, f.nymexAtCloseInr, f.nymexNowInr, f.premiumPct], [null, null, null, null, null]);
    }
    assert.equal(deskFigures(ITEM, null).rate, null);
  });

  it("converts a typed NYMEX price too", () => {
    const f = deskFigures(ITEM, { price: 3.3, at: 1 }, { rate: 92.6, asOf: 1 });
    near(f.nymexNowInr!, 3.3 * 92.6);
    near(f.nymexAtCloseInr!, 3.255 * 92.6);
  });

  it("ignores a typed price it cannot use", () => {
    const f = deskFigures(ITEM, { price: 0, at: 1 });
    assert.equal(f.typed, false);
    near(f.expectedOpen, ITEM.expectedOpen);
  });
});

describe("parseNymexInput", () => {
  it("reads dollars however they are typed", () => {
    assert.deepEqual(parseNymexInput("3.25", 3.236, "Dec 26"), { ok: true, price: 3.25 });
    assert.deepEqual(parseNymexInput(" $3.25 ", 3.236, "Dec 26"), { ok: true, price: 3.25 });
    assert.deepEqual(parseNymexInput("3,25", 3.236, "Dec 26"), { ok: true, price: 3.25 });
  });

  it("refuses what is not a price", () => {
    for (const text of ["", "abc", "0", "-3.2", "3.2.1", "3.23456"]) {
      const result = parseNymexInput(text, 3.236, "Dec 26");
      assert.equal(result.ok, false, text);
    }
  });

  it("refuses a price far from the feed's, naming the contract, and allows up to 15%", () => {
    const far = parseNymexInput("4.7", 3.236, "Dec 26");
    assert.equal(far.ok, false);
    if (!far.ok) assert.match(far.message, /45% from the feed's \$3\.236.*Dec 26/);
    assert.deepEqual(parseNymexInput("4.6", 4, "Jan 27"), { ok: true, price: 4.6 });
    assert.equal(parseNymexInput("4.61", 4, "Jan 27").ok, false);
  });
});

// --- NYMEX hours ---------------------------------------------------------------------

describe("nymexState (CME energy: Sun 18:00 ET to Fri 17:00 ET, break 17:00-18:00 ET)", () => {
  it("trades through a winter weekday and breaks at 17:00 New York", () => {
    assert.equal(nymexState(at("2026-11-20T15:00:00Z")), "trading"); // Fri 10:00 ET
    assert.equal(nymexState(at("2026-11-23T22:30:00Z")), "break"); // Mon 17:30 ET
    assert.equal(nymexState(at("2026-11-23T23:00:00Z")), "trading"); // Mon 18:00 ET
  });

  it("is shut from Friday 17:00 ET until Sunday 18:00 ET", () => {
    assert.equal(nymexState(at("2026-11-20T21:59:00Z")), "trading"); // Fri 16:59 ET
    assert.equal(nymexState(at("2026-11-20T22:00:00Z")), "closed"); // Fri 17:00 ET
    assert.equal(nymexState(at("2026-11-21T12:00:00Z")), "closed"); // Sat
    assert.equal(nymexState(at("2026-11-22T22:59:00Z")), "closed"); // Sun 17:59 ET
    assert.equal(nymexState(at("2026-11-22T23:00:00Z")), "trading"); // Sun 18:00 ET = Mon 04:30 IST
  });

  it("follows New York's summer time: the break is an hour earlier in IST", () => {
    assert.equal(nymexState(at("2026-07-14T21:30:00Z")), "break"); // Tue 17:30 EDT = Wed 03:00 IST
    assert.equal(nymexState(at("2026-07-14T22:00:00Z")), "trading"); // 18:00 EDT = 03:30 IST
  });
});

describe("nymexOutlook", () => {
  it("says when a closed NYMEX reopens", () => {
    const out = nymexOutlook(at("2026-11-23T00:10:00+05:30")); // Mon 00:10 IST, the weekend
    assert.equal(out.state, "closed");
    assert.equal(out.at, at("2026-11-23T04:30:00+05:30"));
  });

  it("says when a trading NYMEX next stops", () => {
    const daily = nymexOutlook(at("2026-11-24T10:00:00+05:30"));
    assert.equal(daily.state, "trading");
    assert.equal(daily.at, at("2026-11-25T03:30:00+05:30")); // Tue 10:00 IST -> Wed 03:30 IST (17:00 ET Tue)
    const friday = nymexOutlook(at("2026-11-20T21:00:00+05:30"));
    assert.equal(friday.at, at("2026-11-21T03:30:00+05:30"));
  });

  it("says when the daily break ends", () => {
    const out = nymexOutlook(at("2026-11-25T03:45:00+05:30"));
    assert.equal(out.state, "break");
    assert.equal(out.at, at("2026-11-25T04:30:00+05:30"));
  });
});

describe("sessionHours and windowRows", () => {
  it("is the winter table while US clocks are on winter time", () => {
    const h = sessionHours(at("2026-11-22T12:00:00+05:30"));
    assert.equal(h.summer, false);
    assert.deepEqual(h.mcx, { opens: "09:00", closes: "23:55" });
    assert.deepEqual(h.nymex, { breakFrom: "03:30", breakTo: "04:30", weekOpens: "Mon 04:30", weekCloses: "Sat 03:30" });
  });

  it("moves an hour earlier in summer", () => {
    const h = sessionHours(at("2026-07-14T12:00:00+05:30"));
    assert.equal(h.summer, true);
    assert.deepEqual(h.mcx, { opens: "09:00", closes: "23:30" });
    assert.deepEqual(h.nymex, { breakFrom: "02:30", breakTo: "03:30", weekOpens: "Mon 03:30", weekCloses: "Sat 02:30" });
  });

  it("lists the week's stretches in IST", () => {
    const rows = windowRows(at("2026-11-22T12:00:00+05:30"));
    assert.deepEqual(
      rows.map((r) => r.when),
      ["Mon–Fri 09:00–23:55", "Mon–Fri 23:55–03:30", "Mon–Fri 03:30–04:30", "Mon–Fri 04:30–09:00", "Fri 23:55 – Sat 03:30", "Sat 03:30 – Mon 04:30"],
    );
    assert.deepEqual(rows[2], { when: "Mon–Fri 03:30–04:30", mcx: "Shut", nymex: "On break", estimate: "Frozen for the hour" });
    assert.equal(rows[5].nymex, "Shut");
    const summer = windowRows(at("2026-07-14T12:00:00+05:30"));
    assert.equal(summer[1].when, "Mon–Fri 23:30–02:30");
    assert.equal(summer[5].when, "Sat 02:30 – Mon 03:30");
  });
});

describe("tabPreview", () => {
  it("says nothing until the feed has answered", () => {
    assert.equal(tabPreview(null, 1.2), null);
  });

  it("says Live while MCX trades, whatever the gap", () => {
    assert.deepEqual(tabPreview({ open: true }, null), { kind: "live" });
    assert.deepEqual(tabPreview({ open: true }, 2), { kind: "live" });
  });

  it("shows the gap while MCX is shut, coloured by its sign", () => {
    assert.deepEqual(tabPreview({ open: false }, 1.12), { kind: "gap", direction: "up", movePct: 1.12 });
    assert.deepEqual(tabPreview({ open: false }, -0.35), { kind: "gap", direction: "down", movePct: -0.35 });
    assert.equal((tabPreview({ open: false }, 0.004) as { direction: string }).direction, "flat");
  });

  it("shows nothing for a shut MCX with no estimate yet", () => {
    assert.equal(tabPreview({ open: false }, null), null);
    assert.equal(tabPreview({ open: false }, Number.NaN), null);
  });
});

describe("dayBars", () => {
  it("lays out a winter weekday: MCX 09:00-23:55, NYMEX trading round the clock but its 03:30-04:30 break", () => {
    const d = dayBars(at("2026-11-24T10:00:00+05:30")); // Tuesday
    assert.deepEqual(d.mcx, [{ from: 540, to: 1435 }]);
    assert.deepEqual(d.nymexBreak, [{ from: 210, to: 270 }]);
    assert.deepEqual(d.nymexTrading, [{ from: 0, to: 210 }, { from: 270, to: 1440 }]);
    assert.equal(d.nowMinute, 600);
    assert.equal(d.date, "2026-11-24");
  });

  it("moves an hour earlier in summer, and MCX closes at 23:30", () => {
    const d = dayBars(at("2026-07-14T10:00:00+05:30"));
    assert.deepEqual(d.mcx, [{ from: 540, to: 1410 }]);
    assert.deepEqual(d.nymexBreak, [{ from: 150, to: 210 }]);
  });

  it("has NYMEX reopen at 04:30 on Monday, with nothing before it", () => {
    const d = dayBars(at("2026-11-23T00:25:00+05:30"));
    assert.deepEqual(d.mcx, [{ from: 540, to: 1435 }]);
    assert.deepEqual(d.nymexBreak, []);
    assert.deepEqual(d.nymexTrading, [{ from: 270, to: 1440 }]);
    assert.equal(d.nowMinute, 25);
  });

  it("has NYMEX trade until 03:30 on Saturday, and MCX not at all", () => {
    const d = dayBars(at("2026-11-21T12:00:00+05:30"));
    assert.deepEqual(d.mcx, []);
    assert.deepEqual(d.nymexTrading, [{ from: 0, to: 210 }]);
    assert.deepEqual(d.nymexBreak, []);
  });

  it("is shut all day on Sunday", () => {
    const d = dayBars(at("2026-11-22T12:00:00+05:30"));
    assert.deepEqual([d.mcx, d.nymexTrading, d.nymexBreak], [[], [], []]);
  });
});

// --- positions at the expected open --------------------------------------------------

const NOW = at("2026-11-23T00:10:00+05:30"); // Monday, MCX shut
const OPEN = at("2026-11-23T09:00:00+05:30");
const EXPIRY = "2026-12-23";
const SPOT = 340;
const IV = 0.55;
const LOT = DEFAULT_LOT_SIZES.NATURALGAS;

function bs(strike: number, isCall: boolean, spot = SPOT): number {
  const sd = IV * Math.sqrt(yearsToExpiry(EXPIRY, new Date(NOW), "NATURALGAS"));
  const d1 = (Math.log(spot / strike) + (sd * sd) / 2) / sd;
  const d2 = d1 - sd;
  return isCall ? spot * normCdf(d1) - strike * normCdf(d2) : strike * normCdf(-d2) - spot * normCdf(-d1);
}

let seq = 0;
function entry(over: Partial<TradeEntry>): TradeEntry {
  seq += 1;
  return {
    id: `n${seq}`,
    user_id: null,
    entry_date: "2026-11-16",
    instrument: "NATURALGAS",
    strike_price: 350,
    option_type: "CE",
    expiry_date: EXPIRY,
    closing_date: null,
    lots: 1,
    side: "buy",
    buy_price: 20,
    sell_price: 20,
    pnl: 0,
    status: "hold",
    remarks: null,
    created_at: "2026-11-16T04:00:00Z",
    updated_at: "2026-11-16T04:00:00Z",
    ...over,
  };
}

function optionRow(over: Partial<TradeEntry>, entryPrice = 20): PortfolioRow {
  const e = entry({ ...over, buy_price: entryPrice, sell_price: entryPrice });
  const ltp = bs(e.strike_price!, e.option_type === "CE");
  const sign = e.side === "buy" ? 1 : -1;
  return {
    entry: e,
    entryPrice,
    status: "ok",
    instrumentKey: "MCX_FO|1",
    liveLtp: ltp,
    livePnl: sign * (ltp - entryPrice) * e.lots * LOT,
    prevClose: ltp,
    delta: 0.45,
    gamma: 0.01,
    theta: -0.3,
    vega: 0.4,
    oi: 5000,
    iv: IV * 100,
    volume: 100,
    underlyingSpot: SPOT,
    nearbyIv: IV * 100,
    brokerageIfClosed: 40,
    stale: false,
    asOf: null,
  };
}

function futureRow(side: "buy" | "sell", lots = 1): PortfolioRow {
  const e = entry({ strike_price: null, option_type: null, side, lots, buy_price: 335, sell_price: 335 });
  return {
    ...optionRow({}),
    entry: e,
    entryPrice: 335,
    liveLtp: 340,
    livePnl: (side === "buy" ? 1 : -1) * 5 * lots * LOT,
    underlyingSpot: 339,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    iv: null,
  };
}

describe("positionsAtOpen", () => {
  it("changes nothing when there is no move and no time", () => {
    const result = positionsAtOpen([optionRow({})], 0, NOW, NOW);
    assert.equal(result.rows.length, 1);
    near(result.rows[0].change, 0, 1e-6);
    near(result.rows[0].pnlAtOpen, result.rows[0].pnlNow, 1e-6);
  });

  it("gains on a bought call and loses on a bought put when the gap is up", () => {
    const call = positionsAtOpen([optionRow({ option_type: "CE", strike_price: 350 })], 1, NOW, OPEN).rows[0];
    const put = positionsAtOpen([optionRow({ option_type: "PE", strike_price: 330 })], 1, NOW, OPEN).rows[0];
    assert.ok(call.change > 0, `call ${call.change}`);
    assert.ok(put.change < 0, `put ${put.change}`);
  });

  it("is about delta times the move on a bought at-the-money call, less a little decay", () => {
    const call = positionsAtOpen([optionRow({ option_type: "CE", strike_price: 340 })], 1, NOW, OPEN).rows[0];
    const flat = positionsAtOpen([optionRow({ option_type: "CE", strike_price: 340 })], 0, NOW, OPEN).rows[0];
    assert.ok(flat.change < 0, "time alone costs a bought option");
    // 1% of 340 = 3.4 a unit; an at-the-money delta is a little over a half
    const priceMove = call.change - flat.change;
    assert.ok(priceMove > 0.45 * 3.4 * LOT && priceMove < 0.65 * 3.4 * LOT, `${priceMove}`);
  });

  it("mirrors a short option against a bought one", () => {
    const long = positionsAtOpen([optionRow({ side: "buy" })], 0.8, NOW, OPEN).rows[0];
    const short = positionsAtOpen([optionRow({ side: "sell" })], 0.8, NOW, OPEN).rows[0];
    near(long.change, -short.change, 1e-6);
  });

  it("moves a future one for one, long or short", () => {
    const long = positionsAtOpen([futureRow("buy", 2)], 1, NOW, OPEN).rows[0];
    const short = positionsAtOpen([futureRow("sell", 2)], 1, NOW, OPEN).rows[0];
    near(long.change, 3.4 * 2 * LOT, 1e-6);
    near(short.change, -3.4 * 2 * LOT, 1e-6);
    assert.equal(long.isFuture, true);
    near(long.pnlAtOpen, long.pnlNow + long.change);
  });

  it("totals the book, leaves out what it cannot price, and ignores other markets", () => {
    const unpriced: PortfolioRow = { ...optionRow({}), status: "loading", liveLtp: null, livePnl: null };
    const nifty: PortfolioRow = { ...optionRow({}), entry: entry({ instrument: "NIFTY" }) };
    const rows = [optionRow({ strike_price: 350 }), futureRow("buy"), unpriced, nifty];
    const result = positionsAtOpen(rows, 1, NOW, OPEN);
    assert.equal(result.rows.length, 2);
    assert.equal(result.skipped, 1);
    near(result.totalChange, result.rows[0].change + result.rows[1].change);
    near(result.totalNow, result.rows[0].pnlNow + result.rows[1].pnlNow);
    near(result.totalAtOpen, result.totalNow + result.totalChange);
  });

  it("is empty for an empty book", () => {
    assert.deepEqual(positionsAtOpen([], 1, NOW, OPEN), { rows: [], skipped: 0, totalNow: 0, totalChange: 0, totalAtOpen: 0 });
  });
});
