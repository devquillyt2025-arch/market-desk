/**
 * The trade plan for one side: where the stop and target sit, and what the trade risks and earns per lot AFTER costs. A pure function
 * of its inputs, so the page can recompute it as the sliders move and the replay can use the same rule on past signals.
 */

import { COSTS, LOT, TICK } from "@/lib/natgasPlanner/config";
import { costFloor, fees, roundToTick, roundUpToTick } from "@/lib/natgasPlanner/costs";
import type { Side } from "@/lib/natgasPlanner/types";

const cents = (x: number) => Math.round(x * 100) / 100;

export type PlanInput = {
  side: Side;
  /** The reference price: the last price when live, the next minute's open when replaying. */
  entry: number;
  /** ATR(14) of the timeframe's last completed bar; null when there are too few bars. */
  atr: number | null;
  atrMult: number;
  ratio: number;
  /** A manual stop, as a share of the entry price (percent) or in rupees a mmBtu. Rupees win over percent; either beats the ATR rule. */
  stopPct?: number | null;
  stopAbs?: number | null;
  /** The most rupees to risk (net, at the stop); 0 for none set. */
  riskBudget: number;
};

export type Plan = {
  side: Side;
  entry: number;
  stop: number;
  target: number;
  /** Rupees a mmBtu from entry, after rounding to the tick. */
  stopDist: number;
  targetDist: number;
  /** Target distance over stop distance as rounded - what the ticks actually allow. */
  effectiveRatio: number;
  stopSource: "atr" | "cost-floor" | "manual";
  /** The fills the P&L is worked out at: a tick against you on the entry and on a stop exit, none on the target. */
  entryFill: number;
  stopFill: number;
  targetFill: number;
  /** Per lot, rupees. */
  grossRisk: number;
  grossReward: number;
  netRisk: number;
  netReward: number;
  feesAtStop: number;
  feesAtTarget: number;
  /** Win rate needed to break even after costs, and with none (1 / (1 + ratio)); both 0-1. */
  breakEven: number;
  breakEvenNoCost: number;
  /** Costs plus two ticks of slippage as a share of the gross risk (0-1): the green/amber/red measure. */
  costShare: number;
  riskPct: number;
  rewardPct: number;
  notional: number;
  /** Lots the budget allows at the net risk (0 when none); `lotsNote` says why when it is 0. */
  lots: number;
  lotsNote: string | null;
};

/** null when there is no ATR yet and no manual stop either - there is nothing to size the stop from. */
export function makePlan(input: PlanInput): Plan | null {
  const { side, entry, atr, atrMult, ratio, riskBudget } = input;
  if (!(entry > 0)) return null;

  const manual = input.stopAbs && input.stopAbs > 0 ? input.stopAbs : input.stopPct && input.stopPct > 0 ? (entry * input.stopPct) / 100 : null;
  let raw: number;
  let stopSource: Plan["stopSource"];
  if (manual !== null) {
    raw = manual;
    stopSource = "manual";
  } else if (atr !== null && atr > 0) {
    const fromAtr = atrMult * atr;
    const floor = costFloor(entry);
    raw = Math.max(fromAtr, floor);
    stopSource = fromAtr >= floor ? "atr" : "cost-floor";
  } else {
    return null;
  }

  const stopDist = roundUpToTick(raw);
  const targetDist = Math.max(roundToTick(ratio * stopDist), TICK);
  const slip = COSTS.slippageTicks * TICK;
  const long = side === "long";

  const entryFill = cents(entry + (long ? slip : -slip));
  const stop = cents(entry + (long ? -stopDist : stopDist));
  const target = cents(entry + (long ? targetDist : -targetDist));
  const stopFill = cents(stop + (long ? -slip : slip));
  const targetFill = target;

  // A long buys at the entry and sells at the exit; a short sells at the entry and buys back at the exit.
  const feesAtStop = long ? fees(entryFill, stopFill) : fees(stopFill, entryFill);
  const feesAtTarget = long ? fees(entryFill, targetFill) : fees(targetFill, entryFill);
  const move = (exitFill: number) => (long ? exitFill - entryFill : entryFill - exitFill) * LOT;
  const netRisk = -(move(stopFill) - feesAtStop);
  const netReward = move(targetFill) - feesAtTarget;
  const grossRisk = stopDist * LOT;
  const grossReward = targetDist * LOT;
  const effectiveRatio = targetDist / stopDist;

  const lots = riskBudget > 0 && netRisk > 0 ? Math.floor(riskBudget / netRisk) : 0;
  return {
    side,
    entry,
    stop,
    target,
    stopDist,
    targetDist,
    effectiveRatio,
    stopSource,
    entryFill,
    stopFill,
    targetFill,
    grossRisk,
    grossReward,
    netRisk,
    netReward,
    feesAtStop,
    feesAtTarget,
    breakEven: netRisk / (netRisk + netReward),
    breakEvenNoCost: 1 / (1 + effectiveRatio),
    costShare: (feesAtStop + 2 * TICK * LOT) / grossRisk,
    riskPct: (stopDist / entry) * 100,
    rewardPct: (targetDist / entry) * 100,
    notional: entry * LOT,
    lots,
    lotsNote: lots === 0 ? `Budget too small: 1 lot risks ₹${Math.round(netRisk).toLocaleString("en-IN")}` : null,
  };
}

/** Green below 20%, amber from 20 to 25%, red above. */
export function costShareTone(share: number): "good" | "warn" | "bad" {
  return share < 0.2 ? "good" : share <= 0.25 ? "warn" : "bad";
}
