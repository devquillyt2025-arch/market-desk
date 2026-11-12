"use client";

/**
 * One idea in the Reward : Risk ranking: what it is, the ratio it earns (big, because that is what
 * the list is sorted on), a bar that shows the ratio as a picture - how much of the stake is risk
 * and how much is reward - and the three figures behind it: what it can make, what it can lose and
 * how often it ends in profit. A high ratio on a low chance is tagged a long shot, so the top of the
 * list can't pass for the safest place to be.
 */

import { compactMoney, percent, TagChip, TONE_TEXT, type Tone } from "@/components/whatif/shared";
import { LONG_SHOT_POP, ratioLabel, type Idea, type RewardRisk, type Scope } from "@/lib/rewardRisk";
import type { Tag } from "@/lib/whatIf";

/** How the ratio compares with where the book stands now. A ceiling on the loss is what matters most, so gaining or losing one is said in words; otherwise bigger is better. */
function versus(rr: RewardRisk, base: RewardRisk): { text: string; tone: Tone } {
  if (base.risk === null && rr.risk === null) return { text: "still no ceiling", tone: "neutral" };
  if (base.risk === null) return { text: "puts a ceiling on the loss", tone: "good" };
  if (rr.risk === null) return { text: "removes the ceiling on the loss", tone: "bad" };
  const bothFinite = Number.isFinite(rr.ratio) && Number.isFinite(base.ratio);
  const same = rr.ratio === base.ratio || (bothFinite && Math.abs(rr.ratio - base.ratio) <= 0.05 * Math.max(base.ratio, 0.1));
  if (same) return { text: "same as now", tone: "neutral" };
  const up = rr.ratio > base.ratio;
  return { text: `${up ? "up" : "down"} from ${ratioLabel(base)}`, tone: up ? "good" : "bad" };
}

/** The ratio as a picture: red for the share that is risk, green for the share that is reward. Meaning is in the text beside it too. */
function RatioBar({ rr }: { rr: RewardRisk }) {
  let risk: number;
  if (rr.risk === null) risk = 1;
  else if (rr.ratio === Infinity) risk = 0;
  else risk = rr.risk / (rr.risk + rr.reward);
  // Never a sliver too thin to see on either side.
  const share = rr.risk === null || rr.ratio === Infinity ? risk : Math.min(Math.max(risk, 0.03), 0.97);
  return (
    <div aria-hidden="true" className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {share > 0 && <div className={rr.risk === null ? "bg-danger-fg/40" : "bg-danger-fg"} style={{ width: `${share * 100}%` }} />}
      {share < 1 && <div className="bg-profit" style={{ width: `${(1 - share) * 100}%` }} />}
    </div>
  );
}

function Figure({ label, value, tone = "neutral" }: { label: string; value: string; tone?: Tone }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 whitespace-nowrap font-mono text-sm font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{value}</dd>
    </div>
  );
}

export default function IdeaRow({
  rank,
  idea,
  baseRr,
  scope,
  selected,
  onSelect,
}: {
  rank: number;
  idea: Idea;
  baseRr: RewardRisk;
  scope: Scope;
  selected: boolean;
  onSelect: () => void;
}) {
  const { move, rr } = idea;
  const pop = move.outcome.pop;
  const longShot: Tag[] = pop < LONG_SHOT_POP ? [{ id: "longshot", label: `Long shot · wins ${percent(pop)}`, tone: "warn" }] : [];
  const tags = [...longShot, ...move.tags].slice(0, 4);
  const compare = scope === "book" ? versus(rr, baseRr) : null;

  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={`flex w-full flex-col gap-3 rounded-2xl border bg-background p-4 text-left shadow-sm transition-colors active:scale-[0.995] ${
        selected ? "border-accent ring-2 ring-accent/30" : "border-border hover:border-border-strong"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
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
        <div className="shrink-0 text-right">
          <p className="whitespace-nowrap font-mono text-xl font-semibold tabular-nums text-foreground">
            <span className="sr-only">Reward to risk </span>
            {ratioLabel(rr)}
          </p>
          <p className="text-[11px] text-muted-foreground">{rr.risk === null ? "no ceiling on the loss" : "reward : risk"}</p>
          {compare && <p className={`whitespace-nowrap text-[11px] font-medium ${TONE_TEXT[compare.tone]}`}>{compare.text}</p>}
        </div>
      </div>

      <RatioBar rr={rr} />

      <dl className="grid grid-cols-3 gap-3">
        <Figure label="Can make" value={`${rr.rewardIsEstimate ? "~" : ""}${compactMoney(rr.reward)}`} tone="good" />
        <Figure label="Can lose" value={rr.risk === null ? "No cap" : compactMoney(rr.risk)} tone={rr.risk === null ? "bad" : "neutral"} />
        <Figure label="Chance of profit" value={percent(pop)} tone={pop >= 0.5 ? "good" : "neutral"} />
      </dl>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} />
          ))}
        </div>
      )}
    </button>
  );
}
