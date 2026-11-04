"use client";

/**
 * "How far must it move to break even?" — one card per date, every day from
 * today to expiry. The headline is the exact index move, found on the Analysis
 * payoff itself, so later dates already include the premium that time decay
 * takes away. Each card also selects its date for the chart and the ladder.
 *
 * Three cards sit in view; the rest are a swipe, a scroll or an arrow away. So
 * that nothing is hidden by that, a strip of small bars above the row shows the
 * distance for every date at once — the whole story of time decay in one glance
 * — and doubles as a date picker.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ChevronDownIcon } from "@/components/icons";
import { DeltaChip, num, plainPts, Section, signedPts, signedRupee, signedPct, thinScroll } from "@/components/averaging/ui";
import type { ScenarioKey, ScenarioResult } from "@/lib/averaging";
import { formatLevel } from "@/lib/format";

// --- One date ---------------------------------------------------------------------

/** The line under a card's title: its date for the named days, how far off for the rest. */
function subline(s: ScenarioResult): string {
  return s.key.startsWith("date:") ? `in ${s.daysOut} days` : s.dateLabel;
}

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
  // Two bars on one scale — how far the index must travel without and with the new lots. Only when both
  // are a real distance (not a cushion in profit), where the comparison means something.
  const compare = after.move !== null && before.move !== null && !after.inProfit && !before.inProfit;
  const scale = compare ? Math.max(Math.abs(before.move ?? 0), Math.abs(after.move ?? 0), 1) : 1;
  const barPct = (move: number | null) => (move === null ? 0 : Math.max((Math.abs(move) / scale) * 100, 2));

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`flex h-full min-h-11 w-full min-w-0 flex-col gap-3 rounded-2xl border p-4 text-left transition-colors active:scale-[0.99] ${
        active ? "border-accent/60 bg-accent/5 shadow-[0_0_0_1px_var(--color-accent)]" : "border-border bg-background hover:bg-muted/40"
      }`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{after.label}</span>
          <span className="block text-xs text-muted-foreground">{subline(after)}</span>
        </span>
        {later && (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
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

      {compare && (
        <span aria-hidden="true" className="flex flex-col gap-1.5">
          <span className="flex items-center gap-2">
            <span className="w-11 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Before</span>
            <span className="h-1.5 flex-1 rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-muted-foreground/60 transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${barPct(before.move)}%` }}
              />
            </span>
          </span>
          <span className="flex items-center gap-2">
            <span className="w-11 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-accent">After</span>
            <span className="h-1.5 flex-1 rounded-full bg-muted">
              <span
                className="block h-full rounded-full bg-accent-solid transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${barPct(after.move)}%` }}
              />
            </span>
          </span>
        </span>
      )}

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
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border py-1.5">
          <dt className="whitespace-nowrap text-muted-foreground">Without averaging</dt>
          <dd className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-right font-mono tabular-nums">
            <span className="whitespace-nowrap">{before.move === null ? "—" : before.inProfit ? plainPts(before.move) : signedPts(before.move)}</span>
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

// --- Every date at a glance --------------------------------------------------------

/** "Fri, 6 Nov" → "6 Nov"; the named days get short names that fit a narrow column. */
function stripLabel(s: ScenarioResult): string {
  if (s.key === "today") return "Today";
  if (s.key === "tomorrow") return "Tmrw";
  if (s.key === "expiry") return "Exp";
  return s.dateLabel.split(", ")[1] ?? s.dateLabel;
}

function DriftStrip({
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
  // The distance to travel on each date; a cushion (already in profit) has none to travel.
  const distance = (r: ScenarioResult) => (r.move === null || r.inProfit ? 0 : Math.abs(r.move));
  const peak = Math.max(1, ...after.map(distance), ...before.map(distance));
  const height = (r: ScenarioResult) => `${Math.max((distance(r) / peak) * 100, 4)}%`;
  const crowded = after.length > 7;

  return (
    <div className="rounded-xl border border-border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <p className="text-xs font-medium text-muted-foreground">Points to break even, day by day — tap a bar to pick the date</p>
        <p aria-hidden="true" className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-muted-foreground/40" />
            Before
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm bg-accent-solid" />
            After
          </span>
        </p>
      </div>
      <div role="group" aria-label="Pick a date" className="mt-2 flex items-end gap-0.5 sm:gap-1">
        {after.map((s, i) => {
          const isActive = s.key === active;
          const named = s.key === "today" || s.key === "expiry" || isActive;
          const move = s.move === null ? "no break-even" : s.inProfit ? "already in profit" : `${plainPts(s.move)} ${s.move >= 0 ? "up" : "down"}`;
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={isActive}
              aria-label={`${s.label}, ${s.dateLabel}: ${indexName} ${move}`}
              title={`${s.label} · ${s.dateLabel}\nWith the lots: ${s.move === null ? "—" : signedPts(s.move)}\nWithout: ${before[i].move === null ? "—" : signedPts(before[i].move)}`}
              onClick={() => onSelect(s.key)}
              className={`flex min-h-11 min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-lg px-0.5 pb-1 pt-1.5 transition-colors sm:min-h-0 ${
                isActive ? "bg-accent/10" : "hover:bg-muted/60"
              }`}
            >
              <span aria-hidden="true" className="flex h-14 w-full items-end justify-center gap-0.5">
                <span
                  className="w-2/5 max-w-2.5 rounded-t-sm bg-muted-foreground/40 transition-[height] duration-300 motion-reduce:transition-none"
                  style={{ height: height(before[i]) }}
                />
                <span
                  className={`w-2/5 max-w-2.5 rounded-t-sm transition-[height] duration-300 motion-reduce:transition-none ${s.inProfit ? "bg-profit" : "bg-accent-solid"}`}
                  style={{ height: height(s) }}
                />
              </span>
              <span
                aria-hidden="true"
                className={`w-full truncate text-center text-[10px] tabular-nums ${isActive ? "font-semibold text-foreground" : "text-muted-foreground"} ${
                  crowded && !named ? "max-sm:hidden" : ""
                }`}
              >
                {stripLabel(s)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --- The row of cards --------------------------------------------------------------

const GAP_PX = 12;

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
  const track = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ first: 0, visible: after.length, canBack: false, canForward: false });

  const measure = useCallback(() => {
    const el = track.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const step = card.offsetWidth + GAP_PX;
    const first = Math.round(el.scrollLeft / step);
    const visible = Math.max(1, Math.round((el.clientWidth + GAP_PX) / step));
    const next = {
      first,
      visible,
      canBack: el.scrollLeft > 2,
      canForward: el.scrollLeft + el.clientWidth < el.scrollWidth - 2,
    };
    setView((prev) =>
      prev.first === next.first && prev.visible === next.visible && prev.canBack === next.canBack && prev.canForward === next.canForward ? prev : next,
    );
  }, []);

  // The observer reports once when it starts watching, so the arrows and count are right from the first paint.
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, after.length]);

  // Bring the chosen date's card into the row — inside the row only; the page never moves. Runs when the
  // choice changes, so scrolling along to look at other dates isn't undone by a price update.
  useEffect(() => {
    const el = track.current;
    const card = el?.querySelector<HTMLElement>("[data-active='true']");
    if (!el || !card) return;
    const box = el.getBoundingClientRect();
    const at = card.getBoundingClientRect();
    if (at.left >= box.left - 1 && at.right <= box.right + 1) return;
    const smooth = typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: at.left - box.left, behavior: smooth ? "smooth" : "auto" });
  }, [active]);

  function page(direction: 1 | -1) {
    const el = track.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * view.visible * (card.offsetWidth + GAP_PX), behavior: smooth ? "smooth" : "auto" });
  }

  const overflowing = view.canBack || view.canForward;
  const last = Math.min(view.first + view.visible, after.length);
  // Three across when there's room, two on a mid-width card, one with the next one peeking in on a phone.
  const basis =
    after.length <= 2
      ? "basis-[85%] @min-[26rem]:basis-[calc((100%-0.75rem)/2)]"
      : "basis-[85%] @min-[30rem]:basis-[calc((100%-0.75rem)/2)] @min-[48rem]:basis-[calc((100%-1.5rem)/3)]";

  const arrow =
    "flex size-11 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent sm:size-9";

  return (
    <Section
      step={4}
      title="How far must it move to break even?"
      subtitle={
        after.length > 3
          ? "Solved exactly on the payoff, for every day to expiry. Time decay pushes it further each day. Tap a card to chart that date."
          : "Solved exactly on the payoff. Later dates include what time decay takes away. Tap a card to chart that date."
      }
      action={
        overflowing ? (
          <div className="flex items-center gap-2">
            <p className="text-xs tabular-nums text-muted-foreground">
              Dates {view.first + 1}–{last} of {after.length}
            </p>
            <button type="button" onClick={() => page(-1)} disabled={!view.canBack} aria-label="Earlier dates" className={arrow}>
              <ChevronDownIcon className="size-4 rotate-90" />
            </button>
            <button type="button" onClick={() => page(1)} disabled={!view.canForward} aria-label="Later dates" className={arrow}>
              <ChevronDownIcon className="size-4 -rotate-90" />
            </button>
          </div>
        ) : undefined
      }
    >
      {after.length > 3 && <DriftStrip after={after} before={before} active={active} onSelect={onSelect} indexName={indexName} />}

      <div className="@container relative">
        <div
          ref={track}
          onScroll={measure}
          role="group"
          aria-label="Break-even by date"
          className={`flex snap-x snap-mandatory gap-3 overflow-x-auto pb-3 ${thinScroll}`}
        >
          {after.map((s, i) => (
            <div key={s.key} data-active={s.key === active} className={`min-w-0 shrink-0 snap-start ${basis}`}>
              <Card after={s} before={before[i]} active={s.key === active} onSelect={() => onSelect(s.key)} indexName={indexName} />
            </div>
          ))}
        </div>

        {/* Fades over the edges that have more cards beyond them. */}
        {view.canBack && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-0 top-0 w-8 bg-gradient-to-r from-background to-transparent"
          />
        )}
        {view.canForward && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 right-0 top-0 w-10 bg-gradient-to-l from-background to-transparent"
          />
        )}
      </div>
    </Section>
  );
}
