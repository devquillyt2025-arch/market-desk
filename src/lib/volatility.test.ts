import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dailyFromAnnualPct, intradayVolatility, logReturns, realizedVolatility, TRADING_DAYS } from "@/lib/volatility";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

/** Closes that swing up and down by the same log return every day: volatility is that return, exactly (up to the n−1). */
function zigzag(days: number, move: number): number[] {
  const closes = [100];
  for (let i = 0; i < days; i++) closes.push(closes[i] * Math.exp(i % 2 === 0 ? move : -move));
  return closes;
}

describe("logReturns", () => {
  it("is ln(today ÷ yesterday) for each consecutive pair", () => {
    const r = logReturns([100, 110, 99]);
    assert.equal(r.length, 2);
    near(r[0], Math.log(1.1));
    near(r[1], Math.log(0.9));
  });

  it("skips a pair with a missing or non-positive price instead of poisoning the rest", () => {
    assert.equal(logReturns([100, 0, 105, NaN, 106, 107]).length, 1);
    assert.deepEqual(logReturns([]), []);
    assert.deepEqual(logReturns([100]), []);
  });
});

describe("realizedVolatility", () => {
  it("is zero for a market that moves by exactly the same amount every day", () => {
    const closes = Array.from({ length: 40 }, (_, i) => 100 * Math.exp(0.001 * i));
    near(realizedVolatility(closes, 20)!.daily, 0, 1e-12);
  });

  it("measures the size of a daily swing", () => {
    // 60 daily returns of ±1%: mean ≈ 0, so the sample deviation is 1% × √(n / (n − 1)).
    const v = realizedVolatility(zigzag(60, 0.01), 60)!;
    near(v.daily, 0.01 * Math.sqrt(60 / 59), 1e-4);
    assert.equal(v.days, 60);
  });

  it("scales to a year by the square root of the trading days", () => {
    const v = realizedVolatility(zigzag(60, 0.01), 60)!;
    near(v.annual, v.daily * Math.sqrt(TRADING_DAYS));
  });

  it("looks only at the most recent sessions", () => {
    const wild = zigzag(40, 0.03);
    const calm = Array.from({ length: 30 }, (_, i) => wild[wild.length - 1] * Math.exp(0.0005 * (i + 1)));
    const closes = [...wild, ...calm];
    assert.ok(realizedVolatility(closes, 20)!.daily < 0.001, "the last 20 sessions were calm");
    assert.ok(realizedVolatility(closes, 60)!.daily > 0.01, "the last 60 reach back into the wild stretch");
  });

  it("says nothing when there isn't enough history for the window, or for any figure", () => {
    assert.equal(realizedVolatility(zigzag(30, 0.01), 60), null);
    assert.equal(realizedVolatility(zigzag(30, 0.01), 4), null);
    assert.equal(realizedVolatility([], 20), null);
  });
});

describe("intradayVolatility", () => {
  /** Sessions that open at 100 and close 1% up or down in turn. */
  const sessions = (n: number, move: number) => Array.from({ length: n }, (_, i) => ({ open: 100, close: 100 * Math.exp(i % 2 === 0 ? move : -move) }));

  it("measures the spread of the open-to-close moves", () => {
    near(intradayVolatility(sessions(60, 0.01), 60)!, 0.01 * Math.sqrt(60 / 59), 1e-4);
  });

  it("leaves out the gap between one close and the next open", () => {
    // Every session opens 2% above yesterday's close but moves exactly the same inside the day:
    // the day-to-day volatility is large, the intraday one is nothing.
    const closes = [100];
    const gapped = Array.from({ length: 30 }, (_, i) => {
      const open = closes[i] * 1.02;
      const close = open * 1.001;
      closes.push(close);
      return { open, close };
    });
    near(intradayVolatility(gapped, 30)!, 0, 1e-9);
  });

  it("looks only at the most recent sessions, and skips sessions with no open", () => {
    const calm = Array.from({ length: 20 }, () => ({ open: 100, close: 100.1 }));
    const wild = sessions(40, 0.03);
    assert.ok(intradayVolatility([...wild, ...calm], 20)! < 1e-9);
    assert.ok(intradayVolatility([...wild, ...calm], 60)! > 0.01);
    // Every third session has no open; the rest still mix ups and downs, so the spread is still about 1%.
    const holes = sessions(30, 0.01).map((s, i) => (i % 3 === 2 ? { ...s, open: null } : s));
    assert.ok(Math.abs(intradayVolatility(holes, 30)! - 0.01) < 0.002);
  });

  it("says nothing without enough sessions that have an open", () => {
    assert.equal(intradayVolatility(sessions(4, 0.01), 20), null);
    assert.equal(intradayVolatility(sessions(30, 0.01), 4), null);
    assert.equal(intradayVolatility(sessions(30, 0.01).map((s) => ({ ...s, open: null })), 20), null);
  });
});

describe("dailyFromAnnualPct", () => {
  it("is the inverse of annualizing", () => {
    const v = realizedVolatility(zigzag(60, 0.01), 60)!;
    near(dailyFromAnnualPct(v.annual * 100), v.daily);
    near(dailyFromAnnualPct(15.8745), 0.01, 1e-5); // 1% a day is about 15.87% a year
  });
});
