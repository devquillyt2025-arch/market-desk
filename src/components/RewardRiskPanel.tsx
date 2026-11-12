"use client";

/**
 * Reward : Risk - the tab beside What-if lab on Live Portfolio. It answers one question: of everything
 * I could do and still stay in the market, what pays the most for each rupee it puts at risk?
 *
 * It tries the same ideas as the What-if lab - part exits, adds, sold and bought options, spreads -
 * and ranks them by reward ÷ risk, highest first. Two honest guards go with that: a high ratio is
 * only ever bought with a lower chance of winning, so every row shows its chance of profit and the
 * long shots are tagged (and, in "new trades", hidden until asked for); and ideas with no ceiling on
 * the loss have no sensible ratio, so they stay out unless asked for and rank last when they're in.
 * Read-only: it never places an order.
 *
 * All the maths is in lib/rewardRisk.ts (on lib/whatIf.ts, on the Risk & Probability model).
 */

import { useMemo, useRef, useState } from "react";

import { Reveal, Section, eyebrow, pillButton } from "@/components/averaging/ui";
import Breakdown from "@/components/rewardrisk/Breakdown";
import IdeaRow from "@/components/rewardrisk/IdeaRow";
import Select from "@/components/Select";
import MoveDetail, { type ChartGroup } from "@/components/whatif/MoveDetail";
import { compactMoney, percent, Tile } from "@/components/whatif/shared";
import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { loadAveragingPrefs, saveAveragingPrefs } from "@/lib/averagingPrefs";
import { formatLevel, formatINR } from "@/lib/format";
import { LONG_SHOT_POP, rankByRewardRisk, ratioLabel, runRewardRisk, type Scope } from "@/lib/rewardRisk";
import type { UpstoxOptionChainResult } from "@/lib/upstox/types";
import {
  buildBook,
  buildUnderlyings,
  FAMILY_LABELS,
  pickFocus,
  underlyingLabel,
  type Book,
  type Evaluated,
  type Family,
  type Underlying,
} from "@/lib/whatIf";

type RewardRiskPanelProps = {
  rows: PortfolioRow[] | null;
  /** The option chain per instrument+expiry the page polls - what new trades are priced from. */
  chains: Record<string, UpstoxOptionChainResult | undefined>;
  /** When the figures are from - the poll time, or the last-known time while the feed is down. */
  nowMs: number | null;
  /** True while polling is paused and the figures are the last good read. */
  paused: boolean;
};

const FAMILIES: Family[] = ["reduce", "add", "sell", "buy", "spread", "book"];
const CHANCE_FLOORS: { value: number; label: string }[] = [
  { value: 0, label: "Any chance" },
  { value: LONG_SHOT_POP, label: "25%+" },
  { value: 0.4, label: "40%+" },
  { value: 0.5, label: "50%+" },
];
const PAGE = 10;

const SCOPES: { id: Scope; label: string; blurb: string }[] = [
  { id: "book", label: "With my positions", blurb: "Each idea is added to what you hold, and the ratio is your whole book's afterwards — so it shows what the idea does to the risk you're already running." },
  { id: "alone", label: "As new trades", blurb: "Each idea on its own, as if you held nothing — the best reward for the risk among trades you could put on fresh." },
];

/** Long shots are the price of a big ratio, so a fresh-trades list starts without them; a list about your own book doesn't hide anything. */
const defaultFloor = (scope: Scope) => (scope === "alone" ? LONG_SHOT_POP : 0);

export default function RewardRiskPanel({ rows, chains, nowMs, paused }: RewardRiskPanelProps) {
  if (!rows || nowMs === null) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
        Waiting for live prices — this tab needs them to price the ideas.
      </div>
    );
  }
  return <PanelBody rows={rows} chains={chains} nowMs={nowMs} paused={paused} />;
}

/** The instrument + expiry an idea trades in, for its chart - not just the one new trades are offered in. */
function chartGroupFor(move: Evaluated, book: Book, unders: Underlying[], fallback: Underlying | null): ChartGroup | null {
  for (const change of move.action.changes) {
    const key = change.kind === "open" ? change.groupKey : book.legs.find((l) => l.id === change.legId)?.groupKey;
    if (!key) continue;
    const u = unders.find((x) => x.key === key);
    if (u) return { key, spot: u.spot, instrument: u.instrument };
    const leg = book.legs.find((l) => l.groupKey === key);
    if (leg) return { key, spot: leg.spot, instrument: leg.instrument };
  }
  return fallback && { key: fallback.key, spot: fallback.spot, instrument: fallback.instrument };
}

function PanelBody({ rows, chains, nowMs, paused }: { rows: PortfolioRow[]; chains: RewardRiskPanelProps["chains"]; nowMs: number; paused: boolean }) {
  // Mounts only once this tab is chosen and prices have arrived, so it runs in the browser - localStorage is there to read.
  const [prefs, setPrefs] = useState(loadAveragingPrefs);
  const [fundsText, setFundsText] = useState(() => (prefs.funds === null ? "" : String(prefs.funds)));
  const [scope, setScope] = useState<Scope>("book");
  const [minPop, setMinPop] = useState(defaultFloor("book"));
  const [family, setFamily] = useState<Family | "all">("all");
  const [allowUncapped, setAllowUncapped] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  const book = useMemo(() => buildBook(rows, nowMs), [rows, nowMs]);
  const unders = useMemo(() => buildUnderlyings(chains, nowMs), [chains, nowMs]);
  const focus = useMemo(() => pickFocus(unders, book, focusKey), [unders, book, focusKey]);
  // With no modelled position to add to there is only one way to look at an idea.
  const activeScope: Scope = book.legs.length === 0 ? "alone" : scope;
  const funds = prefs.funds;

  const lab = useMemo(
    () => runRewardRisk({ book, unders, focusKey: focus?.key ?? null, funds, scope: activeScope }),
    [book, unders, focus, funds, activeScope],
  );
  const { ranked, hidden } = useMemo(() => rankByRewardRisk(lab, { minPop, allowUncapped, family }), [lab, minPop, allowUncapped, family]);
  const familyCounts = useMemo(
    () =>
      Object.fromEntries(FAMILIES.map((f) => [f, rankByRewardRisk(lab, { minPop, allowUncapped, family: f }).ranked.length])) as Record<Family, number>,
    [lab, minPop, allowUncapped],
  );

  const selected = ranked.find((i) => i.move.action.id === selectedId) ?? ranked[0] ?? null;
  const group = selected ? chartGroupFor(selected.move, lab.book, unders, focus) : null;
  const visible = ranked.slice(0, shown);

  function updateFunds(text: string) {
    setFundsText(text);
    const n = Number(text.replace(/,/g, ""));
    const next = text.trim() === "" ? null : Number.isFinite(n) && n > 0 ? n : prefs.funds;
    const updated = { ...prefs, funds: next };
    setPrefs(updated);
    saveAveragingPrefs(updated);
  }

  /** Any change to what's listed starts the list again from the top. */
  function restart() {
    setSelectedId(null);
    setShown(PAGE);
  }
  function pickScope(next: Scope) {
    setScope(next);
    setMinPop(defaultFloor(next));
    setFamily("all");
    restart();
  }
  function pickFloor(next: number) {
    setMinPop(next);
    restart();
  }
  function pickFamily(next: Family | "all") {
    setFamily(next);
    restart();
  }
  function toggleUncapped(next: boolean) {
    setAllowUncapped(next);
    restart();
  }
  function select(id: string) {
    setSelectedId(id);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    // After the detail has swapped in, so it lands on the right block.
    requestAnimationFrame(() => detailRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" }));
  }

  const scopeInfo = SCOPES.find((s) => s.id === activeScope) ?? SCOPES[0];
  const base = lab.base;
  const baseRr = lab.baseRr;
  const notes: string[] = [];
  if (hidden.longShots > 0) {
    notes.push(
      `${hidden.longShots} idea${hidden.longShots === 1 ? " that wins" : "s that win"} less than ${percent(minPop)} of the time ${hidden.longShots === 1 ? "is" : "are"} hidden — long shots are where the biggest ratios are.`,
    );
  }
  if (hidden.uncapped > 0) {
    notes.push(`${hidden.uncapped} idea${hidden.uncapped === 1 ? " with" : "s with"} no ceiling on the loss ${hidden.uncapped === 1 ? "is" : "are"} hidden — they would rank last.`);
  }
  if (hidden.unaffordable > 0 && funds !== null) {
    notes.push(`${hidden.unaffordable} idea${hidden.unaffordable === 1 ? " costing" : "s costing"} more than ${formatINR(funds)} ${hidden.unaffordable === 1 ? "is" : "are"} hidden.`);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Where the book stands, and the few settings that shape what's offered */}
      <Reveal index={0} className="flex flex-col gap-4">
        <div>
          <p className="text-sm text-muted-foreground">
            Everything the What-if lab can price that keeps you in the market, ranked by how much it can make for each ₹1 it puts at risk — highest first. It never places an order.
          </p>
          {paused && (
            <p className="mt-1 text-sm text-warning" role="status">
              Live prices are paused, so these figures use the last prices seen
              {unders.length === 0 && " — and without the option chain, new trades can't be priced"}.
            </p>
          )}
        </div>

        {activeScope === "book" ? (
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            <Tile
              label="Reward : risk now"
              value={ratioLabel(baseRr)}
              hint={baseRr.risk === null ? "no ceiling on the loss" : "your book, reward per ₹1 risked"}
              tone={baseRr.risk === null ? "bad" : "neutral"}
            />
            <Tile label="You can lose" value={baseRr.risk === null ? "No cap" : compactMoney(baseRr.risk)} hint="at most, at expiry" tone={baseRr.risk === null ? "bad" : "neutral"} />
            <Tile
              label="You can make"
              value={`${baseRr.rewardIsEstimate ? "~" : ""}${compactMoney(baseRr.reward)}`}
              hint={baseRr.rewardIsEstimate ? "1-in-20 good case · no practical cap" : "at most, at expiry"}
              tone="good"
            />
            <Tile label="Chance of profit" value={percent(base.pop)} hint="at expiry" tone={base.pop >= 0.5 ? "good" : "bad"} />
          </div>
        ) : (
          focus && (
            <p className="rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-muted-foreground">
              Priced from the live chain for <span className="font-medium text-foreground">{underlyingLabel(focus)}</span> — spot at{" "}
              <span className="font-mono tabular-nums text-foreground">{formatLevel(focus.spot)}</span>, {focus.dte === 0 ? "expires today" : `${focus.dte} day${focus.dte === 1 ? "" : "s"} to expiry`}.
            </p>
          )
        )}

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
              <span id="rr-focus-label">New trades in</span>
              <div className="w-56" aria-labelledby="rr-focus-label">
                <Select size="sm" value={focus.key} onChange={(v) => { setFocusKey(v); restart(); }} options={unders.map((u) => ({ value: u.key, label: underlyingLabel(u) }))} />
              </div>
            </div>
          )}
          <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
            <input type="checkbox" checked={allowUncapped} onChange={(e) => toggleUncapped(e.target.checked)} className="size-4 accent-[var(--accent-solid)]" />
            <span>
              Include ideas with <strong className="font-semibold">no ceiling on the loss</strong>
            </span>
          </label>
        </div>
        {funds === null && <p className="text-xs text-muted-foreground">Enter your funds to hide trades you can&apos;t afford.</p>}
        {book.skipped > 0 && (
          <p className="text-xs text-muted-foreground">
            {book.skipped} open position{book.skipped === 1 ? "" : "s"} can&apos;t be modelled (no live price or volatility) and {book.skipped === 1 ? "is" : "are"} left out, as on the Risk tab.
          </p>
        )}
      </Reveal>

      {/* What to rank */}
      <Reveal index={1}>
        <Section step={1} title="What are you ranking?" subtitle="A bigger ratio always means a smaller chance of getting it — so choose how likely you need an idea to be, as well as how much it pays.">
          <div className="flex flex-col gap-3">
            <div role="group" aria-label="Measure ideas" className="flex flex-wrap gap-2">
              {SCOPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={activeScope === s.id}
                  disabled={s.id === "book" && book.legs.length === 0}
                  onClick={() => pickScope(s.id)}
                  className={`${pillButton(activeScope === s.id)} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">{scopeInfo.blurb}</p>

            <div className="flex flex-col gap-1.5">
              <span id="rr-floor-label" className={eyebrow}>
                Chance of profit at least
              </span>
              <div role="group" aria-labelledby="rr-floor-label" className="flex flex-wrap gap-2">
                {CHANCE_FLOORS.map((f) => (
                  <button key={f.value} type="button" aria-pressed={minPop === f.value} onClick={() => pickFloor(f.value)} className={pillButton(minPop === f.value)}>
                    {f.label}
                  </button>
                ))}
              </div>
            </div>

            <div role="group" aria-label="Kind of idea" className="flex flex-wrap gap-2">
              <button type="button" aria-pressed={family === "all"} onClick={() => pickFamily("all")} className={pillButton(family === "all")}>
                All kinds
              </button>
              {FAMILIES.filter((f) => familyCounts[f] > 0 || family === f).map((f) => (
                <button key={f} type="button" aria-pressed={family === f} onClick={() => pickFamily(f)} className={pillButton(family === f)}>
                  {FAMILY_LABELS[f]}
                  <span className="font-mono text-xs opacity-70">{familyCounts[f]}</span>
                </button>
              ))}
            </div>
          </div>
        </Section>
      </Reveal>

      {/* The ranking */}
      <Reveal index={2}>
        <Section
          step={2}
          title={ranked.length > 0 ? "Highest reward for the risk, first" : "Reward for the risk"}
          subtitle={
            ranked.some((i) => i.rr.rewardIsEstimate)
              ? "~ means the profit has no practical cap, so the 1-in-20 good case is used for it. Tap an idea for the working and the picture."
              : "Tap an idea for the working and the picture."
          }
        >
          {notes.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              {notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          {ranked.length > 0 ? (
            <>
              <ol className="flex flex-col gap-3">
                {visible.map((idea, i) => (
                  <li key={idea.move.action.id} className="min-w-0">
                    <IdeaRow
                      rank={i + 1}
                      idea={idea}
                      baseRr={baseRr}
                      scope={activeScope}
                      selected={selected?.move.action.id === idea.move.action.id}
                      onSelect={() => select(idea.move.action.id)}
                    />
                  </li>
                ))}
              </ol>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  Showing {visible.length} of {ranked.length}, highest ratio first
                  {visible.length === ranked.length && " — that's the lowest"}.
                </p>
                {visible.length < ranked.length && (
                  <div className="flex gap-2">
                    <button type="button" onClick={() => setShown((n) => n + PAGE)} className={pillButton(false)}>
                      Show {Math.min(PAGE, ranked.length - visible.length)} more
                    </button>
                    <button type="button" onClick={() => setShown(ranked.length)} className={pillButton(false)}>
                      Show all
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-background p-5 text-sm">
              <p className="font-medium">Nothing to rank with these settings.</p>
              <p className="mt-1 text-muted-foreground">
                {lab.ideas.length === 0
                  ? "The option chain hasn't loaded, so there are no trades to price yet."
                  : activeScope === "book" && baseRr.risk === null && !allowUncapped
                    ? "Your book has no ceiling on its loss, and none of these ideas puts one on it. Tick the box above to see them anyway, or build a hedge in the What-if lab."
                    : "Loosen the chance of profit or the kind of idea above — the notes under the heading say what is being held back."}
              </p>
            </div>
          )}
        </Section>
      </Reveal>

      {/* The working */}
      {selected && (
        <div ref={detailRef} className="scroll-mt-4">
          <Reveal index={3}>
            <MoveDetail
              key={selected.move.action.id}
              title={selected.move.action.headline}
              subtitle={selected.move.action.detail}
              move={selected.move}
              base={base}
              scale={lab.scale}
              book={lab.book}
              group={group}
              standalone={activeScope === "alone"}
            >
              <Breakdown idea={selected} baseRr={baseRr} scope={activeScope} />
            </MoveDetail>
          </Reveal>
        </div>
      )}

      <details className="rounded-xl border border-border bg-background p-4 text-sm">
        <summary className={`cursor-pointer ${eyebrow}`}>How these numbers are made</summary>
        <div className="mt-3 flex flex-col gap-2 text-muted-foreground">
          <p>
            <strong className="font-medium text-foreground">Risk</strong> is the most the position can lose at expiry, and <strong className="font-medium text-foreground">reward</strong> the most it can make — the same
            figures as the Risk &amp; Probability and Analysis tabs, after estimated brokerage and taxes. The ratio is reward ÷ risk: 3 : 1 is ₹3 of reward for every ₹1 risked (the Risk tab shows it the other way round, as ₹ risked per ₹1 of reward).
          </p>
          <p>
            Where the profit has no cap (a bought call), or only exists if the index went to zero (a bought put), &quot;the most it can make&quot; would be meaningless, so the 1-in-20 good case stands in for it — those carry a ~. A position that can
            lose without limit has no sensible ratio, so it ranks last and stays out unless you tick the box. If a position can&apos;t lose at all on these numbers it shows &quot;No loss&quot; and ranks first.
          </p>
          <p>
            Prices come from the live option chain and the odds from the same model as the Risk &amp; Probability tab: the index moves with no drift and every option uses its own implied volatility. Each kind of idea is shown once, at the size with
            the best ratio — or, where sizes are equally good, the smallest. Ideas that would close everything aren&apos;t listed, because this tab is about staying in the market. A bull put spread and a bull call spread at the same strikes earn the
            same ratio (that is put–call parity); they differ in the margin they block, which the detail below can check with Upstox.
          </p>
          <p>
            <strong className="font-medium text-foreground">Why a big ratio isn&apos;t an edge.</strong> In a fairly priced market the ratio and the chance of winning trade off almost exactly, so the average outcome stays near zero — a little below it
            after charges. An 8 : 1 idea that wins one time in nine and a 1 : 3 idea that wins three times in four are worth the same on average. The ratio tells you the shape of the bet; whether you want that shape depends on how likely
            you think the move is. This is a model, not a forecast or advice.
          </p>
        </div>
      </details>
    </div>
  );
}
