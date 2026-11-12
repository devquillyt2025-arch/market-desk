/**
 * Pure maths behind Live Portfolio's "Reward : Risk" tab: every idea the What-if lab can price,
 * ranked by how much it can make for each rupee it can lose. No React, no fetching, read-only.
 *
 * It adds no option maths of its own. The ideas, their prices and their outcomes all come from
 * lib/whatIf.ts (itself on the Risk & Probability model); this module only decides what counts as
 * the "reward" and the "risk" of an outcome, picks one representative per kind of idea, and sorts.
 *
 * Two ways to look at an idea (`Scope`):
 *  - "book":  the ideas are added to what you hold, and the ratio is that of the whole book afterwards
 *             - "what does this do to my reward for the risk I'm already running?"
 *  - "alone": each idea is measured on its own, as if you held nothing - "which new trade has the
 *             best reward for its risk?"
 *
 * Reward and risk are the app's usual ones (Analysis and Risk & Probability): the most the position
 * can make over the most it can lose, at expiry. Two cases where that would mislead are handled:
 *  - a profit with no cap (a long call), or one that needs the index to go to zero (a long put),
 *    would be "infinite" and tie with every other such trade - so the 1-in-20 good case stands in;
 *  - a loss with no practical ceiling (a naked short) has no meaningful ratio and ranks last.
 */

import {
  REMOTE_WORST,
  runLab,
  type Book,
  type Evaluated,
  type Family,
  type Outcome,
  type Underlying,
  type WhatIfAction,
} from "@/lib/whatIf";

// --- Tunables ------------------------------------------------------------------------

/** A loss or gain smaller than this (₹) is rounding, not a number to divide by. */
const NEGLIGIBLE = 1;
/** Ideas that win less often than this are called long shots. */
export const LONG_SHOT_POP = 0.25;
/** Variants of one idea whose ratios are within this of the best are the same idea at a different size; the cheapest is shown. */
const SAME_RATIO = 0.98;

// --- Reward and risk of one outcome ----------------------------------------------------

export type RewardRisk = {
  /** What the position can make (₹, never negative): its maximum, or the 1-in-20 good case where there is no practical maximum. */
  reward: number;
  /** `reward` is the 1-in-20 good case because the position's own maximum is unlimited or only reachable if the index went to zero. */
  rewardIsEstimate: boolean;
  /** What it can lose (₹); null when the loss has no practical ceiling. */
  risk: number | null;
  /** Reward per ₹1 of risk. Infinity when it can't lose and can win; 0 when the loss has no ceiling or there is nothing to win. */
  ratio: number;
};

export function rewardRisk(o: Outcome): RewardRisk {
  const hasMaximum = o.maxProfit !== null && o.maxProfit <= REMOTE_WORST * Math.max(o.p95, 1);
  const reward = Math.max(hasMaximum ? (o.maxProfit as number) : o.p95, 0);
  const risk = o.maxLoss === null || o.worstIsRemote ? null : o.maxLoss;
  let ratio: number;
  if (risk === null || reward < NEGLIGIBLE) ratio = 0;
  else ratio = risk < NEGLIGIBLE ? Infinity : reward / risk;
  return { reward, rewardIsEstimate: !hasMaximum, risk, ratio };
}

/** "3.4 : 1" - reward per ₹1 risked. Words where a ratio would mislead: no ceiling on the loss, or no loss at all. */
export function ratioLabel(rr: Pick<RewardRisk, "risk" | "ratio">): string {
  if (rr.risk === null) return "No cap";
  if (rr.ratio === Infinity) return "No loss";
  if (rr.ratio >= 100) return "100+ : 1";
  if (rr.ratio >= 10) return `${Math.round(rr.ratio)} : 1`;
  return `${rr.ratio.toFixed(1)} : 1`;
}

// --- Ideas ---------------------------------------------------------------------------------

export type Scope = "book" | "alone";

export type Idea = {
  move: Evaluated;
  rr: RewardRisk;
};

export type RewardRiskInput = {
  book: Book;
  unders: Underlying[];
  focusKey: string | null;
  /** ₹ available, or null when not entered. Ideas that cost more are marked and left out. */
  funds: number | null;
  scope: Scope;
};

export type RewardRiskLab = {
  scope: Scope;
  /** What the ideas are measured against: the book itself, or nothing at all. */
  book: Book;
  base: Outcome;
  baseRr: RewardRisk;
  /** The yardstick the lab measures a gain or a loss against (1 when `book` is empty). */
  scale: number;
  /** One idea per kind of trade, every one that leaves something open. Not yet filtered by chance, funds or cap. */
  ideas: Idea[];
};

const EMPTY_BOOK: Book = { legs: [], skipped: 0, premiumCapital: 0 };

/**
 * The same idea at different sizes ("buy 1 / 2 / 4 lots of the 24100 call") is one idea - the ids
 * differ only in a trailing lot count. Whole-book moves have no size and stand alone.
 */
export function structureKey(action: Pick<WhatIfAction, "id" | "family">): string {
  if (action.family === "book") return action.id;
  const at = action.id.lastIndexOf(":");
  return at > 0 ? action.id.slice(0, at) : action.id;
}

/** Highest ratio first; between equals, the likelier to profit, then the cheaper to put on. */
function byRatio(a: Idea, b: Idea): number {
  if (a.rr.ratio !== b.rr.ratio) return a.rr.ratio > b.rr.ratio ? -1 : 1;
  const dPop = b.move.outcome.pop - a.move.outcome.pop;
  if (Math.abs(dPop) > 1e-9) return dPop;
  return a.move.outlay - b.move.outlay;
}

/** The size of an idea worth showing: the best ratio, or - among sizes that are as good - the cheapest. */
function representative(variants: Idea[]): Idea {
  const best = variants.reduce((a, b) => (byRatio(a, b) <= 0 ? a : b));
  return variants
    .filter((v) => v.rr.ratio >= best.rr.ratio * SAME_RATIO)
    .reduce((a, b) => (b.move.outlay < a.move.outlay ? b : a));
}

export function runRewardRisk({ book, unders, focusKey, funds, scope }: RewardRiskInput): RewardRiskLab {
  const held = scope === "book" ? book : EMPTY_BOOK;
  const lab = runLab({ book: held, unders, focusKey, funds });

  const bySize = new Map<string, Idea[]>();
  for (const move of lab.moves) {
    // "Staying in the market": an idea that closes everything isn't one.
    if (move.applied.legs.length === 0) continue;
    const key = structureKey(move.action);
    const group = bySize.get(key);
    const idea = { move, rr: rewardRisk(move.outcome) };
    if (group) group.push(idea);
    else bySize.set(key, [idea]);
  }

  return {
    scope,
    book: held,
    base: lab.base,
    baseRr: rewardRisk(lab.base),
    scale: lab.scale,
    ideas: [...bySize.values()].map(representative),
  };
}

// --- Ranking ---------------------------------------------------------------------------------

export type RankOptions = {
  /** Hide ideas that win less often than this (0 shows all). */
  minPop: number;
  /** Show ideas whose loss has no practical ceiling (they rank last). */
  allowUncapped: boolean;
  family: Family | "all";
};

export type Ranked = {
  /** Highest reward per ₹1 of risk first. */
  ranked: Idea[];
  /** What was left out of `ranked`, and why - each idea counted once, in this order. */
  hidden: { unaffordable: number; uncapped: number; longShots: number };
};

export function rankByRewardRisk(lab: Pick<RewardRiskLab, "ideas">, { minPop, allowUncapped, family }: RankOptions): Ranked {
  const hidden = { unaffordable: 0, uncapped: 0, longShots: 0 };
  const ranked: Idea[] = [];
  for (const idea of lab.ideas) {
    if (family !== "all" && idea.move.action.family !== family) continue;
    if (idea.move.unaffordable) hidden.unaffordable += 1;
    else if (idea.rr.risk === null && !allowUncapped) hidden.uncapped += 1;
    else if (idea.move.outcome.pop < minPop) hidden.longShots += 1;
    else ranked.push(idea);
  }
  ranked.sort(byRatio);
  return { ranked, hidden };
}
