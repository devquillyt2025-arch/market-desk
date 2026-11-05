"use client";

/**
 * What-if lab - the "What-if lab" tab beside Risk & Probability and Simulate averaging on Live
 * Portfolio. Instead of making you think up a move and test it, it tries every sensible one on your
 * open positions - exit some lots, add some, sell or buy a call or put, put on a spread - and ranks
 * them for what you want: better odds, a smaller loss, a bigger upside, or a balance. Read-only: it
 * never places an order.
 *
 * Reads top to bottom as the questions a trader asks: where do I stand (the strip), what do I want
 * (the goal), what are my best moves (the cards), what exactly does one do (the detail) and what if
 * my idea isn't on the list (build your own). All the maths is in lib/whatIf.ts, on the same model
 * as the Risk & Probability tab, and priced from the live option chain the page already polls.
 */

import { useMemo, useRef, useState } from "react";

import { Reveal, Section, eyebrow, pillButton } from "@/components/averaging/ui";
import MoveCard from "@/components/whatif/MoveCard";
import MoveDetail, { type ChartGroup } from "@/components/whatif/MoveDetail";
import CustomBuilder from "@/components/whatif/CustomBuilder";
import Select from "@/components/Select";
import { compactMoney, money, percent, TONE_TEXT, type Tone } from "@/components/whatif/shared";
import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { loadAveragingPrefs, saveAveragingPrefs } from "@/lib/averagingPrefs";
import type { UpstoxOptionChainResult } from "@/lib/upstox/types";
import {
  buildBook,
  builderChanges,
  buildUnderlyings,
  describeChanges,
  evaluateChanges,
  FAMILY_LABELS,
  GOALS,
  rankMoves,
  runLab,
  underlyingLabel,
  type BuilderMove,
  type Evaluated,
  type Family,
  type Goal,
  type Outcome,
} from "@/lib/whatIf";

type WhatIfLabProps = {
  rows: PortfolioRow[] | null;
  /** The option chain per instrument+expiry the page polls - what new trades are priced from. */
  chains: Record<string, UpstoxOptionChainResult | undefined>;
  /** When the figures are from - the poll time, or the last-known time while the feed is down. */
  nowMs: number | null;
  /** True while polling is paused and the figures are the last good read. */
  paused: boolean;
};

const FAMILIES: Family[] = ["reduce", "add", "sell", "buy", "spread", "book"];

export default function WhatIfLab({ rows, chains, nowMs, paused }: WhatIfLabProps) {
  if (!rows || nowMs === null) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
        Waiting for live prices — the lab needs them to try moves on your positions.
      </div>
    );
  }
  return <LabBody rows={rows} chains={chains} nowMs={nowMs} paused={paused} />;
}

// --- Where you stand ------------------------------------------------------------------------

function Tile({ label, value, hint, tone = "neutral" }: { label: string; value: string; hint: string; tone?: Tone }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-border bg-background p-3.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className={`mt-1 whitespace-nowrap font-mono text-xl font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function StandingStrip({ base }: { base: Outcome }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <Tile label="Chance of profit" value={percent(base.pop)} hint="at expiry" tone={base.pop >= 0.5 ? "good" : "bad"} />
      <Tile label="Expected P&L" value={compactMoney(base.expectedPnl)} hint="the average outcome" tone={base.expectedPnl >= 0 ? "good" : "bad"} />
      <Tile label="Bad case" value={compactMoney(base.p5)} hint="1 time in 20 is worse" tone={base.p5 < 0 ? "bad" : "good"} />
      <Tile label="Good case" value={compactMoney(base.p95)} hint="1 time in 20 is better" tone={base.p95 > 0 ? "good" : "bad"} />
      <Tile
        label="Worst case"
        value={base.maxLoss === null ? "Unlimited" : `${compactMoney(base.maxLoss)}${base.worstIsRemote ? "*" : ""}`}
        hint={base.worstIsRemote ? "*only if the index hit zero" : "the most you can lose"}
        tone={base.maxLoss === null ? "bad" : "neutral"}
      />
      <Tile label="Time decay" value={`${compactMoney(base.thetaPerDay)}/day`} hint={base.thetaPerDay >= 0 ? "time is paying you" : "time is costing you"} tone={base.thetaPerDay >= 0 ? "good" : "bad"} />
    </div>
  );
}

// --- The lab --------------------------------------------------------------------------------

function LabBody({ rows, chains, nowMs, paused }: { rows: PortfolioRow[]; chains: WhatIfLabProps["chains"]; nowMs: number; paused: boolean }) {
  // Mounts only once this tab is chosen and prices have arrived, so it runs in the browser - localStorage is there to read.
  const [prefs, setPrefs] = useState(loadAveragingPrefs);
  const [fundsText, setFundsText] = useState(() => (prefs.funds === null ? "" : String(prefs.funds)));
  const [goal, setGoal] = useState<Goal>("balanced");
  const [family, setFamily] = useState<Family | "all">("all");
  const [allowOpenEnded, setAllowOpenEnded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [customMoves, setCustomMoves] = useState<BuilderMove[]>([]);
  const detailRef = useRef<HTMLDivElement>(null);

  const book = useMemo(() => buildBook(rows, nowMs), [rows, nowMs]);
  const unders = useMemo(() => buildUnderlyings(chains, nowMs), [chains, nowMs]);

  // New trades are offered in one instrument + expiry at a time - the one the book leans on most, unless chosen.
  const focus = useMemo(() => {
    const chosen = unders.find((u) => u.key === focusKey);
    if (chosen) return chosen;
    const held = (key: string) => book.legs.filter((l) => l.groupKey === key).length;
    return unders.reduce<(typeof unders)[number] | null>((best, u) => (best === null || held(u.key) > held(best.key) ? u : best), null);
  }, [unders, focusKey, book]);

  const funds = prefs.funds;
  const lab = useMemo(() => runLab({ book, unders, focusKey: focus?.key ?? null, funds }), [book, unders, focus, funds]);
  const ranked = useMemo(() => rankMoves(lab.moves, { goal, family, allowOpenEnded }), [lab.moves, goal, family, allowOpenEnded]);
  const familyCounts = useMemo(
    () =>
      Object.fromEntries(FAMILIES.map((f) => [f, rankMoves(lab.moves, { goal, family: f, allowOpenEnded, limit: 999 }).length])) as Record<Family, number>,
    [lab.moves, goal, allowOpenEnded],
  );

  const selected: Evaluated | null = lab.moves.find((m) => m.action.id === selectedId) ?? ranked[0] ?? null;

  const customChanges = useMemo(() => builderChanges(customMoves, book, focus), [customMoves, book, focus]);
  const custom = useMemo(
    () =>
      customChanges.length === 0
        ? null
        : evaluateChanges({ book, unders, funds }, lab.base, lab.scale, {
            id: "custom",
            family: "book",
            bucket: "custom",
            headline: "Your mix",
            detail: describeChanges(customChanges, book),
            changes: customChanges,
          }),
    [customChanges, book, unders, funds, lab.base, lab.scale],
  );

  const firstLeg = book.legs[0];
  const chartGroup: ChartGroup | null = focus
    ? { key: focus.key, spot: focus.spot, instrument: focus.instrument }
    : firstLeg
      ? { key: firstLeg.groupKey, spot: firstLeg.spot, instrument: firstLeg.instrument }
      : null;

  function updateFunds(text: string) {
    setFundsText(text);
    const n = Number(text.replace(/,/g, ""));
    const next = text.trim() === "" ? null : Number.isFinite(n) && n > 0 ? n : prefs.funds;
    const updated = { ...prefs, funds: next };
    setPrefs(updated);
    saveAveragingPrefs(updated);
  }

  function pickGoal(next: Goal) {
    setGoal(next);
    setSelectedId(null);
  }
  function pickFamily(next: Family | "all") {
    setFamily(next);
    setSelectedId(null);
  }
  function select(id: string) {
    setSelectedId(id);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // After the detail has swapped in, so it lands on the right block.
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }));
  }

  if (book.legs.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
        No open positions with a live price and volatility to work from yet. Once one is priced, the lab will try exits, adds, hedges and new trades on it.
        {book.skipped > 0 && ` ${book.skipped} open position${book.skipped === 1 ? " is" : "s are"} still waiting for prices.`}
      </div>
    );
  }

  const goalInfo = GOALS.find((g) => g.id === goal) ?? GOALS[0];
  const unaffordableCount = lab.moves.filter((m) => m.unaffordable).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Where the book stands, and the few settings that shape what's offered */}
      <Reveal index={0} className="flex flex-col gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            The lab tries every sensible move on your {book.legs.length} modelled position{book.legs.length === 1 ? "" : "s"} — {lab.moves.length.toLocaleString("en-IN")} in all — and shows what each does to your
            odds and your risk. It never places an order.
          </p>
          {paused && (
            <p className="mt-1 text-sm text-warning" role="status">
              Live prices are paused, so these figures use the last prices seen
              {unders.length === 0 && " — and without the option chain, new trades can't be priced; only exits are shown"}.
            </p>
          )}
        </div>
        <StandingStrip base={lab.base} />
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
            Your available funds (₹)
            <input
              inputMode="numeric"
              value={fundsText}
              onChange={(e) => updateFunds(e.target.value)}
              placeholder="optional"
              className="w-40 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </label>
          {unders.length > 1 && focus && (
            <div className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              <span id="lab-focus-label">New trades in</span>
              <div className="w-56" aria-labelledby="lab-focus-label">
                <Select size="sm" value={focus.key} onChange={(v) => setFocusKey(v)} options={unders.map((u) => ({ value: u.key, label: underlyingLabel(u) }))} />
              </div>
            </div>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
            <input type="checkbox" checked={allowOpenEnded} onChange={(e) => setAllowOpenEnded(e.target.checked)} className="size-4 accent-[var(--accent-solid)]" />
            <span>
              Include moves with <strong className="font-semibold">no ceiling on the loss</strong>
            </span>
          </label>
        </div>
        {funds === null && <p className="text-xs text-muted-foreground">Enter your funds to hide trades you can&apos;t afford.</p>}
        {funds !== null && unaffordableCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {unaffordableCount} move{unaffordableCount === 1 ? "" : "s"} costing more than {money(funds)} {unaffordableCount === 1 ? "is" : "are"} hidden.
          </p>
        )}
        {book.skipped > 0 && (
          <p className="text-xs text-muted-foreground">
            {book.skipped} open position{book.skipped === 1 ? "" : "s"} can&apos;t be modelled (no live price or volatility) and {book.skipped === 1 ? "is" : "are"} left out, as on the Risk tab.
          </p>
        )}
      </Reveal>

      {/* What do you want */}
      <Reveal index={1}>
        <Section step={1} title="What do you want?" subtitle="Pick a goal and the lab ranks every move for it. A trade can't create an edge — it trades one kind of outcome for another, and each card shows the price of that.">
          <div className="flex flex-col gap-3">
            <div role="group" aria-label="Goal" className="flex flex-wrap gap-2">
              {GOALS.map((g) => (
                <button key={g.id} type="button" aria-pressed={goal === g.id} onClick={() => pickGoal(g.id)} className={pillButton(goal === g.id)}>
                  {g.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{goalInfo.blurb}</p>
            <div role="group" aria-label="Kind of move" className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={family === "all"} onClick={() => pickFamily("all")} className={pillButton(family === "all")}>
                All kinds
              </button>
              {FAMILIES.map((f) => (
                <button
                  key={f}
                  type="button"
                  aria-pressed={family === f}
                  onClick={() => pickFamily(f)}
                  disabled={familyCounts[f] === 0 && family !== f}
                  className={`${pillButton(family === f)} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {FAMILY_LABELS[f]}
                  <span className="font-mono text-xs opacity-70">{familyCounts[f]}</span>
                </button>
              ))}
            </div>
          </div>
        </Section>
      </Reveal>

      {/* The best moves */}
      <Reveal index={2}>
        <Section
          step={2}
          title={ranked.length > 0 ? `Best moves · ${goalInfo.label}` : "Best moves"}
          subtitle="Each card shows the chance of profit, the 1-in-20 bad case and the 1-in-20 good case — now, then after the move."
        >
          {ranked.length > 0 ? (
            <ol className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {ranked.map((m, i) => (
                <li key={m.action.id} className="min-w-0">
                  <MoveCard rank={i + 1} move={m} base={lab.base} scale={lab.scale} selected={selected?.action.id === m.action.id} onSelect={() => select(m.action.id)} />
                </li>
              ))}
            </ol>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-background p-5 text-sm">
              <p className="font-medium">Nothing here beats the position you hold.</p>
              <p className="mt-1 text-muted-foreground">
                {goal === "balanced"
                  ? "Every way of cutting your risk costs more upside than it saves, and every way of adding upside adds more risk than is worth it. Standing pat is a real answer."
                  : "No move improves this without breaking a limit — adding more than a quarter of today's bad case, or (unless you tick the box above) putting a ceiling-free loss on the book."}{" "}
                Try another goal, or build your own below.
              </p>
            </div>
          )}
        </Section>
      </Reveal>

      {/* What one does */}
      {selected && (
        <div ref={detailRef} className="scroll-mt-4">
          <Reveal index={3}>
            <MoveDetail
              key={selected.action.id}
              title={selected.action.headline}
              subtitle={selected.action.detail}
              move={selected}
              base={lab.base}
              scale={lab.scale}
              book={book}
              group={chartGroup}
            />
          </Reveal>
        </div>
      )}

      {/* Build your own */}
      <Reveal index={4}>
        <Section step={3} title="Build your own" subtitle="Combine moves — say, exit half and buy farther-out calls — and see what the mix does to the whole book.">
          <CustomBuilder moves={customMoves} onChange={setCustomMoves} book={book} focus={focus} />
        </Section>
        {custom && (
          <div className="mt-6">
            <MoveDetail
              key={`custom-${customChanges.length}-${describeChanges(customChanges, book)}`}
              title="Your mix"
              subtitle={custom.action.detail}
              move={custom}
              base={lab.base}
              scale={lab.scale}
              book={book}
              group={chartGroup}
            />
          </div>
        )}
      </Reveal>

      <details className="rounded-xl border border-border bg-background p-4 text-sm">
        <summary className={`cursor-pointer ${eyebrow}`}>How these numbers are made</summary>
        <div className="mt-3 flex flex-col gap-2 text-muted-foreground">
          <p>
            The book is valued by the same model as the Risk &amp; Probability tab: the index moves with no drift, every position uses its own implied volatility, and the payoff is taken at expiry before brokerage. So the
            &quot;now&quot; figures match that tab. A move changes the positions and the model is run again.
          </p>
          <p>
            New trades are priced from the live option chain — the real last price and implied volatility of each strike — and entered at that price. Exiting lots books their profit or loss today at the live price. Estimated brokerage and
            taxes are taken off. Everything left is held to expiry.
          </p>
          <p>
            <strong className="font-medium text-foreground">Why no move raises expected profit.</strong> In a fairly priced market every option is worth what it costs, so trading can&apos;t add to the average outcome — it only moves risk
            around: more outcomes that win but smaller wins, a smaller bad case but less upside. The lab ranks by those shapes and shows what each costs. A high chance of profit can hide a large loss, so watch the bad-case and
            typical-loss lines.
          </p>
          <p>
            Moves that add more than a quarter of today&apos;s bad case are left out of every goal except &quot;Cut my loss&quot;. The margin check asks Upstox for the whole book as a basket, so hedges count. This is a model, not a forecast or advice.
          </p>
        </div>
      </details>
    </div>
  );
}
