import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normCdf } from "@/lib/calculateRisk";
import {
  barrierOdds,
  bestFit,
  bestForRatio,
  breakEvenWinRate,
  buildLeaderboard,
  buildSetups,
  daysToFit,
  EVEN_BAND,
  expectedMovePct,
  fitOf,
  HORIZONS,
  INTRADAY_SCALES,
  INTRADAY_STARTS,
  LEADERBOARD_RATIOS,
  NOISE_INTRADAY,
  pairLabel,
  RATIOS,
  REACH_MIN,
  rrrLabel,
  SESSION_HOURS,
  standingOf,
  STOP_SCALES,
  TIGHT_STOP_DAY1,
  type Barrier,
  type Setup,
} from "@/lib/rrrPlanner";

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// --- an independent check: simulate the walk ------------------------------------------------------

/** A seeded uniform generator (mulberry32), so the simulation gives the same answer every run. */
function uniform(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Random-walk the trade many times, in small steps, and count how each ends. Checking only at steps misses
 * walls crossed between steps, so the walls are brought in by 0.5826 step-sizes (Broadie-Glasserman) to make up.
 * A trade that reaches a wall books exactly the target or the stop; one still open at the end books where it stands.
 */
function simulate(sigma: number, stopPct: number, targetPct: number, days: number, noiseDays = 1, paths = 20000): Barrier {
  const rand = uniform(12345);
  const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
  const perDay = 60;
  const dt = 1 / perDay;
  const step = sigma * Math.sqrt(dt);
  const lower = -(stopPct / 100) + 0.5826 * step;
  const upper = targetPct / 100 - 0.5826 * step;
  const steps = Math.round(days * perDay);
  let win = 0;
  let loss = 0;
  let stopEarly = 0;
  let time = 0;
  let ups = 0;
  let upSum = 0;
  let downs = 0;
  let downSum = 0;
  for (let p = 0; p < paths; p++) {
    let x = 0;
    let t = days;
    let result: number | null = null;
    for (let k = 1; k <= steps; k++) {
      x += step * normal();
      if (x >= upper) {
        win++;
        result = targetPct;
        t = k * dt;
        break;
      }
      if (x <= lower) {
        loss++;
        result = -stopPct;
        t = k * dt;
        if (t <= noiseDays) stopEarly++;
        break;
      }
    }
    const pnl = result ?? x * 100;
    if (pnl > 0) {
      ups++;
      upSum += pnl;
    } else if (pnl < 0) {
      downs++;
      downSum -= pnl;
    }
    time += t;
  }
  return {
    win: win / paths,
    loss: loss / paths,
    open: 1 - (win + loss) / paths,
    days: time / paths,
    stopEarly: stopEarly / paths,
    endsUp: ups / paths,
    endsDown: downs / paths,
    avgWin: ups ? upSum / ups : 0,
    avgLoss: downs ? downSum / downs : 0,
  };
}

describe("barrierOdds against a simulation", () => {
  for (const c of [
    { name: "2% : 4% on a 0.8% day, held 5 days", sigma: 0.008, stop: 2, target: 4, days: 5, noise: 1 },
    { name: "1.5% : 3% on a 1.2% day, held 10 days", sigma: 0.012, stop: 1.5, target: 3, days: 10, noise: 1 },
    { name: "3% : 3% on a 1% day, held 8 days", sigma: 0.01, stop: 3, target: 3, days: 8, noise: 1 },
    { name: "0.5% : 1% on a 0.75% session, held to the close", sigma: 0.0075, stop: 0.5, target: 1, days: 1, noise: NOISE_INTRADAY },
    { name: "0.5% : 0.25% on a 0.75% session, started at 12:00", sigma: 0.0075, stop: 0.5, target: 0.25, days: 0.56, noise: NOISE_INTRADAY },
  ]) {
    it(`agrees for ${c.name}`, () => {
      const exact = barrierOdds({ dailySigma: c.sigma, stopPct: c.stop, targetPct: c.target, days: c.days, noiseDays: c.noise });
      const sim = simulate(c.sigma, c.stop, c.target, c.days, c.noise);
      assert.ok(Math.abs(exact.win - sim.win) < 0.015, `win ${exact.win} vs ${sim.win}`);
      assert.ok(Math.abs(exact.loss - sim.loss) < 0.015, `loss ${exact.loss} vs ${sim.loss}`);
      assert.ok(Math.abs(exact.open - sim.open) < 0.02, `open ${exact.open} vs ${sim.open}`);
      assert.ok(Math.abs(exact.days - sim.days) < 0.1 * Math.max(c.days, 1), `days ${exact.days} vs ${sim.days}`);
      assert.ok(Math.abs(exact.stopEarly - sim.stopEarly) < 0.015, `stopEarly ${exact.stopEarly} vs ${sim.stopEarly}`);
      assert.ok(Math.abs(exact.endsUp - sim.endsUp) < 0.015, `endsUp ${exact.endsUp} vs ${sim.endsUp}`);
      assert.ok(Math.abs(exact.endsDown - sim.endsDown) < 0.015, `endsDown ${exact.endsDown} vs ${sim.endsDown}`);
      assert.ok(Math.abs(exact.avgWin - sim.avgWin) < 0.06 * sim.avgWin + 0.01, `avgWin ${exact.avgWin} vs ${sim.avgWin}`);
      assert.ok(Math.abs(exact.avgLoss - sim.avgLoss) < 0.06 * sim.avgLoss + 0.01, `avgLoss ${exact.avgLoss} vs ${sim.avgLoss}`);
    });
  }
});

describe("barrierOdds", () => {
  const base = { dailySigma: 0.008, stopPct: 2, targetPct: 4, days: 5 };

  it("always accounts for every trade: win + loss + still open = 1, and every trade ends up or down", () => {
    for (const stopPct of STOP_SCALES) {
      for (const rrr of RATIOS) {
        for (const days of HORIZONS) {
          const o = barrierOdds({ ...base, stopPct, targetPct: stopPct * rrr, days });
          near(o.win + o.loss + o.open, 1, 1e-9);
          near(o.endsUp + o.endsDown, 1, 1e-9);
          assert.ok(o.win >= 0 && o.loss >= 0 && o.open >= 0);
          assert.ok(o.endsUp >= o.win - 1e-12 && o.endsDown >= o.loss - 1e-12, "a trade that hit a wall ended on that side");
        }
      }
    }
  });

  it("with all the time in the world wins exactly as often as the pair needs to break even", () => {
    for (const rrr of RATIOS) {
      const o = barrierOdds({ ...base, targetPct: 2 * rrr, days: 100000 });
      near(o.win, 1 / (1 + rrr), 1e-6);
      near(o.loss, rrr / (1 + rrr), 1e-6);
      near(o.open, 0, 1e-6);
      // Nothing is left open, so a win is the full target and a loss the full stop.
      near(o.endsUp, 1 / (1 + rrr), 1e-6);
      near(o.avgWin, 2 * rrr, 1e-4);
      near(o.avgLoss, 2, 1e-4);
    }
  });

  it("pays out as much in wins as it takes in losses - no edge in a fair market", () => {
    for (const days of [0.32, 1, 3, 5, 10, 20]) {
      for (const [stopPct, targetPct] of [[2, 4], [1, 3], [0.5, 0.25], [3, 3]]) {
        const o = barrierOdds({ ...base, stopPct, targetPct, days });
        near(o.endsUp * o.avgWin, o.endsDown * o.avgLoss, 1e-9);
      }
    }
  });

  it("takes stop × target ÷ variance days to finish, given all the time it wants", () => {
    near(barrierOdds({ ...base, days: 100000 }).days, (0.02 * 0.04) / (0.008 * 0.008), 1e-3);
  });

  it("never lasts longer than the holding period", () => {
    for (const days of [0.32, ...HORIZONS]) assert.ok(barrierOdds({ ...base, days }).days <= days + 1e-9);
  });

  it("is even-handed when the stop and the target are the same distance away", () => {
    const o = barrierOdds({ ...base, stopPct: 2, targetPct: 2 });
    near(o.win, o.loss, 1e-9);
    near(o.endsUp, 0.5, 1e-9);
    near(o.avgWin, o.avgLoss, 1e-9);
  });

  it("gets the chance ordinary noise stops you out right: twice the odds of the window ending below the stop", () => {
    // With the target far away, the chance of touching -2% inside one day is 2 × P(the day ends below -2%).
    const day = barrierOdds({ dailySigma: 0.008, stopPct: 2, targetPct: 30, days: 5 });
    near(day.stopEarly, 2 * normCdf(-0.02 / 0.008), 5e-4);
    // For an intraday trade the window is its first hour: a shorter stretch, so a stop of the same size is safer in it.
    const hour = barrierOdds({ dailySigma: 0.0075, stopPct: 0.5, targetPct: 30, days: 1, noiseDays: NOISE_INTRADAY });
    near(hour.stopEarly, 2 * normCdf(-0.005 / (0.0075 * Math.sqrt(NOISE_INTRADAY))), 5e-4);
    const whole = barrierOdds({ dailySigma: 0.0075, stopPct: 0.5, targetPct: 30, days: 1 });
    assert.ok(hour.stopEarly < whole.stopEarly);
  });

  it("has more trades finish the longer you wait, and the more the market moves", () => {
    const open = (p: Partial<typeof base>) => barrierOdds({ ...base, ...p }).open;
    assert.ok(open({ days: 10 }) < open({ days: 5 }) && open({ days: 20 }) < open({ days: 10 }));
    assert.ok(open({ dailySigma: 0.012 }) < open({ dailySigma: 0.008 }));
    assert.ok(open({ targetPct: 8 }) > open({ targetPct: 4 }));
  });

  it("stops you out early more often when the stop is tight or the market jumpy", () => {
    const early = (p: Partial<typeof base>) => barrierOdds({ ...base, ...p }).stopEarly;
    assert.ok(early({ stopPct: 1 }) > early({ stopPct: 2 }) && early({ stopPct: 2 }) > early({ stopPct: 3 }));
    assert.ok(early({ dailySigma: 0.012 }) > early({ dailySigma: 0.008 }));
  });

  it("leaves every trade open in a market that never moves, ending where it began", () => {
    assert.deepEqual(barrierOdds({ ...base, dailySigma: 0 }), { win: 0, loss: 0, open: 1, days: 5, stopEarly: 0, endsUp: 0, endsDown: 0, avgWin: 0, avgLoss: 0 });
  });
});

// --- winning more often is not making more ----------------------------------------------------------

describe("standingOf", () => {
  const at = (endsUp: number) => standingOf({ win: 0, loss: 0, open: 0, days: 0, stopEarly: 0, endsUp, endsDown: 1 - endsUp, avgWin: 0, avgLoss: 0 });

  it("calls a pair that ends in profit clearly more often than not a winner, clearly less often a loser, otherwise even", () => {
    assert.equal(at(0.5 + EVEN_BAND), "wins");
    assert.equal(at(0.7), "wins");
    assert.equal(at(0.5 + EVEN_BAND - 0.01), "even");
    assert.equal(at(0.5), "even");
    assert.equal(at(0.5 - EVEN_BAND + 0.01), "even");
    assert.equal(at(0.5 - EVEN_BAND), "loses");
    assert.equal(at(0.2), "loses");
  });
});

describe("buildLeaderboard", () => {
  const input = { dailySigma: 0.0075, days: 1, noiseDays: NOISE_INTRADAY, stopPct: 0.5 };

  it("runs from the RRR most likely to end in profit to the one most likely to end in a loss", () => {
    const rows = buildLeaderboard(input);
    assert.deepEqual(rows.map((r) => r.rrr), LEADERBOARD_RATIOS);
    for (let i = 1; i < rows.length; i++) assert.ok(rows[i - 1].odds.endsUp >= rows[i].odds.endsUp - 1e-12);
    assert.equal(rows[0].standing, "wins");
    assert.equal(rows[rows.length - 1].standing, "loses");
  });

  it("puts a reward smaller than the risk first - it wins most often, but each win is smaller than each loss", () => {
    const [first] = buildLeaderboard(input);
    assert.equal(first.rrr, 0.5);
    assert.ok(first.odds.endsUp > 0.6);
    assert.ok(first.odds.avgWin < first.odds.avgLoss);
    assert.equal(first.targetPct, 0.25);
  });

  it("and shows the biggest reward last: it loses most often, but each win is bigger than each loss", () => {
    const rows = buildLeaderboard(input);
    const last = rows[rows.length - 1];
    assert.equal(last.rrr, 3);
    assert.ok(last.odds.endsDown > 0.55);
    assert.ok(last.odds.avgWin > last.odds.avgLoss);
  });

  it("makes no more on average from either end: chance × typical win equals chance × typical loss", () => {
    for (const r of buildLeaderboard(input)) near(r.odds.endsUp * r.odds.avgWin, r.odds.endsDown * r.odds.avgLoss, 1e-9);
  });

  it("finds that a target past what a session usually reaches adds nothing to the odds - only to how rarely it is hit", () => {
    const rows = buildLeaderboard(input);
    const two = rows.find((r) => r.rrr === 2)!;
    const three = rows.find((r) => r.rrr === 3)!;
    near(two.odds.endsUp, three.odds.endsUp, 0.02);
    assert.ok(two.odds.win > 2 * three.odds.win, "yet the 1:2 target is hit several times as often");
  });

  it("takes the RRRs it is asked for", () => {
    assert.deepEqual(buildLeaderboard({ ...input, ratios: [1, 4] }).map((r) => r.rrr), [1, 4]);
  });
});

// --- the setups -------------------------------------------------------------------------------------

describe("buildSetups", () => {
  const input = { dailySigma: 0.008, days: 5 };

  it("tries every usual stop at every usual RRR, smallest stop first, and each pair's target is stop × RRR", () => {
    const s = buildSetups(input);
    assert.equal(s.length, STOP_SCALES.length * RATIOS.length);
    for (let i = 1; i < s.length; i++) assert.ok(s[i].stopPct > s[i - 1].stopPct || (s[i].stopPct === s[i - 1].stopPct && s[i].rrr > s[i - 1].rrr));
    for (const x of s) near(x.targetPct, x.stopPct * x.rrr, 1e-9);
  });

  it("includes the pairs people actually talk about: 2% : 4% and 5% : 10%", () => {
    const labels = buildSetups(input).map((x) => pairLabel(x.stopPct, x.targetPct));
    assert.ok(labels.includes("2% : 4%") && labels.includes("5% : 10%") && labels.includes("2% : 6%"));
  });

  it("adds a stop of your own, marked, and doesn't repeat one that is already there", () => {
    const withOwn = buildSetups({ ...input, customStopPct: 2.5 });
    assert.equal(withOwn.length, (STOP_SCALES.length + 1) * RATIOS.length);
    assert.deepEqual([...new Set(withOwn.filter((x) => x.custom).map((x) => x.stopPct))], [2.5]);
    assert.equal(buildSetups({ ...input, customStopPct: 2 }).length, STOP_SCALES.length * RATIOS.length);
    assert.equal(buildSetups({ ...input, customStopPct: 0 }).length, STOP_SCALES.length * RATIOS.length);
    assert.equal(buildSetups({ ...input, customStopPct: null }).length, STOP_SCALES.length * RATIOS.length);
  });

  it("carries the break-even win rate and how far the stop is in normal moves", () => {
    const x = buildSetups(input).find((s) => s.stopPct === 2 && s.rrr === 2)!;
    near(x.breakEvenWin, 1 / 3);
    near(x.stopInMoves, 2.5);
    near(x.reach, x.odds.win / x.breakEvenWin);
  });

  it("takes its own sizes and RRRs, as the intraday view does", () => {
    const s = buildSetups({ dailySigma: 0.0075, days: 1, noiseDays: NOISE_INTRADAY, scales: INTRADAY_SCALES, ratios: [1, 2] });
    assert.equal(s.length, INTRADAY_SCALES.length * 2);
    assert.ok(s.map((x) => pairLabel(x.stopPct, x.targetPct)).includes("0.5% : 1%"));
    assert.ok(!s.some((x) => x.stopPct >= 2));
  });
});

describe("fitOf", () => {
  const odds = (over: Partial<Barrier>): Barrier => ({ win: 0.3, loss: 0.5, open: 0.2, days: 3, stopEarly: 0.02, endsUp: 0.4, endsDown: 0.6, avgWin: 1, avgLoss: 1, ...over });

  it("calls a stop that ordinary movement takes out too tight", () => {
    assert.equal(fitOf(odds({ stopEarly: TIGHT_STOP_DAY1 }), 1 / 3), "tight");
    assert.equal(fitOf(odds({ stopEarly: TIGHT_STOP_DAY1 - 0.01 }), 1 / 3), "fits");
  });

  it("calls a pair too slow when too little of the win rate it needs arrives in time", () => {
    const needs = 1 / 3;
    assert.equal(fitOf(odds({ win: needs * REACH_MIN - 0.01 }), needs), "slow");
    assert.equal(fitOf(odds({ win: needs * REACH_MIN + 0.01 }), needs), "fits");
  });

  it("says too tight first when it is both", () => {
    assert.equal(fitOf(odds({ stopEarly: 0.3, win: 0.01 }), 1 / 3), "tight");
  });
});

describe("what fits a market, for a 0.8% a day index (about 12.7% a year)", () => {
  const at = (days: number, dailySigma = 0.008) => buildSetups({ dailySigma, days });
  const label = (s: Setup | null) => (s ? `${pairLabel(s.stopPct, s.targetPct)} (${rrrLabel(s.rrr)})` : null);

  it("holding a week, only a small 1:1 plays out - 1:2 and 1:3 don't have time", () => {
    const s = at(5);
    assert.equal(label(bestFit(s)), "1.5% : 1.5% (1:1)");
    const pair = (stop: number, rrr: number) => s.find((x) => x.stopPct === stop && x.rrr === rrr)!;
    assert.equal(pair(2, 2).fit, "slow"); // 2% : 4% needs a 4% move inside five days
    assert.equal(pair(2, 3).fit, "slow");
    assert.equal(pair(5, 2).fit, "slow"); // 5% : 10% essentially never gets there
    assert.ok(pair(5, 2).odds.win < 0.005);
    assert.equal(pair(1, 1).fit, "tight"); // a 1% stop is hit by an ordinary day a fifth of the time
  });

  it("holding a month, the same market can carry a bigger reward for the risk", () => {
    const s = at(20);
    assert.equal(label(bestFit(s)), "1.5% : 4.5% (1:3)");
    assert.equal(label(bestForRatio(s, 2)), "2% : 4% (1:2)");
    assert.equal(bestFit(s)!.fit, "fits");
  });

  it("a jumpier market needs a wider stop; a calmer one allows a tighter stop", () => {
    assert.equal(label(bestFit(at(5, 0.014))), "3% : 3% (1:1)");
    assert.equal(label(bestFit(at(10, 0.0045))), "1% : 1% (1:1)");
  });

  it("finds nothing that fits when the market barely moves for the time you have", () => {
    assert.equal(bestFit(at(1, 0.001)), null);
  });
});

describe("the bigger, positional pairs: 4% : 8% and 5% : 10%", () => {
  const pair = (dailySigma: number, days: number, stop: number, rrr: number) => buildSetups({ dailySigma, days }).find((s) => s.stopPct === stop && s.rrr === rrr)!;

  it("offers a 4% stop and holds of 40 and 60 days, so these pairs can be judged at all", () => {
    assert.ok(STOP_SCALES.includes(4) && STOP_SCALES.includes(5));
    assert.ok(HORIZONS.includes(40) && HORIZONS.includes(60));
    assert.ok(buildSetups({ dailySigma: 0.0086, days: 60 }).map((s) => pairLabel(s.stopPct, s.targetPct)).includes("4% : 8%"));
  });

  it("don't work for an index like Nifty (0.86% a day) over weeks - 4% : 8% needs about three months", () => {
    for (const days of [5, 10, 20, 40]) assert.equal(pair(0.0086, days, 4, 2).fit, "slow", `${days} days`);
    assert.equal(pair(0.0086, 60, 4, 2).fit, "fits");
    // 8% is not a move the index makes in a few weeks: the target is hit under 5% of the time inside a month.
    assert.ok(pair(0.0086, 20, 4, 2).odds.win < 0.05);
  });

  it("and 5% : 10% doesn't fit an index even in three months", () => {
    for (const days of HORIZONS) assert.notEqual(pair(0.0086, days, 5, 2).fit, "fits", `${days} days`);
  });

  it("work for a stock that moves 1.6% a day: 4% : 8% from about a month, 5% : 10% from about two", () => {
    assert.equal(pair(0.016, 10, 4, 2).fit, "slow");
    assert.equal(pair(0.016, 20, 4, 2).fit, "fits");
    assert.equal(pair(0.016, 20, 5, 2).fit, "slow");
    assert.equal(pair(0.016, 40, 5, 2).fit, "fits");
  });

  it("are the right size for a very jumpy stock (2.5% a day) only at 5%: a 4% stop is inside its ordinary noise", () => {
    assert.equal(pair(0.025, 20, 4, 2).fit, "tight");
    assert.equal(pair(0.025, 20, 5, 2).fit, "fits");
  });

  it("let the index carry 1:3 at a wider stop the longer you hold: 2% : 6% for 40 days, 3% : 9% for 60", () => {
    const best = (days: number) => bestFit(buildSetups({ dailySigma: 0.0086, days }))!;
    assert.equal(`${pairLabel(best(40).stopPct, best(40).targetPct)} ${rrrLabel(best(40).rrr)}`, "2% : 6% 1:3");
    assert.equal(`${pairLabel(best(60).stopPct, best(60).targetPct)} ${rrrLabel(best(60).rrr)}`, "3% : 9% 1:3");
  });

  it("rank a 4% stop from 1:0.5 down to 1:3 over three months: the small target wins most often, 1:1.5 and up lose more often", () => {
    const rows = buildLeaderboard({ dailySigma: 0.0086, days: 60, stopPct: 4 });
    assert.equal(rows[0].rrr, 0.5);
    assert.equal(rows[0].standing, "wins");
    assert.equal(rows.find((r) => r.rrr === 1)!.standing, "even");
    for (const rrr of [1.5, 2, 3]) assert.equal(rows.find((r) => r.rrr === rrr)!.standing, "loses");
    // The wins of the often-winning end are small and the losses big, and the other way round at the far end.
    assert.ok(rows[0].odds.avgWin < rows[0].odds.avgLoss);
    assert.ok(rows[rows.length - 1].odds.avgWin > rows[rows.length - 1].odds.avgLoss);
  });
});

describe("what fits a trade that is out by the close, for a 0.75% a session index", () => {
  const intraday = (left: number, sigma = 0.0075) => buildSetups({ dailySigma: sigma, days: left, noiseDays: NOISE_INTRADAY, scales: INTRADAY_SCALES });
  const label = (s: Setup | null) => (s ? `${pairLabel(s.stopPct, s.targetPct)} (${rrrLabel(s.rrr)})` : null);

  it("with the whole session ahead, a stop under half a percent is inside the first hour's noise", () => {
    const s = intraday(1);
    assert.ok(s.filter((x) => x.stopPct <= 0.25).every((x) => x.fit === "tight"));
    assert.equal(s.find((x) => x.stopPct === 0.5 && x.rrr === 1)!.fit, "fits");
  });

  it("picks a 1:1 at about 0.75% for a full session, because a 1:2 target isn't reached in time", () => {
    const s = intraday(1);
    assert.equal(label(bestFit(s)), "0.75% : 0.75% (1:1)");
    const half = s.find((x) => x.stopPct === 0.5 && x.rrr === 2)!;
    assert.equal(half.fit, "slow");
    assert.ok(half.odds.win < 0.2 && half.odds.loss > 0.45);
  });

  it("finds less and less fits the later in the day the trade starts", () => {
    const fits = (left: number) => intraday(left).filter((x) => x.fit === "fits").length;
    assert.ok(fits(1) > fits(0.56));
    assert.ok(fits(0.56) >= fits(0.32));
    assert.equal(bestFit(intraday(0.32)), null);
  });

  it("allows a wider stop on a jumpier day", () => {
    const calm = bestFit(intraday(1, 0.005))!;
    const wild = bestFit(intraday(1, 0.012))!;
    assert.ok(wild.stopPct > calm.stopPct);
  });

  it("offers start times that share out the 6¼-hour session", () => {
    assert.equal(SESSION_HOURS, 6.25);
    assert.deepEqual(INTRADAY_STARTS.map((s) => s.left), [1, 0.8, 0.56, 0.32]);
    // 10:30 leaves 5 of the 6¼ hours; 12:00 leaves 3½; 1:30 pm leaves 2.
    near(INTRADAY_STARTS[1].left, 5 / SESSION_HOURS);
    near(INTRADAY_STARTS[2].left, 3.5 / SESSION_HOURS);
    near(INTRADAY_STARTS[3].left, 2 / SESSION_HOURS);
  });
});

describe("bestFit", () => {
  const fake = (stopPct: number, rrr: number, fit: Setup["fit"]): Setup => ({
    stopPct,
    targetPct: stopPct * rrr,
    rrr,
    breakEvenWin: 1 / (1 + rrr),
    stopInMoves: 2,
    reach: 1,
    odds: { win: 0.3, loss: 0.5, open: 0.2, days: 3, stopEarly: 0.01, endsUp: 0.4, endsDown: 0.6, avgWin: 1, avgLoss: 1 },
    fit,
    standing: "loses",
    custom: false,
  });

  it("prefers the bigger reward for the risk, then the wider stop, and only among pairs that fit", () => {
    const s = [fake(5, 3, "slow"), fake(2, 2, "fits"), fake(3, 2, "fits"), fake(1, 3, "tight"), fake(1.5, 1, "fits")];
    assert.deepEqual(bestFit(s), s[2]); // 3% : 6% - the biggest RRR that fits, at its widest stop
  });

  it("is null when nothing fits", () => {
    assert.equal(bestFit([fake(1, 1, "tight"), fake(5, 3, "slow")]), null);
    assert.equal(bestFit([]), null);
  });
});

describe("bestForRatio", () => {
  it("is the widest stop that fits at that RRR", () => {
    const s = buildSetups({ dailySigma: 0.008, days: 20 });
    const best = bestForRatio(s, 1)!;
    assert.equal(best.fit, "fits");
    assert.ok(s.filter((x) => x.rrr === 1 && x.fit === "fits").every((x) => x.stopPct <= best.stopPct));
  });

  it("when none fits, is the one that comes closest rather than nothing", () => {
    const s = buildSetups({ dailySigma: 0.008, days: 5 }).filter((x) => x.rrr === 3);
    const best = bestForRatio(s, 3)!;
    assert.notEqual(best.fit, "fits");
    assert.equal(best.rrr, 3);
  });

  it("is null for an RRR that isn't in the list", () => {
    assert.equal(bestForRatio(buildSetups({ dailySigma: 0.008, days: 5 }), 7), null);
  });
});

describe("daysToFit", () => {
  it("is the shortest holding period at which an RRR finds a stop that fits", () => {
    assert.equal(daysToFit(0.008, 1), 5);
    assert.equal(daysToFit(0.008, 2), 10);
    assert.equal(daysToFit(0.008, 3), 20);
  });

  it("takes longer in a calmer market, and is null when no period on offer is long enough", () => {
    assert.ok(daysToFit(0.0045, 2)! > daysToFit(0.008, 2)!);
    assert.equal(daysToFit(0.0005, 3), null);
  });
});

describe("labels and small helpers", () => {
  it("writes an RRR risk first, and a pair as stop then target", () => {
    assert.equal(rrrLabel(2), "1:2");
    assert.equal(rrrLabel(1.5), "1:1.5");
    assert.equal(rrrLabel(0.5), "1:0.5");
    assert.equal(pairLabel(2, 4), "2% : 4%");
    assert.equal(pairLabel(1.5, 4.5), "1.5% : 4.5%");
    assert.equal(pairLabel(0.5, 0.25), "0.5% : 0.25%");
  });

  it("breaks even at 1 ÷ (1 + RRR)", () => {
    near(breakEvenWinRate(1), 0.5);
    near(breakEvenWinRate(2), 1 / 3);
    near(breakEvenWinRate(3), 0.25);
  });

  it("puts the usual wander over the holding period at one daily move × √days", () => {
    near(expectedMovePct(0.008, 5), 0.8 * Math.sqrt(5));
    near(expectedMovePct(0.008, 1), 0.8);
  });
});
