/**
 * How far an index future trades above the index and how much of that goes in a day. The figures are the ones in the user's
 * Upstox screenshot of 17-18 Nov 2026: the Nifty 29 Dec 2026 future at 25,556.60 against the index at 25,387.40 - a premium of
 * 169.20 points with 41 days to run, so about 4.1 points a day.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { buildFutureCarries, carryPnl, expectedFuture, isFutureCarry, shrinkOver, weekendCarry, type FutureCarry } from "@/lib/futureCarry";
import type { TradeEntry } from "@/lib/types";

/** Wednesday 18 Nov 2026, 10:30 IST. */
const NOW = Date.parse("2026-11-18T05:00:00Z");

function entry(over: Partial<TradeEntry> = {}): TradeEntry {
  return {
    id: "e1",
    user_id: null,
    entry_date: "2026-11-17",
    instrument: "NIFTY",
    strike_price: null,
    option_type: null,
    expiry_date: "2026-12-29",
    closing_date: null,
    lots: 2,
    side: "sell",
    buy_price: 0,
    sell_price: 25_000,
    pnl: 0,
    status: "hold",
    remarks: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

function row(over: Partial<PortfolioRow> = {}): PortfolioRow {
  return {
    entry: entry(),
    entryPrice: 25_000,
    status: "ok",
    instrumentKey: "NSE_FO|1",
    liveLtp: 25_556.6,
    livePnl: 0,
    prevClose: 25_450,
    delta: null,
    gamma: null,
    theta: null,
    vega: null,
    oi: null,
    iv: null,
    volume: null,
    underlyingSpot: 25_387.4,
    nearbyIv: 0.12,
    brokerageIfClosed: 0,
    stale: false,
    asOf: null,
    ...over,
  };
}

const near = (actual: number, expected: number, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

function carryOf(rows: PortfolioRow[], nowMs = NOW): FutureCarry {
  const items = buildFutureCarries(rows, nowMs);
  assert.equal(items.length, 1);
  assert.ok(isFutureCarry(items[0]), JSON.stringify(items[0]));
  return items[0];
}

describe("the premium over the index", () => {
  it("is the future's price less the index, as points and as a share of the index", () => {
    const c = carryOf([row()]);
    near(c.basis, 169.2);
    near(c.basisPct, 0.6665, 0.0001);
    assert.equal(c.future, 25_556.6);
    assert.equal(c.spot, 25_387.4);
  });

  it("counts the calendar days to the expiry's 15:30 close, from the moment of the prices", () => {
    const c = carryOf([row()]);
    // 18 Nov 10:30 IST -> 29 Dec 15:30 IST = 41 days and 5 hours
    near(c.daysLeft, 41 + 5 / 24, 0.0001);
    assert.equal(c.expiryMs, Date.parse("2026-12-29T15:30:00+05:30"));
  });

  it("annualises it - what the market is charging a year for carry", () => {
    near(carryOf([row()]).annualisedPct as number, 5.903, 0.001);
  });

  it("is a discount, with a negative sign, when the future trades below the index", () => {
    const c = carryOf([row({ liveLtp: 25_300 })]);
    near(c.basis, -87.4);
    assert.ok(c.basisPct < 0 && (c.annualisedPct as number) < 0);
  });
});

describe("what goes in a day", () => {
  it("is the premium spread evenly over the days left: about 4.1 points of 169.2 with 41 days to run", () => {
    const c = carryOf([row()]);
    near(shrinkOver(c, 1), 169.2 / c.daysLeft, 1e-9);
    near(shrinkOver(c, 1), 4.106, 0.001);
  });

  it("takes three days over a weekend", () => {
    const c = carryOf([row()]);
    near(shrinkOver(c, 3), 3 * shrinkOver(c, 1), 1e-9);
    near(shrinkOver(c, 3), 12.32, 0.01);
  });

  it("puts the future where it should be a day on if the index stays put", () => {
    const c = carryOf([row()]);
    near(expectedFuture(c, 1), 25_556.6 - 4.106, 0.001);
    assert.equal(expectedFuture(c, 0), 25_556.6);
  });

  it("is a rise, not a fall, for a discount: it narrows", () => {
    const c = carryOf([row({ liveLtp: 25_300 })]);
    assert.ok(shrinkOver(c, 1) < 0); // the same sign as the basis
    assert.ok(expectedFuture(c, 1) > 25_300);
  });

  it("is the whole premium once the last day has come, never more", () => {
    // 29 Dec 2026, 11:30 IST: four hours to the close
    const late = Date.parse("2026-12-29T06:00:00Z");
    const c = carryOf([row()], late);
    assert.ok(c.daysLeft < 1);
    near(shrinkOver(c, 1), 169.2, 1e-9);
    near(shrinkOver(c, 3), 169.2, 1e-9);
    assert.equal(c.annualisedPct, null); // meaningless inside the last day
    near(expectedFuture(c, 1), 25_387.4, 1e-9); // converged on the index
  });

  it("is the whole premium by expiry", () => {
    const c = carryOf([row()]);
    near(shrinkOver(c, c.daysLeft), 169.2, 1e-9);
  });

  it("has nothing to shrink with no days left", () => {
    near(shrinkOver({ basis: 50, daysLeft: 0 }, 1), 50, 1e-9);
  });
});

describe("what it does to the position, with the index unchanged", () => {
  it("pays a long the premium that goes, and pays a short", () => {
    const short = carryOf([row()]); // sold 2 lots of 65
    assert.equal(short.netLots, -2);
    assert.equal(short.netQty, -130);
    near(carryPnl(short, 1), 130 * 4.106, 0.5); // about +₹534
    assert.ok(carryPnl(short, 1) > 0);

    const long = carryOf([row({ entry: entry({ side: "buy", lots: 1 }) })]);
    assert.equal(long.netQty, 65);
    near(carryPnl(long, 1), -65 * 4.106, 0.5);
    assert.ok(carryPnl(long, 1) < 0);
  });

  it("flips for a discount: a long collects it as it narrows", () => {
    const long = carryOf([row({ entry: entry({ side: "buy", lots: 1 }), liveLtp: 25_300 })]);
    assert.ok(carryPnl(long, 1) > 0);
  });

  it("is nothing for a long and a short that cancel", () => {
    const hedged = carryOf([row({ entry: entry({ id: "a", side: "buy", lots: 2 }) }), row({ entry: entry({ id: "b", side: "sell", lots: 2 }) })]);
    assert.equal(hedged.netLots, 0);
    assert.equal(carryPnl(hedged, 3) + 0, 0);
  });

  it("uses each index's own lot size", () => {
    const bank = carryOf([row({ entry: entry({ instrument: "BANKNIFTY", lots: 3 }), liveLtp: 62_500, underlyingSpot: 62_273.25 })]);
    assert.equal(bank.netQty, -90); // 3 x 30
    const sensex = carryOf([row({ entry: entry({ instrument: "SENSEX", lots: 5 }), liveLtp: 82_700, underlyingSpot: 82_532.19 })]);
    assert.equal(sensex.netQty, -100); // 5 x 20
  });
});

describe("one line per contract", () => {
  it("adds up several rows of the same contract", () => {
    const c = carryOf([row({ entry: entry({ id: "a", lots: 2 }) }), row({ entry: entry({ id: "b", lots: 1 }) }), row({ entry: entry({ id: "c", side: "buy", lots: 1 }) })]);
    assert.equal(c.netLots, -2); // short 3, long 1
  });

  it("keeps different expiries and indices apart, soonest first", () => {
    const items = buildFutureCarries(
      [
        row({ entry: entry({ id: "a", expiry_date: "2027-01-26" }) }),
        row({ entry: entry({ id: "b", instrument: "SENSEX", expiry_date: "2026-12-29" }), liveLtp: 82_700, underlyingSpot: 82_532.19 }),
        row({ entry: entry({ id: "c" }) }),
      ],
      NOW,
    );
    assert.deepEqual(items.map((i) => `${i.instrument} ${i.expiry}`), ["NIFTY 2026-12-29", "SENSEX 2026-12-29", "NIFTY 2027-01-26"]);
  });

  it("leaves out options, and a future whose expiry has passed", () => {
    const option = row({ entry: entry({ strike_price: 25_000, option_type: "CE" }) });
    assert.deepEqual(buildFutureCarries([option], NOW), []);
    assert.deepEqual(buildFutureCarries([row()], Date.parse("2026-12-29T11:00:00Z")), []); // after the 15:30 IST close
  });
});

describe("when it can't be worked out yet", () => {
  it("says the future's price hasn't arrived", () => {
    for (const status of ["loading", "error"] as const) {
      const [item] = buildFutureCarries([row({ status, liveLtp: null, underlyingSpot: null })], NOW);
      assert.deepEqual(item, { key: "NIFTY|2026-12-29", instrument: "NIFTY", expiry: "2026-12-29", reason: "no_price" }, status);
    }
  });

  it("says the index level hasn't, when the future's price has", () => {
    const [item] = buildFutureCarries([row({ underlyingSpot: null })], NOW);
    assert.equal(isFutureCarry(item), false);
    assert.equal((item as { reason: string }).reason, "no_index");
  });

  it("uses a row that is priced when another row of the same contract isn't", () => {
    const c = carryOf([row({ entry: entry({ id: "a" }), status: "loading", liveLtp: null, underlyingSpot: null }), row({ entry: entry({ id: "b" }) })]);
    near(c.basis, 169.2);
  });
});

describe("prices from before the connection dropped", () => {
  it("says so, and when they are from", () => {
    const c = carryOf([row({ stale: true, asOf: NOW - 3_600_000 })]);
    assert.equal(c.stale, true);
    assert.equal(c.asOf, NOW - 3_600_000);
    assert.equal(carryOf([row()]).stale, false);
  });
});

describe("weekends", () => {
  it("add up to three days between Friday's close and Monday's", () => {
    assert.equal(weekendCarry(Date.parse("2026-11-18T05:00:00Z")), null); // Wednesday
    assert.deepEqual(weekendCarry(Date.parse("2026-11-16T05:00:00Z")), { days: 3, when: "since" }); // Monday: has had it
    for (const day of ["2026-11-20", "2026-11-21", "2026-11-22"]) {
      assert.deepEqual(weekendCarry(Date.parse(`${day}T05:00:00Z`)), { days: 3, when: "until" }, day); // Fri, Sat, Sun: will have it
    }
  });

  it("goes by the date in India, not UTC", () => {
    // Sunday 22 Nov 23:00 UTC is already Monday 23 Nov, 04:30 IST
    assert.deepEqual(weekendCarry(Date.parse("2026-11-22T23:00:00Z")), { days: 3, when: "since" });
    // Thursday 19 Nov 20:00 UTC is Friday 20 Nov, 01:30 IST
    assert.deepEqual(weekendCarry(Date.parse("2026-11-19T20:00:00Z")), { days: 3, when: "until" });
  });
});
