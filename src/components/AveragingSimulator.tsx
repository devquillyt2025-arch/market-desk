"use client";

/**
 * Averaging Simulator — the "Simulate averaging" tab beside Risk & Probability on
 * Live Portfolio. Pick an open long option and ask "what if I bought N more lots
 * here?". Read-only: it never places an order.
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
import { useMemo, useState } from "react";

import BeforeAfterChart from "@/components/averaging/BeforeAfterChart";
import BreakevenCards from "@/components/averaging/BreakevenCards";
import LadderTable from "@/components/averaging/LadderTable";
import LotsTable from "@/components/averaging/LotsTable";
import { pillButton, ScenarioSwitch, Section } from "@/components/averaging/ui";
import VerdictCard from "@/components/averaging/VerdictCard";
import WhatIfBuilder, { type QuickPick } from "@/components/averaging/WhatIfBuilder";
import ConfirmDialog from "@/components/ConfirmDialog";
import { ExternalLinkIcon } from "@/components/icons";
import {
  buildLadder,
  buildLotsTable,
  buildPayoffCurve,
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
import { formatAsOf, formatLevel } from "@/lib/format";
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
};

type AveragingSimulatorProps = {
  candidates: SimulatorCandidate[];
  /** The position being simulated; the first candidate when null or no longer simulatable. */
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** When the prices are from — the poll time, or the last-known time while the feed is down. */
  nowMs: number | null;
};

export default function AveragingSimulator({ candidates, selectedId, onSelect, nowMs }: AveragingSimulatorProps) {
  const selected = candidates.find((c) => c.id === selectedId) ?? candidates[0];
  if (!selected || nowMs === null) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
        Nothing to simulate yet. This works on open long (bought) calls and puts that have a live price — short
        positions and rows still waiting for prices are skipped.
      </div>
    );
  }
  // Keyed by position, so switching positions starts from a clean lots / price rather than carrying them over.
  return (
    <SimulatorBody key={selected.id} candidate={selected} candidates={candidates} onSelect={onSelect} nowMs={nowMs} />
  );
}

function SimulatorBody({
  candidate,
  candidates,
  onSelect,
  nowMs,
}: {
  candidate: SimulatorCandidate;
  candidates: SimulatorCandidate[];
  onSelect: (id: string) => void;
  nowMs: number;
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
  const activeLabel = scenarios.find((s) => s.key === activeKey)?.label ?? "Today";
  const curve = useMemo(
    () => buildPayoffCurve(position, market, result.extraLots, result.buyPrice, activeKey),
    [position, market, result.extraLots, result.buyPrice, activeKey],
  );

  const sliderMax = Math.min(Math.max(tableLots, extraLots, 1), MAX_TABLE_LOTS);
  const quickPicks = useMemo<QuickPick[]>(() => {
    const picks: QuickPick[] = [{ key: "one", label: "1 lot", lots: 1 }];
    const sweet = lotsTable.sweetSpot;
    if (sweet !== null && sweet > 1) picks.push({ key: "sweet", label: `Sweet spot · ${sweet}`, lots: sweet });
    const max = prefs.funds === null ? 0 : result.maxAffordableLots;
    if (max > 1 && max !== sweet) picks.push({ key: "max", label: `Max · ${max}`, lots: max });
    return picks;
  }, [lotsTable.sweetSpot, prefs.funds, result.maxAffordableLots]);

  const canOpenAnalysis = result.buyPrice !== null && result.extraLots >= 1;

  function goToAnalysis() {
    if (result.buyPrice === null) return;
    saveAnalysis(toAnalysisStrategy(position, result.extraLots, result.buyPrice));
    router.push("/analysis");
  }

  function handleOpenInAnalysis() {
    if (!canOpenAnalysis) return;
    // Analysis keeps one working strategy; don't silently throw away a non-empty one.
    const saved = loadSavedAnalysis();
    if (saved && saved.legs.length > 0) setConfirmReplace(true);
    else goToAnalysis();
  }

  const dteTone = result.dte <= 5 ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground";

  return (
    <div className="flex flex-col gap-6">
      {/* Which position, and how it's priced right now */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-3">
          <div role="group" aria-label="Position to simulate" className="flex flex-wrap gap-2">
            {candidates.map((c) => {
              const active = c.id === candidate.id;
              return (
                <button key={c.id} type="button" aria-pressed={active} onClick={() => onSelect(c.id)} className={pillButton(active)}>
                  {c.contract}
                  <span className="font-mono text-xs opacity-70">
                    {c.position.lots} lot{c.position.lots === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            <span>
              Long {position.type === "CE" ? "call" : "put"} · LTP <span className="font-mono font-semibold tabular-nums text-foreground">{ltp.toFixed(2)}</span>
            </span>
            <span>
              {indexName} <span className="font-mono font-semibold tabular-nums text-foreground">{formatLevel(spot)}</span>
            </span>
            <span>
              Your average <span className="font-mono font-semibold tabular-nums text-foreground">{position.avgPrice.toFixed(2)}</span>
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${dteTone}`}>
              {result.dte <= 0 ? "Expires today" : `${result.dte} day${result.dte === 1 ? "" : "s"} to expiry`}
            </span>
            <span className={`text-xs ${stale ? "font-medium text-warning" : ""}`}>
              {stale ? `Last prices ${formatAsOf(nowMs)}` : `Updated ${new Date(nowMs).toLocaleTimeString("en-IN")}`}
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={handleOpenInAnalysis}
            disabled={!canOpenAnalysis}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-accent-solid px-4 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40 sm:min-h-10"
          >
            <ExternalLinkIcon className="size-4" />
            Open in Analysis
          </button>
          <p className="text-xs text-muted-foreground">
            {canOpenAnalysis ? "Loads this position plus the simulated lots." : "Add a lot and a buy price first."}
          </p>
        </div>
      </div>

      <p className="-mt-3 text-xs text-muted-foreground">
        Simulation only — this never places an order. Treats this as a naked long leg; hedges in other rows are
        ignored.
      </p>

      {/* Decide, then see the result beside it */}
      <div className="grid items-start gap-6 xl:grid-cols-12">
        <WhatIfBuilder
          className="xl:col-span-5"
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
          className="xl:col-span-7"
          verdict={verdict}
          result={result}
          position={position}
          funds={prefs.funds}
          indexName={indexName}
        />
      </div>

      {/* What it looks like */}
      <Section
        title="Profit or loss, before vs after"
        subtitle={`${activeLabel}${activeKey === "today" ? "" : ", theta-adjusted"} — hover or touch the chart for exact figures.`}
        action={<ScenarioSwitch scenarios={scenarios} value={activeKey} onChange={setScenarioKey} />}
      >
        <div className="rounded-2xl border border-border bg-background p-3 sm:p-4">
          {curve ? (
            <BeforeAfterChart curve={curve} spot={spot} indexName={indexName} />
          ) : (
            <p className="p-6 text-center text-sm text-muted-foreground">Nothing to chart yet.</p>
          )}
        </div>
      </Section>

      {/* How far must it move */}
      <BreakevenCards
        after={result.scenarios.after}
        before={result.scenarios.before}
        active={activeKey}
        onSelect={setScenarioKey}
        indexName={indexName}
      />

      {/* How many lots, and the exact numbers */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <LotsTable
          table={lotsTable}
          selected={result.extraLots}
          onSelect={setExtraLots}
          fundsSet={prefs.funds !== null}
          hasPrice={result.buyPrice !== null}
          truncated={prefs.funds !== null && result.maxAffordableLots > MAX_TABLE_LOTS}
        />
        <LadderTable rows={ladder} scenarioKey={activeKey} scenarioLabel={activeLabel} indexName={indexName} />
      </div>

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
