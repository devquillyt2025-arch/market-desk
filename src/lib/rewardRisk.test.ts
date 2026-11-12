import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { evaluate, type Evaluated } from "@/lib/whatIf";
import {
  LONG_SHOT_POP,
  rankByRewardRisk,
  ratioLabel,
  rewardRisk,
  runRewardRisk,
  structureKey,
  type Idea,
  type RewardRiskLab,
} from "@/lib/rewardRisk";
import { longCall, ltpOf, near, setup, shortCall } from "@/lib/whatIfFixtures";

/** The lab for a book (or for nothing, in "alone" scope) on the fixture chain. */
function lab(scope: "book" | "alone", rows = [longCall()], funds: number | null = null): RewardRiskLab {
  return runRewardRisk({ ...setup(rows, funds), scope });
}

/** The idea whose headline and detail contain every one of `parts`. */
function find(l: RewardRiskLab, ...parts: string[]): Idea {
  const idea = l.ideas.find((i) => parts.every((p) => `${i.move.action.headline} | ${i.move.action.detail}`.includes(p)));
  assert.ok(idea, `no idea matching ${parts.join(" + ")}`);
  return idea;
}

// --- reward and risk of one outcome ------------------------------------------------------------

describe("rewardRisk", () => {
  const flat = evaluate([]);

  it("is the most you can make over the most you can lose when both are capped", () => {
    const spread = find(lab("alone"), "Bull call spread", "Sell 24200 / buy 24100 CE");
    const o = spread.move.outcome;
    assert.equal(spread.rr.rewardIsEstimate, false);
    assert.equal(spread.rr.reward, o.maxProfit);
    assert.equal(spread.rr.risk, o.maxLoss);
    near(spread.rr.ratio, (o.maxProfit as number) / (o.maxLoss as number));
    // A 100-point spread bought for the difference of the two prices: the ratio is (100 - debit) / debit, give or take brokerage.
    const debit = ltpOf(24100, true) - ltpOf(24200, true);
    near(spread.rr.ratio, (100 - debit) / debit, 0.15 * ((100 - debit) / debit));
  });

  it("stands the 1-in-20 good case in for a profit with no cap, and says so", () => {
    const call = find(lab("alone"), "Buy 1 lot of calls", "Nifty 24100 CE");
    assert.equal(call.move.outcome.maxProfit, null);
    assert.equal(call.rr.rewardIsEstimate, true);
    assert.equal(call.rr.reward, call.move.outcome.p95);
    // Risk is what the buy costs: the premium plus charges.
    near(call.rr.risk as number, call.move.outlay, 1);
    near(call.rr.ratio, call.rr.reward / (call.rr.risk as number));
  });

  it("does the same for a long put, whose 'maximum' only exists if the index went to zero", () => {
    const put = find(lab("alone"), "Buy 1 lot of puts", "Nifty 23900 PE");
    assert.ok(put.move.outcome.maxProfit !== null && put.move.outcome.maxProfit > 1_000_000);
    assert.equal(put.rr.rewardIsEstimate, true);
    assert.equal(put.rr.reward, put.move.outcome.p95);
  });

  it("has no ratio for a loss with no practical ceiling", () => {
    const l = lab("alone");
    const nakedCall = find(l, "Sell 1 lot of calls", "Nifty 24100 CE");
    assert.equal(nakedCall.rr.risk, null);
    assert.equal(nakedCall.rr.ratio, 0);
    // A sold put is capped only by the index reaching zero - no ceiling anyone can plan around.
    const nakedPut = find(l, "Sell 1 lot of puts", "Nifty 23900 PE");
    assert.equal(nakedPut.move.outcome.worstIsRemote, true);
    assert.equal(nakedPut.rr.risk, null);
    assert.equal(nakedPut.rr.ratio, 0);
  });

  it("is infinite when there is something to win and nothing to lose", () => {
    const rr = rewardRisk({ ...flat, maxLoss: 0, maxProfit: 500, p95: 500 });
    assert.equal(rr.ratio, Infinity);
    assert.equal(rr.risk, 0);
    // A loss of a rupee or two is rounding, not a risk to divide by.
    assert.equal(rewardRisk({ ...flat, maxLoss: 0.4, maxProfit: 500, p95: 500 }).ratio, Infinity);
  });

  it("is zero, not infinite, when there is nothing to win either", () => {
    assert.equal(rewardRisk({ ...flat, maxLoss: 0, maxProfit: 0, p95: 0 }).ratio, 0);
    assert.equal(rewardRisk({ ...flat, maxLoss: 300, maxProfit: 0, p95: -20 }).ratio, 0);
  });

  it("never reports a negative reward", () => {
    const rr = rewardRisk({ ...flat, maxLoss: 300, maxProfit: null, p95: -40 });
    assert.equal(rr.reward, 0);
    assert.equal(rr.ratio, 0);
  });
});

describe("ratioLabel", () => {
  it("reads as reward per ₹1 of risk, with words where a ratio would mislead", () => {
    assert.equal(ratioLabel({ risk: 1000, ratio: 3.44 }), "3.4 : 1");
    assert.equal(ratioLabel({ risk: 1000, ratio: 0.25 }), "0.3 : 1");
    assert.equal(ratioLabel({ risk: 1000, ratio: 12.4 }), "12 : 1");
    assert.equal(ratioLabel({ risk: 1000, ratio: 480 }), "100+ : 1");
    assert.equal(ratioLabel({ risk: 0, ratio: Infinity }), "No loss");
    assert.equal(ratioLabel({ risk: null, ratio: 0 }), "No cap");
  });
});

// --- one idea, whatever its size -----------------------------------------------------------------

describe("structureKey", () => {
  it("drops the lot count, so one idea at several sizes is one idea", () => {
    assert.equal(structureKey({ family: "buy", id: "buy:CE:24100:4" }), "buy:CE:24100");
    assert.equal(structureKey({ family: "spread", id: "spread:CE:debit:24100:24200:2" }), "spread:CE:debit:24100:24200");
    assert.equal(structureKey({ family: "reduce", id: "reduce:e7:3" }), "reduce:e7");
    assert.equal(structureKey({ family: "add", id: "add:e7:1" }), "add:e7");
  });

  it("leaves whole-book moves alone - they have no size", () => {
    assert.equal(structureKey({ family: "book", id: "book:halve" }), "book:halve");
  });
});

// --- the lab ---------------------------------------------------------------------------------------

describe("runRewardRisk", () => {
  it("shows each kind of idea once, not once per size", () => {
    const keys = lab("alone").ideas.map((i) => structureKey(i.move.action));
    assert.equal(new Set(keys).size, keys.length);
    assert.ok(keys.length > 20);
  });

  it("shows the cheapest size when sizes are equally good - the ratio doesn't depend on how many lots", () => {
    const spread = find(lab("alone"), "Bull call spread", "Sell 24200 / buy 24100 CE");
    assert.match(spread.move.action.headline, /· 1 lot$/);
  });

  it("measures each idea on its own in 'alone' scope, whatever you hold", () => {
    const a = lab("alone", [longCall()]);
    const b = lab("alone", [shortCall()]);
    assert.equal(a.book.legs.length, 0);
    assert.equal(a.baseRr.ratio, 0);
    const ratios = (l: RewardRiskLab) => l.ideas.map((i) => `${i.move.action.id}=${i.rr.ratio.toFixed(6)}`).sort();
    assert.deepEqual(ratios(a), ratios(b));
  });

  it("adds each idea to what you hold in 'book' scope", () => {
    const l = lab("book", [shortCall()]);
    assert.equal(l.book.legs.length, 1);
    // A lone short call has no ceiling on its loss...
    assert.equal(l.baseRr.risk, null);
    // ...and buying a farther call to protect it gives the whole book one.
    const hedge = find(l, "Buy", "Nifty 24300 CE");
    assert.ok(hedge.rr.risk !== null && hedge.rr.risk > 0);
    assert.ok(hedge.rr.ratio > l.baseRr.ratio);
  });

  it("only offers ideas that leave you in the market", () => {
    const l = lab("book", [longCall()]);
    assert.ok(l.ideas.length > 0);
    assert.ok(l.ideas.every((i) => i.move.applied.legs.length > 0));
    assert.ok(!l.ideas.some((i) => i.move.action.headline === "Square off everything"));
    assert.ok(!l.ideas.some((i) => i.move.action.headline === "Sell all 4 lots"));
    // Partway out still counts as staying in (a few lots of the four stay open).
    const partial = l.ideas.find((i) => i.move.action.family === "reduce");
    assert.ok(partial, "a partial exit should be offered");
    assert.match(partial.move.action.headline, /^Sell [123] of 4 lots$/);
    assert.ok(partial.move.applied.legs.length > 0);
  });

  it("has nothing to offer without a live chain in 'alone' scope", () => {
    const { book, funds } = setup([longCall()]);
    const l = runRewardRisk({ book, unders: [], focusKey: null, funds, scope: "alone" });
    assert.deepEqual(l.ideas, []);
  });
});

// --- ranking ---------------------------------------------------------------------------------------

describe("rankByRewardRisk", () => {
  const all = { minPop: 0, allowUncapped: false, family: "all" } as const;

  it("lists the highest reward for the risk first and the lowest last", () => {
    const { ranked } = rankByRewardRisk(lab("alone"), all);
    assert.ok(ranked.length > 10);
    for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].rr.ratio >= ranked[i].rr.ratio, `rank ${i} is out of order`);
    assert.ok(ranked[0].rr.ratio > ranked[ranked.length - 1].rr.ratio);
  });

  it("puts an idea that can't lose above every ratio, and breaks ties by the better chance of profit", () => {
    const base = lab("alone").ideas;
    const outcome = (over: Partial<Evaluated["outcome"]>) => ({ ...base[0].move, outcome: { ...base[0].move.outcome, ...over } });
    const make = (ratio: number, pop: number): Idea => ({
      move: outcome({ pop }),
      rr: { reward: 100, rewardIsEstimate: false, risk: ratio === Infinity ? 0 : 100 / ratio, ratio },
    });
    const a = make(2, 0.3);
    const b = make(2, 0.4);
    const c = make(Infinity, 0.1);
    const d = make(5, 0.1);
    const { ranked } = rankByRewardRisk({ ideas: [a, b, c, d] }, all);
    assert.deepEqual(ranked, [c, d, b, a]);
  });

  it("is the market's no-free-lunch in numbers: a higher ratio always costs a lower chance of profit", () => {
    // The same 50-point call spread, bought at strikes further and further out of the money.
    const l = lab("alone");
    const spreads = [24000, 24050, 24100, 24150, 24200, 24250, 24300].map((k) => find(l, "Bull call spread", `Sell ${k + 50} / buy ${k} CE`));
    for (let i = 1; i < spreads.length; i++) {
      assert.ok(spreads[i].rr.ratio > spreads[i - 1].rr.ratio, `ratio should rise at ${24000 + i * 50}`);
      assert.ok(spreads[i].move.outcome.pop < spreads[i - 1].move.outcome.pop, `chance should fall at ${24000 + i * 50}`);
    }
  });

  it("hides long shots when asked, and counts them", () => {
    const l = lab("alone");
    const everything = rankByRewardRisk(l, all);
    const sensible = rankByRewardRisk(l, { ...all, minPop: LONG_SHOT_POP });
    assert.ok(sensible.hidden.longShots > 0);
    assert.ok(sensible.ranked.every((i) => i.move.outcome.pop >= LONG_SHOT_POP));
    assert.equal(sensible.ranked.length + sensible.hidden.longShots, everything.ranked.length);
    assert.equal(everything.hidden.longShots, 0);
  });

  it("keeps ideas with no ceiling on the loss out unless asked, and ranks them last", () => {
    const l = lab("alone");
    const without = rankByRewardRisk(l, all);
    const withThem = rankByRewardRisk(l, { ...all, allowUncapped: true });
    assert.ok(without.hidden.uncapped > 0);
    assert.ok(without.ranked.every((i) => i.rr.risk !== null));
    assert.equal(withThem.ranked.length, without.ranked.length + without.hidden.uncapped);
    const tail = withThem.ranked.slice(without.ranked.length);
    assert.ok(tail.length > 0 && tail.every((i) => i.rr.risk === null && i.rr.ratio === 0));
  });

  it("leaves out what costs more than your funds, and says how many", () => {
    const free = rankByRewardRisk(lab("alone"), all);
    const poor = rankByRewardRisk(lab("alone", [longCall()], 2_000), all);
    assert.ok(poor.hidden.unaffordable > 0);
    assert.ok(poor.ranked.length < free.ranked.length);
    assert.ok(poor.ranked.every((i) => !i.move.unaffordable));
  });

  it("can be narrowed to one kind of idea", () => {
    const { ranked } = rankByRewardRisk(lab("alone"), { ...all, family: "spread" });
    assert.ok(ranked.length > 0);
    assert.ok(ranked.every((i) => i.move.action.family === "spread"));
  });
});

describe("a book that is already capped", () => {
  it("shows a ratio for the book as it stands, to compare each idea against", () => {
    const l = runRewardRisk({ ...setup([longCall()]), scope: "book" });
    // A lone long call: loss capped at what was paid, profit open-ended - so a real, finite ratio.
    assert.ok(l.baseRr.risk !== null && l.baseRr.risk > 0);
    assert.equal(l.baseRr.rewardIsEstimate, true);
    assert.ok(l.baseRr.ratio > 0 && Number.isFinite(l.baseRr.ratio));
  });
});
