"use client";

/**
 * The result, right under the slider. On a phone the full "What changes" card
 * sits below the controls, out of sight while you drag — so this three-number
 * strip keeps the answer beside the thing you're moving. It hides once the two
 * sit side by side.
 */

import { num, plainPts, signedPct, VERDICT_TONE } from "@/components/averaging/ui";
import type { AveragingResult, Verdict } from "@/lib/averaging";
import { formatINR } from "@/lib/format";

function Stat({ label, value, sub, subClass = "text-muted-foreground" }: { label: string; value: string; sub: string; subClass?: string }) {
  return (
    <div className="min-w-0 text-center">
      <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-0.5 whitespace-nowrap font-mono text-sm font-semibold tabular-nums">{value}</p>
      <p className={`whitespace-nowrap text-[11px] font-medium ${subClass}`}>{sub}</p>
    </div>
  );
}

export default function LiveStrip({ verdict, result, className = "" }: { verdict: Verdict; result: AveragingResult; className?: string }) {
  const tone = VERDICT_TONE[verdict.tone];
  const added = result.extraLots > 0;
  const closer = verdict.breakevenCloserPts;

  const breakeven =
    !added || closer === null ? { value: "—", sub: "no change" } : Math.abs(closer) < 0.5 ? { value: "Same", sub: "no change" } : { value: plainPts(closer), sub: closer > 0 ? "closer" : "further" };

  return (
    <div className={`rounded-xl border border-l-4 border-border bg-card p-3 ${tone.edge} ${className}`}>
      <p className={`text-xs font-semibold ${tone.text}`}>{verdict.label}</p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Stat
          label="New average"
          value={num(result.after.avgPrice)}
          sub={added && verdict.avgChangePct !== null ? signedPct(verdict.avgChangePct) : `was ${num(result.before.avgPrice)}`}
          subClass={added && verdict.avgChangePct !== null ? (verdict.avgChangePct < 0 ? "text-profit" : verdict.avgChangePct > 0 ? "text-danger-fg" : "text-muted-foreground") : undefined}
        />
        <Stat
          label="Break-even"
          value={breakeven.value}
          sub={breakeven.sub}
          subClass={added && closer !== null && Math.abs(closer) >= 0.5 ? (closer > 0 ? "text-profit" : "text-danger-fg") : undefined}
        />
        <Stat label="Extra at risk" value={formatINR(result.extraCost)} sub="premium" />
      </div>
    </div>
  );
}
