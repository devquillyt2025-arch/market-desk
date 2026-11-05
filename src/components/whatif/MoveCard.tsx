"use client";

/**
 * One suggested move, as a card: what it is, the tags that matter (what it costs, whether the risk
 * is capped, anything to be careful about), and the three numbers that decide it - the chance of
 * profit and the 1-in-20 bad and good cases - each shown as where it is now and where it would land.
 */

import { compactMoney, percent, TagChip, TONE_TEXT, toneOf, type Tone } from "@/components/whatif/shared";
import type { Evaluated, Outcome } from "@/lib/whatIf";

/** One measure: its name on the left, where it is and where it would land on the right - a row, so a long figure never meets its neighbour. */
function Stat({ label, before, after, tone }: { label: string; before: string; after: string; tone: Tone }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="shrink-0 whitespace-nowrap font-mono text-xs tabular-nums">
        <span className="text-muted-foreground">{before} → </span>
        <span className={`font-semibold ${TONE_TEXT[tone]}`}>{after}</span>
      </dd>
    </div>
  );
}

export default function MoveCard({
  rank,
  move,
  base,
  scale,
  selected,
  onSelect,
}: {
  rank: number;
  move: Evaluated;
  base: Outcome;
  scale: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const o = move.outcome;
  const money = Math.max(50, scale * 0.004);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex h-full w-full flex-col gap-3 rounded-2xl border bg-background p-4 text-left shadow-sm transition-colors active:scale-[0.995] ${
        selected ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-border-strong"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-xs font-bold text-accent"
        >
          {rank}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-snug text-foreground">{move.action.headline}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{move.action.detail}</p>
        </div>
      </div>

      {move.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {move.tags.slice(0, 4).map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
        </div>
      )}

      <dl className="mt-auto flex flex-col gap-1.5 border-t border-border pt-3">
        <Stat label="Chance of profit" before={percent(base.pop)} after={percent(o.pop)} tone={toneOf(base.pop, o.pop, 0.005)} />
        <Stat label="Bad case · 1 in 20" before={compactMoney(base.p5)} after={compactMoney(o.p5)} tone={toneOf(base.p5, o.p5, money)} />
        <Stat label="Good case · 1 in 20" before={compactMoney(base.p95)} after={compactMoney(o.p95)} tone={toneOf(base.p95, o.p95, money)} />
      </dl>
    </button>
  );
}
