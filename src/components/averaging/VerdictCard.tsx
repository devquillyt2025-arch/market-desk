"use client";

/**
 * "What changes" — the answer first. A one-sentence verdict, four headline
 * numbers each showing where it was and where it lands, then the smaller
 * numbers and any warnings worth a second look.
 */

import type { ReactNode } from "react";

import { AlertCircleIcon, CheckCircleIcon, ChevronDownIcon } from "@/components/icons";
import { SEVERITY_STYLES } from "@/components/RiskProbabilityPanel";
import { DeltaChip, num, pct, plainPts, Section, signedPct, signedRupee, type Quality } from "@/components/averaging/ui";
import type { AveragingPosition, AveragingResult, GreeksSource, Verdict, VerdictTone } from "@/lib/averaging";
import { formatINR, formatLevel } from "@/lib/format";

const TONE: Record<VerdictTone, { pill: string; edge: string; glow: string; icon: "ok" | "alert" }> = {
  good: { pill: "bg-profit/10 text-profit", edge: "border-l-profit", glow: "from-profit/10", icon: "ok" },
  caution: { pill: "bg-warning/10 text-warning", edge: "border-l-warning", glow: "from-warning/10", icon: "alert" },
  bad: { pill: "bg-loss/15 text-danger-fg", edge: "border-l-danger-fg", glow: "from-loss/15", icon: "alert" },
  neutral: { pill: "bg-muted text-muted-foreground", edge: "border-l-border", glow: "from-muted", icon: "ok" },
};

const GREEKS_SOURCE_LABEL: Record<GreeksSource, string | null> = {
  engine: null,
  broker: "the broker's Greeks — IV unavailable",
  estimated: "estimated — IV unavailable",
};

/** The verdict already says these in words, so they don't repeat below it. */
const COVERED_BY_VERDICT = new Set(["no-price", "no-lots", "price-above-avg", "exceeds-funds"]);

function Tile({
  label,
  value,
  from,
  chip,
  hint,
}: {
  label: string;
  value: ReactNode;
  from: ReactNode;
  chip?: ReactNode;
  hint?: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-background p-3.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 truncate font-mono text-2xl font-semibold tabular-nums">{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        {chip}
        <span className="text-xs text-muted-foreground">
          was <span className="font-mono tabular-nums">{from}</span>
        </span>
      </div>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function MoreRow({ label, before, after, hint }: { label: string; before?: ReactNode; after: ReactNode; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-0" title={hint}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right font-mono text-sm tabular-nums">
        {before !== undefined && <span className="text-muted-foreground">{before} → </span>}
        <span className="font-semibold">{after}</span>
      </dd>
    </div>
  );
}

export default function VerdictCard({
  verdict,
  result,
  position,
  funds,
  indexName,
  className = "",
}: {
  verdict: Verdict;
  result: AveragingResult;
  position: AveragingPosition;
  funds: number | null;
  indexName: string;
  className?: string;
}) {
  const { before, after } = result;
  const t = TONE[verdict.tone];
  const added = result.extraLots > 0;

  const popDelta = before.pop !== null && after.pop !== null ? (after.pop - before.pop) * 100 : null;
  const closer = verdict.breakevenCloserPts;
  // Arrow = which way the break-even level moved. A call's gets lower when it improves, a put's gets higher.
  const improved = (closer ?? 0) >= 0;
  const beDirection: "up" | "down" = position.type === "CE" ? (improved ? "down" : "up") : improved ? "up" : "down";
  const avgQuality: Quality = (verdict.avgChangePct ?? 0) < 0 ? "good" : (verdict.avgChangePct ?? 0) > 0 ? "bad" : "neutral";
  const atRiskPct = funds !== null && funds > 0 ? (after.capitalAtRisk / funds) * 100 : null;

  const notes = result.warnings.filter((w) => !COVERED_BY_VERDICT.has(w.id));
  const alerts = notes.filter((w) => w.severity !== "info");
  const infos = notes.filter((w) => w.severity === "info");
  const greeksNote = GREEKS_SOURCE_LABEL[after.greeksSource];

  return (
    <Section title="What changes" subtitle="The result of buying these lots, at a glance." className={className}>
      <div
        className={`flex flex-col gap-4 rounded-2xl border border-l-4 border-border bg-card bg-gradient-to-br ${t.glow} via-transparent to-transparent p-4 sm:p-5 ${t.edge}`}
      >
        <div className="flex items-start gap-3">
          {t.icon === "ok" ? (
            <CheckCircleIcon className={`mt-0.5 size-5 shrink-0 ${verdict.tone === "good" ? "text-profit" : "text-muted-foreground"}`} />
          ) : (
            <AlertCircleIcon className={`mt-0.5 size-5 shrink-0 ${verdict.tone === "bad" ? "text-danger-fg" : "text-warning"}`} />
          )}
          <div className="min-w-0">
            <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${t.pill}`}>{verdict.label}</span>
            <p aria-live="polite" className="mt-1.5 text-base font-medium leading-snug text-foreground sm:text-lg">
              {verdict.headline}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Tile
            label="Average price"
            value={num(after.avgPrice)}
            from={num(before.avgPrice)}
            chip={
              added && verdict.avgChangePct !== null ? (
                <DeltaChip direction={verdict.avgChangePct < 0 ? "down" : verdict.avgChangePct > 0 ? "up" : "flat"} quality={avgQuality}>
                  {signedPct(verdict.avgChangePct)}
                </DeltaChip>
              ) : undefined
            }
          />
          <Tile
            label="Break-even at expiry"
            value={after.breakevenLevel === null ? "—" : formatLevel(after.breakevenLevel)}
            from={before.breakevenLevel === null ? "—" : formatLevel(before.breakevenLevel)}
            chip={
              added && closer !== null ? (
                Math.abs(closer) < 0.5 ? (
                  <DeltaChip direction="flat" quality="neutral">
                    no change
                  </DeltaChip>
                ) : (
                  <DeltaChip direction={beDirection} quality={closer > 0 ? "good" : "bad"}>
                    {plainPts(closer)} {closer > 0 ? "closer" : "further"}
                  </DeltaChip>
                )
              ) : undefined
            }
            hint={`${indexName} level where you stop losing`}
          />
          <Tile
            label="Chance of profit"
            value={pct(after.pop)}
            from={pct(before.pop)}
            chip={
              added && popDelta !== null ? (
                <DeltaChip direction={popDelta > 0.05 ? "up" : popDelta < -0.05 ? "down" : "flat"} quality={popDelta > 0.05 ? "good" : popDelta < -0.05 ? "bad" : "neutral"}>
                  {popDelta > 0 ? "+" : popDelta < 0 ? "-" : ""}
                  {Math.abs(popDelta).toFixed(1)} pp
                </DeltaChip>
              ) : undefined
            }
            hint="At expiry, from implied volatility"
          />
          <Tile
            label="Premium at risk"
            value={formatINR(after.capitalAtRisk)}
            from={formatINR(before.capitalAtRisk)}
            chip={
              added ? (
                <DeltaChip direction="up" quality={atRiskPct !== null && atRiskPct > 0 && result.warnings.some((w) => w.id === "capital-at-risk") ? "bad" : "neutral"}>
                  {signedRupee(after.capitalAtRisk - before.capitalAtRisk)}
                </DeltaChip>
              ) : undefined
            }
            hint={atRiskPct === null ? "Total premium paid" : `${atRiskPct.toFixed(1)}% of your funds`}
          />
        </div>

        <dl className="grid gap-x-6 sm:grid-cols-2">
          <MoreRow label="Quantity" before={`${before.qty}`} after={`${after.qty} (${after.lots} lot${after.lots === 1 ? "" : "s"})`} />
          <MoreRow label="Extra cost" hint="New money for these lots" after={formatINR(result.extraCost)} />
          <MoreRow label="Max loss" hint="Worst P&L at expiry" before={formatINR(before.maxLoss ?? 0)} after={after.maxLoss === null ? "Unlimited" : formatINR(after.maxLoss)} />
          <MoreRow label="Break-even premium" hint="What the option must trade at" before={num(before.breakevenPremium)} after={num(after.breakevenPremium)} />
          <MoreRow label="Theta / day" hint="Time decay, ₹ per calendar day" before={formatINR(before.theta)} after={formatINR(after.theta)} />
          <MoreRow label="Net delta" hint={`${indexName} points of exposure`} before={num(before.delta, 1)} after={num(after.delta, 1)} />
        </dl>
        {greeksNote && <p className="-mt-2 text-xs text-warning">Greeks: {greeksNote}.</p>}
      </div>

      {alerts.length > 0 && (
        <div className="flex flex-col gap-2">
          {alerts.map((w) => {
            const s = SEVERITY_STYLES[w.severity];
            return (
              <div key={w.id} className={`flex items-start gap-2.5 rounded-xl border p-3 ${s.box}`}>
                <AlertCircleIcon className={`mt-0.5 size-4 shrink-0 ${s.text}`} />
                <p className="min-w-0 text-sm">
                  <span className="font-medium">{w.title}.</span> <span className="text-muted-foreground">{w.detail}</span>
                </p>
              </div>
            );
          })}
        </div>
      )}

      {infos.length > 0 && (
        <details className="group rounded-xl border border-border bg-background">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2 text-sm text-muted-foreground hover:text-foreground sm:min-h-9">
            <span>
              Good to know <span className="font-mono text-xs">({infos.length})</span>
            </span>
            <ChevronDownIcon className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </summary>
          <ul className="flex flex-col gap-2 border-t border-border px-3.5 py-3">
            {infos.map((w) => (
              <li key={w.id} className="text-sm">
                <span className="font-medium">{w.title}.</span> <span className="text-muted-foreground">{w.detail}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}
