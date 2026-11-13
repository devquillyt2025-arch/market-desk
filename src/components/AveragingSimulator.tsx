"use client";

/**
 * Averaging Simulator — the "Simulate averaging" tab beside Risk & Probability on
 * Live Portfolio, and the matching tab on the Analysis page (where the bought legs
 * of the strategy on screen are the positions). Pick a long option and ask "what
 * if I bought N more lots here?". Read-only: it never places an order.
 *
 * Reads top to bottom as the questions a trader asks: what am I trying (your
 * what-if), what does it do (what changes), what does it look like (the chart),
 * how far must it move (break-even cards), how many lots (the table), and the
 * exact numbers (the ladder). All the maths is in lib/averaging.ts, which runs
 * on the same engine as the Analysis tab; this file holds the inputs and lays
 * the results out. The candidates carry the latest poll's spot and LTP, so
 * every poll recomputes everything on screen.
 */

import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import BeforeAfterChart from "@/components/averaging/BeforeAfterChart";
import BreakevenCards from "@/components/averaging/BreakevenCards";
import LadderTable from "@/components/averaging/LadderTable";
import LiveStrip from "@/components/averaging/LiveStrip";
import LotsTable from "@/components/averaging/LotsTable";
import PositionHeader from "@/components/averaging/PositionHeader";
import { Reveal, ScenarioSwitch, scenarioName, Section } from "@/components/averaging/ui";
import VerdictCard from "@/components/averaging/VerdictCard";
import WhatIfBuilder, { type QuickPick } from "@/components/averaging/WhatIfBuilder";
import ConfirmDialog from "@/components/ConfirmDialog";
import {
  buildLadder,
  buildLotsTable,
  buildPayoffCurve,
  lotsWithinRiskLimit,
  MAX_TABLE_LOTS,
  priceMoved,
  simulateAveraging,
  summarizeAveraging,
  toAnalysisStrategy,
  UNSET_FUNDS_TABLE_LOTS,
  type AveragingPosition,
  type ScenarioKey,
} from "@/lib/averaging";
import { loadAveragingPrefs, saveAveragingPrefs, type AveragingPrefs } from "@/lib/averagingPrefs";
import { loadSavedAnalysis, saveAnalysis } from "@/lib/savedAnalysis";
import { INSTRUMENT_LABELS } from "@/lib/types";

/** One open long option that can be simulated, with the latest poll's prices. */
export type SimulatorCandidate = {
  id: string;
  /** Display name, e.g. "Nifty 24000 CE". */
  contract: string;
  position: AveragingPosition;
  spot: number;
  /** The contract's live premium. */
  ltp: number;
  /** True when these are last-known prices rather than a current poll. */
  stale: boolean;
  /** When the last-known prices are from, if that isn't the time the simulation is run at. */
  pricesAt?: number;
};

/**
 * What the main button does where "hand it to the Analysis page" doesn't fit — on the Analysis page
 * itself it adds the simulated lots to the strategy on screen instead.
 */
export type SimulatorApply = {
  label: string;
  /** The line under the button while it's ready. */
  hint: string;
  run: (candidate: SimulatorCandidate, extraLots: number, buyPrice: number) => void;
  /** Said for a few seconds after it has run, e.g. "Added 1 lot at 150.00 to your strategy". */
  doneText: (extraLots: number, buyPrice: number) => string;
};

type AveragingSimulatorProps = {
  candidates: SimulatorCandidate[];
  /** The position being simulated; the first candidate when null or no longer simulatable. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When the prices are from — the poll time, or the last-known time while the feed is down. */
  nowMs: number | null;
  /** Replaces the default "Open in Analysis" hand-off. */
  apply?: SimulatorApply;
  /** Shown when there is nothing to simulate. */
  emptyMessage?: string;
  /** The "simulation only" line at the foot of the position header. */
  note?: string;
};

const DEFAULT_EMPTY =
  "Nothing to simulate yet. This works on open long (bought) calls and puts that have a live price — short positions and rows still waiting for prices are skipped.";

export default function AveragingSimulator({
  candidates,
  selectedId,
  onSelect,
  nowMs,
  apply,
  emptyMessage = DEFAULT_EMPTY,
  note,
}: AveragingSimulatorProps) {
  const selected = candidates.find((c) => c.id === selectedId) ?? candidates[0];
  if (!selected || nowMs === null) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }
  // Keyed by position, so switching positions starts from a clean lots / price rather than carrying them over.
  return (
    <SimulatorBody
      key={selected.id}
      candidate={selected}
      candidates={candidates}
      onSelect={onSelect}
      nowMs={nowMs}
      apply={apply}
      note={note}
    />
  );
}

function SimulatorBody({
  candidate,
  candidates,
  onSelect,
  nowMs,
  apply,
  note,
}: {
  candidate: SimulatorCandidate;
  candidates: SimulatorCandidate[];
  onSelect: (id: string) => void;
  nowMs: number;
  apply?: SimulatorApply;
  note?: string;
}) {
  const { position, spot, ltp, stale } = candidate;
  const router = useRouter();
  const indexName = INSTRUMENT_LABELS[position.instrument];

  // Mounts only once this tab is chosen and prices have arrived, so it runs in the browser — localStorage is there to read.
  const [prefs, setPrefs] = useState<AveragingPrefs>(loadAveragingPrefs);
  const [extraLots, setExtraLots] = useState(1);
  /** null = the buy price follows the live LTP; a number = frozen (by the lock, or because it was typed). */
  const [lockedPrice, setLockedPrice] = useState<number | null>(null);
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>("today");
  const [confirmReplace, setConfirmReplace] = useState(false);
  /** What the button just did, said for a few seconds — see SimulatorApply.doneText. */
  const [appliedText, setAppliedText] = useState<string | null>(null);
  const appliedTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(appliedTimer.current), []);

  function updatePrefs(patch: Partial<AveragingPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveAveragingPrefs(next);
  }

  const buyPrice = lockedPrice ?? ltp;
  /** The frozen price, when the live one has since drifted away from it. */
  const movedFrom = lockedPrice !== null && priceMoved(lockedPrice, ltp) ? lockedPrice : null;

  const market = useMemo(() => ({ spot, ltp, nowMs, stale }), [spot, ltp, nowMs, stale]);
  const plan = useMemo(
    () => ({ extraLots, buyPrice, funds: prefs.funds, riskLimitPct: prefs.riskLimitPct }),
    [extraLots, buyPrice, prefs.funds, prefs.riskLimitPct],
  );
  const result = useMemo(() => simulateAveraging(position, market, plan), [position, market, plan]);
  const verdict = useMemo(() => summarizeAveraging(position, result, prefs.funds), [position, result, prefs.funds]);

  const tableLots = prefs.funds === null ? UNSET_FUNDS_TABLE_LOTS : result.maxAffordableLots;
  const lotsTable = useMemo(
    () => buildLotsTable(position, market, result.buyPrice, tableLots),
    [position, market, result.buyPrice, tableLots],
  );
  const ladder = useMemo(
    () => buildLadder(position, market, result.extraLots, result.buyPrice),
    [position, market, result.extraLots, result.buyPrice],
  );

  const scenarios = result.scenarios.after;
  const activeKey = scenarios.some((s) => s.key === scenarioKey) ? scenarioKey : "today";
  const activeScenario = scenarios.find((s) => s.key === activeKey) ?? scenarios[0];
  /** "Expiry · Tue, 10 Nov" — the date is always spelled out, even for Today and Expiry. */
  const activeLabel = activeScenario ? scenarioName(activeScenario) : "Today";
  const curve = useMemo(
    () => buildPayoffCurve(position, market, result.extraLots, result.buyPrice, activeKey),
    [position, market, result.extraLots, result.buyPrice, activeKey],
  );

  // The slider's scale follows what you can afford, not what's typed in — otherwise typing 15 into the
  // box would silently re-scale it and slide the thumb out from under you. Typed values past the end
  // pin the thumb to the right edge; the box still takes them.
  const sliderMax = Math.min(Math.max(tableLots, 1), MAX_TABLE_LOTS);
  const quickPicks = useMemo<QuickPick[]>(() => {
    const picks: QuickPick[] = [{ key: "one", label: "1 lot", lots: 1 }];
    // A pick that lands on a lot count already offered is dropped, so no two pills do the same thing.
    const add = (key: string, label: string, lots: number | null) => {
      if (lots !== null && lots > 1 && !picks.some((p) => p.lots === lots)) picks.push({ key, label: `${label} · ${lots}`, lots });
    };
    add("sweet", "Sweet spot", lotsTable.sweetSpot);
    if (prefs.funds !== null) {
      add("limit", "Within limit", lotsWithinRiskLimit(prefs.funds, prefs.riskLimitPct, result.before.capitalAtRisk, position.lotSize, result.buyPrice));
      add("max", "Max", result.maxAffordableLots);
    }
    return picks;
  }, [lotsTable.sweetSpot, prefs.funds, prefs.riskLimitPct, result.before.capitalAtRisk, result.buyPrice, result.maxAffordableLots, position.lotSize]);

  const canOpenAnalysis = result.buyPrice !== null && result.extraLots >= 1;

  function goToAnalysis() {
    if (result.buyPrice === null) return;
    saveAnalysis(toAnalysisStrategy(position, result.extraLots, result.buyPrice));
    router.push("/analysis");
  }

  function handleOpenInAnalysis() {
    if (!canOpenAnalysis) return;
    if (apply) {
      if (result.buyPrice === null) return;
      apply.run(candidate, result.extraLots, result.buyPrice);
      setAppliedText(apply.doneText(result.extraLots, result.buyPrice));
      window.clearTimeout(appliedTimer.current);
      appliedTimer.current = window.setTimeout(() => setAppliedText(null), 4000);
      return;
    }
    // Analysis keeps one working strategy; don't silently throw away a non-empty one.
    const saved = loadSavedAnalysis();
    if (saved && saved.legs.length > 0) setConfirmReplace(true);
    else goToAnalysis();
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Which position, and how it's priced right now */}
      <Reveal index={0}>
        <PositionHeader
          candidates={candidates}
          candidate={candidate}
          onSelect={onSelect}
          dte={result.dte}
          nowMs={nowMs}
          pricesAtMs={candidate.pricesAt}
          canOpenAnalysis={canOpenAnalysis}
          onOpenAnalysis={handleOpenInAnalysis}
          actionLabel={apply?.label}
          actionHint={apply?.hint}
          actionAdds={apply !== undefined}
          appliedText={appliedText}
          note={note}
        />
      </Reveal>

      {/* Decide, then see the result beside it */}
      <Reveal index={1} className="flex flex-col gap-6">
        <WhatIfBuilder
          liveSummary={<LiveStrip verdict={verdict} result={result} />}
          lots={extraLots}
          onLots={setExtraLots}
          sliderMax={sliderMax}
          quickPicks={quickPicks}
          lotSize={position.lotSize}
          heldLots={position.lots}
          avgPrice={position.avgPrice}
          extraQty={result.extraQty}
          extraCost={result.extraCost}
          buyPrice={buyPrice}
          locked={lockedPrice !== null}
          ltp={ltp}
          movedFrom={movedFrom}
          onPrice={setLockedPrice}
          onToggleLock={() => setLockedPrice(lockedPrice === null ? ltp : null)}
          onUseLive={() => setLockedPrice(null)}
          funds={prefs.funds}
          riskLimitPct={prefs.riskLimitPct}
          onFunds={(funds) => updatePrefs({ funds })}
          onRiskLimit={(riskLimitPct) => updatePrefs({ riskLimitPct })}
          capitalBefore={result.before.capitalAtRisk}
          capitalAfter={result.after.capitalAtRisk}
        />
        <VerdictCard
          verdict={verdict}
          result={result}
          position={position}
          funds={prefs.funds}
          indexName={indexName}
        />
      </Reveal>

      {/* What it looks like */}
      <Reveal index={2}>
        <Section
          step={3}
          title="Profit or loss, before vs after"
          subtitle={`${activeLabel}${activeKey === "today" ? "" : ", theta-adjusted"} — hover or touch the chart for exact figures.`}
          action={<ScenarioSwitch scenarios={scenarios} value={activeKey} onChange={setScenarioKey} />}
        >
          <div className="rounded-2xl border border-border bg-background p-3 shadow-sm sm:p-4">
            {curve ? (
              <BeforeAfterChart curve={curve} spot={spot} indexName={indexName} />
            ) : (
              <p className="p-6 text-center text-sm text-muted-foreground">Nothing to chart yet.</p>
            )}
          </div>
        </Section>
      </Reveal>

      {/* How far must it move */}
      <Reveal index={3}>
        <BreakevenCards
          after={result.scenarios.after}
          before={result.scenarios.before}
          active={activeKey}
          onSelect={setScenarioKey}
          indexName={indexName}
        />
      </Reveal>

      {/* How many lots, and the exact numbers */}
      <Reveal index={4} className="grid items-start gap-6 xl:grid-cols-2">
        <LotsTable
          table={lotsTable}
          selected={result.extraLots}
          onSelect={setExtraLots}
          fundsSet={prefs.funds !== null}
          hasPrice={result.buyPrice !== null}
          truncated={prefs.funds !== null && result.maxAffordableLots > MAX_TABLE_LOTS}
        />
        <LadderTable rows={ladder} scenarioKey={activeKey} scenarioLabel={activeLabel} indexName={indexName} />
      </Reveal>

      <AnimatePresence>
        {confirmReplace && (
          <ConfirmDialog
            title="Replace your Analysis strategy?"
            message="Analysis already has a strategy saved. Opening this replaces it with this position and the simulated lots."
            confirmLabel="Replace and open"
            onConfirm={() => {
              setConfirmReplace(false);
              goToAnalysis();
            }}
            onCancel={() => setConfirmReplace(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
