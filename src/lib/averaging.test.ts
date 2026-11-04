import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  breakevenSpot,
  buildLadder,
  buildLegs,
  buildLotsTable,
  buildScenarios,
  deltaGammaMove,
  isMarketOpen,
  LADDER_STEP,
  MARGINAL_IMPROVEMENT,
  maxAffordableLots,
  newAveragePrice,
  pnlAt,
  premiumRiseNeeded,
  priceMoved,
  simulateAveraging,
  simulationInputs,
  toAnalysisStrategy,
  type AveragingMarket,
  type AveragingPlan,
  type AveragingPosition,
} from "@/lib/averaging";
import type { PortfolioRow } from "@/lib/calculatePortfolio";
import {
  analyzeStrategy,
  expiryCloseMs,
  priceLegs,
  strategyGreeks,
  strategyPnl,
  type StrategyLeg,
} from "@/lib/calculateStrategy";
import type { TradeEntry } from "@/lib/types";

// Wednesday 4 Nov 2026, 10:00 IST — market open. Expiry is six days out (a Tuesday).
const NOW = Date.parse("2026-11-04T10:00:00+05:30");
const EXPIRY = "2026-11-10";
const SPOT = 24000;
const LOT = 65;

function position(over: Partial<AveragingPosition> = {}): AveragingPosition {
  return {
    instrument: "NIFTY",
    type: "CE",
    strike: 24000,
    expiry: EXPIRY,
    lots: 2,
    lotSize: LOT,
    avgPrice: 200,
    iv: 14,
    brokerGreeks: { delta: 0.5, gamma: 0.0005, theta: -12 },
    ...over,
  };
}

function marketOf(over: Partial<AveragingMarket> = {}): AveragingMarket {
  return { spot: SPOT, ltp: 170, nowMs: NOW, stale: false, ...over };
}

function planOf(over: Partial<AveragingPlan> = {}): AveragingPlan {
  return { extraLots: 1, buyPrice: 170, funds: 100_000, riskLimitPct: 25, ...over };
}

const near = (actual: number | null, expected: number, eps = 1e-6) => {
  assert.ok(actual !== null && Math.abs(actual - expected) <= eps, `expected ${actual} ≈ ${expected} (±${eps})`);
};

/** What the position's option is worth per unit by the engine's own model (price 0 turns P&L into value). */
function modelValue(p: AveragingPosition, spot = SPOT, atMs = NOW): number {
  const legs = buildLegs({ ...p, lots: 1, avgPrice: 0 }, 0, 0).before;
  return pnlAt(legs, p.lotSize, spot, NOW, spot, atMs) / p.lotSize;
}

describe("newAveragePrice", () => {
  it("weights by quantity", () => {
    // 130 @ 200 plus 65 @ 170 → 195 @ 190
    near(newAveragePrice(130, 200, 65, 170), 190);
  });

  it("lowers the average when buying below it and raises it when buying above", () => {
    assert.ok(newAveragePrice(130, 200, 65, 150) < 200);
    assert.ok(newAveragePrice(130, 200, 65, 250) > 200);
  });

  it("returns the held average when nothing is added", () => {
    assert.equal(newAveragePrice(130, 200, 0, 170), 200);
  });

  it("returns the purchase price when nothing was held", () => {
    assert.equal(newAveragePrice(0, 200, 65, 170), 170);
  });

  it("does not divide by zero when nothing is held or added", () => {
    assert.equal(newAveragePrice(0, 200, 0, 170), 200);
  });

  it("ignores a non-finite price", () => {
    assert.equal(newAveragePrice(130, 200, 65, NaN), 200);
  });
});

describe("maxAffordableLots", () => {
  it("floors to whole lots", () => {
    assert.equal(maxAffordableLots(100_000, LOT, 170), 9);
  });

  it("counts an exact fit", () => {
    assert.equal(maxAffordableLots(6500, LOT, 100), 1);
  });

  it("is zero without usable funds, price or lot size", () => {
    assert.equal(maxAffordableLots(null, LOT, 170), 0);
    assert.equal(maxAffordableLots(0, LOT, 170), 0);
    assert.equal(maxAffordableLots(100_000, LOT, null), 0);
    assert.equal(maxAffordableLots(100_000, LOT, 0), 0);
    assert.equal(maxAffordableLots(100_000, 0, 170), 0);
  });
});

describe("premiumRiseNeeded and priceMoved", () => {
  it("gives rupees and percent of the live price", () => {
    const r = premiumRiseNeeded(190, 170);
    near(r.rupees, 20);
    near(r.pct, (20 / 170) * 100);
  });

  it("is negative once the live price is already above the target", () => {
    assert.ok(premiumRiseNeeded(100, 130).rupees < 0);
  });

  it("has no percentage without a live price", () => {
    assert.equal(premiumRiseNeeded(190, 0).pct, null);
  });

  it("calls a locked price moved from one tick away", () => {
    assert.equal(priceMoved(100, 100.04), false);
    assert.equal(priceMoved(100, 100.05), true);
    assert.equal(priceMoved(100, 99.9), true);
  });
});

describe("pnlAt", () => {
  const expiryMs = expiryCloseMs(EXPIRY);

  it("is intrinsic value minus cost, per unit held, at expiry", () => {
    const { after } = buildLegs(position(), 1, 170);
    // spot 24300: 300 intrinsic. 130 units bought at 200, 65 at 170.
    near(pnlAt(after, LOT, SPOT, NOW, 24300, expiryMs), (300 - 200) * 130 + (300 - 170) * 65, 1e-6);
  });

  it("loses the whole premium when out of the money at expiry", () => {
    const { after } = buildLegs(position(), 1, 170);
    near(pnlAt(after, LOT, SPOT, NOW, 23500, expiryMs), -(130 * 200 + 65 * 170), 1e-6);
  });

  it("matches the engine for the same legs, spot and moment", () => {
    const { after } = buildLegs(position(), 1, 170);
    const priced = priceLegs(after, SPOT, NOW, LOT);
    near(pnlAt(after, LOT, SPOT, NOW, 24123, NOW), strategyPnl(priced, 24123, NOW), 1e-9);
  });
});

describe("buildScenarios", () => {
  it("offers Today, Tomorrow and Expiry when expiry is two or more days away", () => {
    const s = buildScenarios(EXPIRY, NOW);
    assert.deepEqual(
      s.map((x) => x.key),
      ["today", "tomorrow", "expiry"],
    );
    assert.equal(s[0].atMs, NOW);
    assert.equal(s[1].atMs, Date.parse("2026-11-05T15:30:00+05:30"));
    assert.equal(s[2].atMs, expiryCloseMs(EXPIRY));
  });

  it("hides Tomorrow when the contract expires today", () => {
    const s = buildScenarios("2026-11-04", NOW);
    assert.deepEqual(
      s.map((x) => x.key),
      ["today", "expiry"],
    );
  });

  it("folds Tomorrow into Expiry when the contract expires tomorrow", () => {
    const s = buildScenarios("2026-11-05", NOW);
    assert.deepEqual(
      s.map((x) => x.key),
      ["today", "expiry"],
    );
  });

  it("offers only Today for a contract whose expiry has passed", () => {
    assert.deepEqual(
      buildScenarios("2026-11-03", NOW).map((x) => x.key),
      ["today"],
    );
  });
});

describe("Nifty move needed", () => {
  for (const type of ["CE", "PE"] as const) {
    it(`gives zero P&L at the break-even for Today, Tomorrow and Expiry (${type})`, () => {
      const p = position({ type });
      const result = simulateAveraging(p, marketOf({ ltp: modelValue(p) }), planOf());
      const { after } = buildLegs(p, result.extraLots, result.buyPrice as number);

      assert.deepEqual(
        result.scenarios.after.map((s) => s.key),
        ["today", "tomorrow", "expiry"],
      );
      for (const s of result.scenarios.after) {
        assert.ok(s.move !== null && s.level !== null, `${s.label} has a break-even`);
        near(s.level, SPOT + s.move, 1e-9);
        near(pnlAt(after, LOT, SPOT, NOW, SPOT + s.move, s.atMs), 0, 1e-3);
      }
      for (const s of result.scenarios.before) {
        const { before } = buildLegs(p, 0, 0);
        near(pnlAt(before, LOT, SPOT, NOW, SPOT + (s.move as number), s.atMs), 0, 1e-3);
      }
    });
  }

  it("also holds on expiry day, where Tomorrow is hidden", () => {
    const p = position({ expiry: "2026-11-04", avgPrice: 60 });
    const result = simulateAveraging(p, marketOf({ ltp: 40 }), planOf({ buyPrice: 40 }));
    const { after } = buildLegs(p, result.extraLots, 40);
    assert.deepEqual(
      result.scenarios.after.map((s) => s.key),
      ["today", "expiry"],
    );
    for (const s of result.scenarios.after) {
      near(pnlAt(after, LOT, SPOT, NOW, SPOT + (s.move as number), s.atMs), 0, 1e-3);
    }
  });

  it("needs more points the later you check, because theta eats the premium", () => {
    const p = position();
    const [today, tomorrow, expiry] = simulateAveraging(p, marketOf(), planOf()).scenarios.after;
    assert.ok((today.move as number) < (tomorrow.move as number));
    assert.ok((tomorrow.move as number) < (expiry.move as number));
    assert.equal(today.thetaDrag, 0);
    assert.ok(tomorrow.thetaDrag > 0);
    assert.ok(expiry.thetaDrag > tomorrow.thetaDrag);
    assert.ok(tomorrow.premiumRise > today.premiumRise);
    assert.ok(expiry.premiumRise > tomorrow.premiumRise);
  });

  it("is exactly the new strike-plus-average at expiry for a call, strike-minus for a put", () => {
    const call = simulateAveraging(position(), marketOf(), planOf()).scenarios.after.at(-1);
    near(call?.level ?? null, 24000 + 190, 1e-4);
    const put = simulateAveraging(position({ type: "PE" }), marketOf(), planOf()).scenarios.after.at(-1);
    near(put?.level ?? null, 24000 - 190, 1e-4);
  });

  it("needs fewer points after averaging down than before", () => {
    const r = simulateAveraging(position(), marketOf(), planOf());
    r.scenarios.after.forEach((s, i) => assert.ok((s.move as number) < (r.scenarios.before[i].move as number)));
  });

  it("returns no break-even when nothing is held", () => {
    assert.equal(breakevenSpot([], SPOT, NOW), null);
  });
});

describe("delta-gamma estimate", () => {
  it("solves the second-order equation for a call and a put", () => {
    for (const delta of [0.5, -0.5]) {
      const x = deltaGammaMove(delta, 0.0005, 5) as number;
      near(0.5 * 0.0005 * x * x + delta * x, 5, 1e-9);
      assert.equal(Math.sign(x), Math.sign(delta));
    }
  });

  it("reduces to rise ÷ delta without gamma", () => {
    near(deltaGammaMove(0.5, 0, 5), 10);
  });

  it("gives up when delta is zero or the gap is beyond the quadratic", () => {
    assert.equal(deltaGammaMove(0, 0.0005, 5), null);
    assert.equal(deltaGammaMove(0.5, 0.0005, -1000), null);
    assert.equal(deltaGammaMove(NaN, 0.0005, 5), null);
  });

  it("lands close to the exact move for a modest gap, whatever the LTP is", () => {
    const p = position();
    for (const ltp of [modelValue(p), 150, 190]) {
      const r = simulateAveraging(p, marketOf({ ltp }), planOf());
      const today = r.scenarios.after[0];
      assert.equal(r.after.greeksSource, "engine");
      near(today.deltaGammaMove, today.move as number, Math.abs(today.move as number) * 0.05);
    }
  });
});

describe("before and after", () => {
  it("blends the average, lots, cost and risk", () => {
    const r = simulateAveraging(position(), marketOf(), planOf());
    assert.equal(r.before.qty, 130);
    assert.equal(r.after.qty, 195);
    near(r.after.avgPrice, 190);
    near(r.extraCost, 65 * 170);
    near(r.before.capitalAtRisk, 130 * 200);
    near(r.after.capitalAtRisk, 195 * 190);
    near(r.after.breakevenPremium, 190);
    near(r.avgImprovementPct, 5);
    // For a long option the worst case at expiry is every rupee of premium paid.
    near(r.after.maxLoss, r.after.capitalAtRisk, 1e-6);
    near(r.before.maxLoss, r.before.capitalAtRisk, 1e-6);
    near(r.after.breakevenLevel, 24190, 1e-4);
    near(r.before.breakevenLevel, 24200, 1e-4);
    assert.ok((r.after.pop as number) > 0 && (r.after.pop as number) < 1);
    assert.ok((r.after.pop as number) > (r.before.pop as number));
  });

  it("matches what Analysis computes for the same two legs", () => {
    const r = simulateAveraging(position(), marketOf(), planOf());
    const legs: StrategyLeg[] = [
      { id: "a", enabled: true, side: "buy", type: "CE", strike: 24000, expiry: EXPIRY, lots: 2, price: 200, chainIv: 14 },
      { id: "b", enabled: true, side: "buy", type: "CE", strike: 24000, expiry: EXPIRY, lots: 1, price: 170, chainIv: 14 },
    ];
    const priced = priceLegs(legs, SPOT, NOW, LOT);
    const metrics = analyzeStrategy(priced, SPOT, NOW);
    const greeks = strategyGreeks(priced, SPOT, NOW);
    assert.ok(metrics);
    assert.equal(r.after.pop, metrics.pop);
    assert.equal(r.after.maxLoss, metrics.maxLoss);
    assert.equal(r.after.breakevenLevel, metrics.breakevens[0]);
    assert.equal(r.after.delta, greeks.delta);
    assert.equal(r.after.gamma, greeks.gamma);
    assert.equal(r.after.theta, greeks.theta);
    assert.ok(r.after.theta < 0, "a long option pays theta");
  });

  it("leaves After equal to Before when no lots are added", () => {
    const r = simulateAveraging(position(), marketOf(), planOf({ extraLots: 0 }));
    assert.equal(r.after.avgPrice, r.before.avgPrice);
    assert.equal(r.after.pop, r.before.pop);
    assert.equal(r.after.breakevenLevel, r.before.breakevenLevel);
    assert.equal(r.extraCost, 0);
    assert.ok(r.warnings.some((w) => w.id === "no-lots"));
  });

  it("does not break on a position with nothing held", () => {
    const r = simulateAveraging(position({ lots: 0 }), marketOf(), planOf({ extraLots: 0 }));
    assert.equal(r.before.qty, 0);
    assert.equal(r.before.capitalAtRisk, 0);
    assert.equal(r.before.maxLoss, 0);
    assert.equal(r.before.pop, null);
    assert.equal(r.before.breakevenLevel, null);
    assert.ok(r.scenarios.before.every((s) => s.move === null && s.deltaGammaMove === null));
  });

  it("takes the purchase price as the average when nothing was held", () => {
    const r = simulateAveraging(position({ lots: 0 }), marketOf(), planOf({ extraLots: 2 }));
    near(r.after.avgPrice, 170);
    assert.equal(r.after.qty, 130);
  });

  it("simulates nothing without a usable price", () => {
    for (const buyPrice of [NaN, 0, -5]) {
      const r = simulateAveraging(position(), marketOf(), planOf({ buyPrice }));
      assert.equal(r.extraLots, 0);
      assert.equal(r.buyPrice, null);
      assert.equal(r.after.avgPrice, r.before.avgPrice);
      assert.ok(r.warnings.some((w) => w.id === "no-price"));
    }
  });

  it("copes with the live price sitting above the average", () => {
    const p = position({ avgPrice: 100 });
    const r = simulateAveraging(p, marketOf({ ltp: 130 }), planOf({ buyPrice: 130 }));
    assert.ok(r.after.avgPrice > r.before.avgPrice);
    assert.ok((r.avgImprovementPct as number) < 0);
    const today = r.scenarios.before[0];
    assert.ok(today.premiumRise < 0, "already past the average");
    assert.equal(today.inProfit, true);
    assert.ok((today.move as number) < 0, "a cushion, not a target");
    assert.ok(r.warnings.some((w) => w.id === "price-above-avg"));
  });
});

describe("Greeks and a missing IV", () => {
  it("uses the engine's Greeks when IV is present", () => {
    assert.equal(simulateAveraging(position(), marketOf(), planOf()).after.greeksSource, "engine");
  });

  it("falls back to the broker's Greeks, labelled, when IV is missing", () => {
    for (const iv of [null, 0]) {
      const r = simulateAveraging(position({ iv }), marketOf(), planOf());
      assert.equal(r.ivMissing, true);
      assert.equal(r.before.greeksSource, "broker");
      near(r.before.delta, 0.5 * 130);
      near(r.after.delta, 0.5 * 195);
      near(r.after.theta, -12 * 195);
      assert.ok(r.warnings.some((w) => w.id === "iv-missing"));
    }
  });

  it("estimates with the engine's fallback volatility when the broker has none either", () => {
    const r = simulateAveraging(position({ iv: null, brokerGreeks: null }), marketOf(), planOf());
    assert.equal(r.after.greeksSource, "estimated");
    assert.ok(Number.isFinite(r.after.delta) && r.after.delta > 0);
    assert.ok(Number.isFinite(r.after.theta) && r.after.theta < 0);
    const partial = simulateAveraging(
      position({ iv: null, brokerGreeks: { delta: 0.5, gamma: null, theta: -12 } }),
      marketOf(),
      planOf(),
    );
    assert.equal(partial.after.greeksSource, "estimated");
  });
});

describe("lots table", () => {
  const p = position();
  const m = marketOf();

  it("has one row per affordable lot, with a falling average", () => {
    const table = buildLotsTable(p, m, 170, 9);
    assert.equal(table.rows.length, 9);
    assert.deepEqual(
      table.rows.map((r) => r.lots),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    );
    for (let i = 1; i < table.rows.length; i++) assert.ok(table.rows[i].newAvg < table.rows[i - 1].newAvg);
    near(table.rows[0].newAvg, 190);
    near(table.rows[0].extraCost, 65 * 170);
    near(table.rows[1].extraCost, 2 * 65 * 170);
    near(table.rows[0].lossIfZero, 130 * 200 + 65 * 170);
    near(table.rows[0].premiumRise, 190 - 170);
  });

  it("agrees with a single simulation for the same lots", () => {
    const table = buildLotsTable(p, m, 170, 9);
    for (const row of table.rows) {
      const r = simulateAveraging(p, m, planOf({ extraLots: row.lots }));
      near(row.newAvg, r.after.avgPrice, 1e-9);
      near(row.moveToday, r.scenarios.after[0].move as number, 1e-9);
      near(row.lossIfZero, r.after.capitalAtRisk, 1e-6);
    }
  });

  it("marks the first lot that improves the average by under 0.5%", () => {
    const table = buildLotsTable(p, m, 170, 9);
    let prev = 200;
    let expected: number | null = null;
    for (let k = 1; k <= 9 && expected === null; k++) {
      const avg = newAveragePrice(130, 200, k * LOT, 170);
      if ((prev - avg) / prev < MARGINAL_IMPROVEMENT) expected = k;
      prev = avg;
    }
    assert.ok(expected !== null && expected > 1);
    assert.equal(table.marginalLots, expected);
    for (const row of table.rows) {
      assert.equal(row.improvementPct / 100 < MARGINAL_IMPROVEMENT, row.lots >= (expected as number));
    }
  });

  it("calls the very first lot marginal when buying above the average", () => {
    const table = buildLotsTable(p, m, 210, 3);
    assert.equal(table.marginalLots, 1);
    assert.ok(table.rows.every((r) => r.improvementPct < 0));
  });

  it("is empty with no lots affordable or no price", () => {
    assert.deepEqual(buildLotsTable(p, m, 170, 0).rows, []);
    assert.deepEqual(buildLotsTable(p, m, null, 5).rows, []);
    assert.equal(buildLotsTable(p, m, 170, 0).marginalLots, null);
  });
});

describe("P&L ladder", () => {
  const p = position();
  const m = marketOf();

  it("runs −300 to +300 in 50-point steps for Nifty", () => {
    const rows = buildLadder(p, m, 1, 170);
    assert.deepEqual(
      rows.map((r) => r.offset),
      [-300, -250, -200, -150, -100, -50, 0, 50, 100, 150, 200, 250, 300],
    );
    assert.equal(LADDER_STEP.NIFTY, 50);
    near(rows[0].level, 23700);
    near(rows[12].level, 24300);
  });

  it("scales the step for the wider indices", () => {
    const rows = buildLadder(position({ instrument: "BANKNIFTY", lotSize: 30 }), m, 1, 170);
    assert.equal(rows[0].offset, -6 * LADDER_STEP.BANKNIFTY);
    assert.equal(rows[12].offset, 6 * LADDER_STEP.BANKNIFTY);
  });

  it("gives before and after P&L at expiry that match the closed form", () => {
    const rows = buildLadder(p, m, 1, 170);
    const top = rows[12];
    near(top.before.expiry, (300 - 200) * 130, 1e-6);
    near(top.after.expiry, (300 - 190) * 195, 1e-6);
    const bottom = rows[0];
    near(bottom.before.expiry, -130 * 200, 1e-6);
    near(bottom.after.expiry, -195 * 190, 1e-6);
  });

  it("matches the engine for Today at every row", () => {
    const { after } = buildLegs(p, 1, 170);
    for (const row of buildLadder(p, m, 1, 170)) {
      near(row.after.today, pnlAt(after, LOT, SPOT, NOW, row.level, NOW), 1e-9);
    }
  });

  it("carries a column for each available scenario only", () => {
    const rows = buildLadder(position({ expiry: "2026-11-04", avgPrice: 60 }), m, 1, 40);
    assert.deepEqual(Object.keys(rows[0].after).sort(), ["expiry", "today"]);
  });

  it("repeats Before in After when no lots are added", () => {
    const rows = buildLadder(p, m, 0, 170);
    for (const row of rows) assert.deepEqual(row.after, row.before);
  });
});

describe("warnings", () => {
  const ids = (r: ReturnType<typeof simulateAveraging>) => r.warnings.map((w) => w.id);

  it("is quiet for a sound, affordable average-down", () => {
    const p = position({ avgPrice: 200 });
    const r = simulateAveraging(p, marketOf({ ltp: modelValue(p) }), planOf({ funds: 500_000, buyPrice: 170 }));
    assert.deepEqual(ids(r), []);
  });

  it("notes when the model's price is far from the LTP, and not when it is close", () => {
    const p = position();
    const model = modelValue(p);
    assert.ok(!ids(simulateAveraging(p, marketOf({ ltp: model * 1.02 }), planOf())).includes("model-gap"));
    const far = simulateAveraging(p, marketOf({ ltp: model * 0.8 }), planOf());
    assert.ok(ids(far).includes("model-gap"));
    near(far.modelGap, model - model * 0.8, 1e-6);
    assert.equal(simulateAveraging(position({ lots: 0 }), marketOf(), planOf({ extraLots: 0 })).modelGap, null);
  });

  it("flags capital at risk beyond the limit, and respects an edited limit", () => {
    // 195 units × ₹190 = ₹37,050 against ₹100,000 funds → 37%.
    assert.ok(ids(simulateAveraging(position(), marketOf(), planOf())).includes("capital-at-risk"));
    assert.ok(!ids(simulateAveraging(position(), marketOf(), planOf({ riskLimitPct: 50 }))).includes("capital-at-risk"));
  });

  it("flags lots that exceed the funds as critical", () => {
    const r = simulateAveraging(position(), marketOf(), planOf({ funds: 5000 }));
    const w = r.warnings.find((x) => x.id === "exceeds-funds");
    assert.equal(w?.severity, "critical");
    assert.equal(r.maxAffordableLots, 0);
  });

  it("asks for funds instead of warning when none are set", () => {
    const r = simulateAveraging(position(), marketOf(), planOf({ funds: null }));
    assert.deepEqual(
      ids(r).filter((id) => id === "funds-unset" || id === "exceeds-funds" || id === "capital-at-risk"),
      ["funds-unset"],
    );
  });

  it("flags theta-heavy contracts at five days to expiry or fewer", () => {
    assert.ok(ids(simulateAveraging(position({ expiry: "2026-11-09" }), marketOf(), planOf())).includes("theta-heavy"));
    assert.ok(ids(simulateAveraging(position({ expiry: "2026-11-04" }), marketOf(), planOf())).includes("theta-heavy"));
    assert.ok(!ids(simulateAveraging(position({ expiry: "2026-11-10" }), marketOf(), planOf())).includes("theta-heavy"));
    assert.equal(simulateAveraging(position({ expiry: "2026-11-09" }), marketOf(), planOf()).dte, 5);
  });

  it("says the buy price is above the average instead of calling it averaging down", () => {
    const r = simulateAveraging(position(), marketOf({ ltp: 230 }), planOf({ buyPrice: 230 }));
    assert.ok(ids(r).includes("price-above-avg"));
    assert.ok(!ids(r).includes("marginal-improvement"));
  });

  it("flags a last lot that lowers the average by less than 0.5%", () => {
    assert.ok(!ids(simulateAveraging(position(), marketOf(), planOf({ extraLots: 1 }))).includes("marginal-improvement"));
    assert.ok(ids(simulateAveraging(position(), marketOf(), planOf({ extraLots: 8, funds: 500_000 }))).includes("marginal-improvement"));
  });

  it("notes a closed market and a paused feed, but not an open one", () => {
    assert.ok(!ids(simulateAveraging(position(), marketOf(), planOf())).includes("market-closed"));
    const saturday = Date.parse("2026-11-07T11:00:00+05:30");
    const closed = simulateAveraging(position(), marketOf({ nowMs: saturday }), planOf());
    assert.ok(ids(closed).includes("market-closed"));
    const paused = simulateAveraging(position(), marketOf({ stale: true }), planOf());
    assert.equal(paused.warnings.find((w) => w.id === "market-closed")?.title, "Live prices paused");
  });
});

describe("isMarketOpen", () => {
  it("is open 09:15–15:30 IST on weekdays", () => {
    assert.equal(isMarketOpen(Date.parse("2026-11-04T10:00:00+05:30")), true);
    assert.equal(isMarketOpen(Date.parse("2026-11-04T09:15:00+05:30")), true);
    assert.equal(isMarketOpen(Date.parse("2026-11-04T09:14:00+05:30")), false);
    assert.equal(isMarketOpen(Date.parse("2026-11-04T15:30:00+05:30")), false);
  });

  it("is closed at the weekend", () => {
    assert.equal(isMarketOpen(Date.parse("2026-11-07T11:00:00+05:30")), false);
    assert.equal(isMarketOpen(Date.parse("2026-11-08T11:00:00+05:30")), false);
  });
});

describe("simulationInputs", () => {
  function entry(over: Partial<TradeEntry> = {}): TradeEntry {
    return {
      id: "e1",
      user_id: null,
      entry_date: "2026-11-02",
      instrument: "NIFTY",
      strike_price: 24000,
      option_type: "CE",
      expiry_date: EXPIRY,
      closing_date: null,
      lots: 2,
      side: "buy",
      buy_price: 200,
      sell_price: 170,
      pnl: 0,
      status: "hold",
      remarks: null,
      created_at: "2026-11-02T04:00:00Z",
      updated_at: "2026-11-02T04:00:00Z",
      ...over,
    };
  }

  function row(over: Partial<PortfolioRow> = {}, entryOver: Partial<TradeEntry> = {}): PortfolioRow {
    return {
      entry: entry(entryOver),
      entryPrice: 200,
      status: "ok",
      instrumentKey: "NSE_FO|1",
      liveLtp: 170,
      livePnl: -3900,
      prevClose: 175,
      delta: 0.5,
      gamma: 0.0005,
      theta: -12,
      vega: 8,
      oi: 1000,
      iv: 14,
      volume: 500,
      underlyingSpot: SPOT,
      nearbyIv: 14,
      brokerageIfClosed: 40,
      stale: false,
      asOf: null,
      ...over,
    };
  }

  it("maps a live long option row, taking the lot size from the instrument", () => {
    const inputs = simulationInputs(row(), NOW);
    assert.ok(inputs);
    assert.equal(inputs.position.lotSize, 65);
    assert.equal(inputs.position.lots, 2);
    assert.equal(inputs.position.avgPrice, 200);
    assert.equal(inputs.position.iv, 14);
    assert.deepEqual(inputs.market, { spot: SPOT, ltp: 170 });
    assert.equal(simulationInputs(row({}, { instrument: "BANKNIFTY" }), NOW)?.position.lotSize, 30);
  });

  it("rejects what can't be simulated", () => {
    assert.equal(simulationInputs(row({}, { side: "sell" }), NOW), null);
    assert.equal(simulationInputs(row({}, { status: "squared_off" }), NOW), null);
    assert.equal(simulationInputs(row({ status: "no_match", liveLtp: null }), NOW), null);
    assert.equal(simulationInputs(row({ liveLtp: 0 }), NOW), null);
    assert.equal(simulationInputs(row({ underlyingSpot: null }), NOW), null);
    assert.equal(simulationInputs(row({}, { expiry_date: null }), NOW), null);
    assert.equal(simulationInputs(row({}, { expiry_date: "2026-11-03" }), NOW), null);
  });

  it("keeps a row showing last-known prices simulable", () => {
    assert.ok(simulationInputs(row({ stale: true, asOf: NOW - 60_000 }), NOW));
  });
});

describe("toAnalysisStrategy", () => {
  it("hands Analysis the position and the simulated purchase as two legs of one contract", () => {
    const s = toAnalysisStrategy(position(), 3, 170);
    assert.equal(s.instrument, "NIFTY");
    assert.equal(s.spotOverride, "");
    assert.equal(s.legs.length, 2);
    const [existing, added] = s.legs;
    assert.deepEqual(
      [existing.lots, existing.price, added.lots, added.price],
      [2, "200", 3, "170"],
    );
    for (const leg of s.legs) {
      assert.equal(leg.side, "buy");
      assert.equal(leg.type, "CE");
      assert.equal(leg.strike, 24000);
      assert.equal(leg.expiry, EXPIRY);
      assert.equal(leg.enabled, true);
    }
    assert.notEqual(existing.id, added.id);
  });

  it("makes Analysis show the same break-even as the drawer", () => {
    const sim = simulateAveraging(position(), marketOf(), planOf({ extraLots: 3 }));
    const { legs } = toAnalysisStrategy(position(), 3, 170);
    // Analysis's own conversion: price text → number, the strike's chain IV.
    const strategy: StrategyLeg[] = legs.map((l) => ({
      id: l.id,
      enabled: l.enabled,
      side: l.side,
      type: l.type,
      strike: l.strike,
      expiry: l.expiry,
      lots: l.lots,
      price: Number(l.price),
      chainIv: 14,
    }));
    const metrics = analyzeStrategy(priceLegs(strategy, SPOT, NOW, LOT), SPOT, NOW);
    assert.ok(metrics);
    near(metrics.breakevens[0], sim.after.breakevenLevel as number, 1e-9);
    assert.equal(metrics.maxLoss, sim.after.maxLoss);
    assert.equal(metrics.pop, sim.after.pop);
  });
});
