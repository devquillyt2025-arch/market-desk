"use client";

/**
 * The working behind one idea's ratio: what it can lose, what it can make, what that comes to per
 * rupee - and, in a sentence, what the ratio does not tell you. A high reward for the risk is always
 * paid for with a lower chance of getting it, so the chance of profit and the average outcome sit
 * right beside it instead of being left to a table further down.
 */

import { money, percent, Tile } from "@/components/whatif/shared";
import { ratioLabel, type Idea, type RewardRisk, type Scope } from "@/lib/rewardRisk";

function working(idea: Idea, scope: Scope): string {
  const { rr, move } = idea;
  const o = move.outcome;
  const whole = scope === "book" ? "the whole book" : "this idea";
  if (rr.risk === null) {
    return `${scope === "book" ? "The book's" : "The"} loss has no ceiling here, so there is no sensible reward per rupee of risk to work out — which is why it ranks last.`;
  }
  const lead =
    rr.ratio === Infinity
      ? `On these numbers ${whole} can't lose money at expiry; the most it can make is ${money(rr.reward)}.`
      : `${scope === "book" ? "The book" : "It"} risks ${money(rr.risk)} to make ${rr.rewardIsEstimate ? "about " : ""}${money(rr.reward)} — ₹${rr.ratio.toFixed(2)} for every ₹1 risked.`;
  const estimate = rr.rewardIsEstimate
    ? " The profit has no practical cap, so the 1-in-20 good case stands in for it."
    : "";
  const chance = `The market gives ${whole} about a ${percent(o.pop)} chance of ending in profit, and the average outcome is ${money(o.expectedPnl)} after charges.`;
  const moral =
    rr.ratio === Infinity
      ? ""
      : " A higher ratio is paid for with a lower chance of winning — it is a different shape of bet, not an edge.";
  return `${lead}${estimate} ${chance}${moral}`;
}

export default function Breakdown({ idea, baseRr, scope }: { idea: Idea; baseRr: RewardRisk; scope: Scope }) {
  const { rr } = idea;
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border bg-background p-4 shadow-sm sm:p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Tile
          label="It can lose"
          value={rr.risk === null ? "No cap" : money(rr.risk)}
          hint={rr.risk === null ? "no ceiling on the loss" : "at most, at expiry"}
          tone={rr.risk === null ? "bad" : "neutral"}
        />
        <Tile
          label={rr.rewardIsEstimate ? "It can make · about" : "It can make"}
          value={money(rr.reward)}
          hint={rr.rewardIsEstimate ? "1-in-20 good case · no practical cap" : "at most, at expiry"}
          tone="good"
        />
        <Tile
          label="Reward per ₹1 risked"
          value={ratioLabel(rr)}
          hint={scope === "book" ? `the book was ${ratioLabel(baseRr)}` : "reward : risk"}
        />
      </div>
      <p className="text-sm text-muted-foreground">{working(idea, scope)}</p>
    </div>
  );
}
