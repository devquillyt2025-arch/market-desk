"use client";

/**
 * "How far must it move to break even?" — one card per date. The headline is the
 * exact index move, found on the Analysis payoff itself, so later dates already
 * include the premium that time decay takes away. Each card also selects its
 * date for the chart and the ladder.
 */

import { DeltaChip, num, plainPts, Section, signedPts, signedRupee, signedPct } from "@/components/averaging/ui";
import type { ScenarioKey, ScenarioResult } from "@/lib/averaging";
import { formatLevel } from "@/lib/format";

function Card({
  after,
  before,
  active,
  onSelect,
  indexName,
}: {
  after: ScenarioResult;
  before: ScenarioResult;
  active: boolean;
  onSelect: () => void;
  indexName: string;
}) {
  const later = after.key !== "today";
  const saved = after.move !== null && before.move !== null ? Math.abs(before.move) - Math.abs(after.move) : null;
  const direction = after.move === null ? null : after.move >= 0 ? "rise to" : "fall to";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex min-h-11 min-w-0 flex-col gap-3 rounded-2xl border p-4 text-left transition-colors active:scale-[0.99] ${
        active ? "border-accent/60 bg-accent/5 shadow-[0_0_0_1px_var(--color-accent)]" : "border-border bg-background hover:bg-muted/40"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{after.label}</span>
        {later && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            theta-adjusted
          </span>
        )}
      </span>

      <span className="flex flex-col gap-0.5">
        <span className={`font-mono text-3xl font-semibold leading-none tabular-nums ${after.inProfit ? "text-profit" : ""}`}>
          {after.move === null ? "—" : after.inProfit ? plainPts(after.move) : signedPts(after.move)}
        </span>
        {after.move !== null && after.level !== null && (
          <span className="mt-1 text-sm text-muted-foreground">
            {after.inProfit ? (
              <>
                Already in profit — {indexName} can {after.move < 0 ? "slip" : "climb"} to{" "}
                <span className="font-mono text-foreground">{formatLevel(after.level)}</span> first
              </>
            ) : (
              <>
                {indexName} must {direction} <span className="font-mono text-foreground">{formatLevel(after.level)}</span>
              </>
            )}
          </span>
        )}
      </span>

      <dl className="flex flex-col text-sm">
        <div className="flex items-baseline justify-between gap-3 border-t border-border py-1.5">
          <dt className="text-muted-foreground">{after.premiumRise < 0 ? "Premium cushion" : "Premium must gain"}</dt>
          <dd className="text-right font-mono tabular-nums">
            {signedRupee(Math.abs(after.premiumRise), 2)}
            {after.premiumRisePct !== null && (
              <span className="ml-1.5 text-xs text-muted-foreground">{signedPct(Math.abs(after.premiumRisePct), 0)}</span>
            )}
          </dd>
        </div>
        {later && (
          <div className="flex items-baseline justify-between gap-3 border-t border-border py-1.5">
            <dt className="text-muted-foreground">Of which theta</dt>
            <dd className="font-mono tabular-nums">₹{num(after.thetaDrag)}</dd>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-border py-1.5">
          <dt className="text-muted-foreground">Without averaging</dt>
          <dd className="flex items-center gap-2 text-right font-mono tabular-nums">
            {before.move === null ? "—" : before.inProfit ? plainPts(before.move) : signedPts(before.move)}
            {saved !== null && Math.abs(saved) >= 0.5 && (
              <DeltaChip direction={saved > 0 ? "down" : "up"} quality={saved > 0 ? "good" : "bad"}>
                {plainPts(saved)} {saved > 0 ? "less" : "more"}
              </DeltaChip>
            )}
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-t border-border py-1.5">
          <dt
            className="text-xs text-muted-foreground"
            title="A quick second-order estimate from today's delta and gamma. It drifts from the exact figure on later dates, when delta has changed."
          >
            Delta-gamma estimate
          </dt>
          <dd className="font-mono text-xs tabular-nums text-muted-foreground">
            {after.deltaGammaMove === null ? "—" : `≈ ${signedPts(after.deltaGammaMove)}`}
          </dd>
        </div>
      </dl>
    </button>
  );
}

export default function BreakevenCards({
  after,
  before,
  active,
  onSelect,
  indexName,
}: {
  after: ScenarioResult[];
  before: ScenarioResult[];
  active: ScenarioKey;
  onSelect: (key: ScenarioKey) => void;
  indexName: string;
}) {
  return (
    <Section
      title="How far must it move to break even?"
      subtitle="Solved exactly on the payoff. Later dates include what time decay takes away. Tap a card to chart that date."
    >
      <div className={`grid gap-3 ${after.length >= 3 ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        {after.map((s, i) => (
          <Card key={s.key} after={s} before={before[i]} active={s.key === active} onSelect={() => onSelect(s.key)} indexName={indexName} />
        ))}
      </div>
    </Section>
  );
}
