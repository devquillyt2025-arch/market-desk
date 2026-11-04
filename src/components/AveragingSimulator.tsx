"use client";

/**
 * Averaging Simulator — the "Simulate averaging" tab beside Risk & Probability on
 * Live Portfolio. Pick an open long option and ask "what if I bought N more lots
 * here?". Read-only: it never places an order. All the maths is in
 * lib/averaging.ts, which runs on the same engine as the Analysis tab; this file
 * only holds the inputs and lays the results out. The candidates carry the
 * latest poll's spot and LTP, so every poll recomputes everything on screen.
 */

import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import { AlertCircleIcon, ExternalLinkIcon, LockIcon } from "@/components/icons";
import { SEVERITY_STYLES } from "@/components/RiskProbabilityPanel";
import Stepper from "@/components/Stepper";
import {
  buildLadder,
  buildLotsTable,
  MAX_TABLE_LOTS,
  priceMoved,
  PRICE_TICK,
  simulateAveraging,
  toAnalysisStrategy,
  UNSET_FUNDS_TABLE_LOTS,
  type AveragingPosition,
  type GreeksSource,
  type PositionSnapshot,
  type ScenarioKey,
  type ScenarioResult,
} from "@/lib/averaging";
import { loadAveragingPrefs, saveAveragingPrefs, type AveragingPrefs } from "@/lib/averagingPrefs";
import { formatAsOf, formatINR, formatLevel, pnlColorClass } from "@/lib/format";
import { loadSavedAnalysis, saveAnalysis } from "@/lib/savedAnalysis";
import { INSTRUMENT_LABELS } from "@/lib/types";

const sectionTitle = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
const thClass = "whitespace-nowrap px-2 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/** `|| 0` folds -0 into plain 0 — otherwise a tiny negative rounds to "-0". */
const whole = (n: number) => Math.round(n) || 0;
const signedPts = (n: number) => `${n > 0 ? "+" : ""}${whole(n).toLocaleString("en-IN")} ${Math.abs(whole(n)) === 1 ? "pt" : "pts"}`;
const signedINR = (n: number) => `${n > 0 ? "+" : ""}${formatINR(n)}`;
const signedPct = (n: number, d = 1) => `${n > 0 ? "+" : ""}${n.toFixed(d)}%`;
const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
const num = (n: number, d = 2) => n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

const GREEKS_SOURCE_LABEL: Record<GreeksSource, string | null> = {
  engine: null,
  broker: "broker's Greeks — IV unavailable",
  estimated: "estimated — IV unavailable",
};

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

  // Mounts only once this tab is chosen and prices have arrived, so it runs in the browser — localStorage is there to read.
  const [prefs, setPrefs] = useState<AveragingPrefs>(loadAveragingPrefs);
  const [extraLots, setExtraLots] = useState(1);
  /** null = the buy price follows the live LTP; a number = frozen (by the lock, or because it was typed). */
  const [lockedPrice, setLockedPrice] = useState<number | null>(null);
  const [ladderTab, setLadderTab] = useState<ScenarioKey>("today");
  const [confirmReplace, setConfirmReplace] = useState(false);

  function updatePrefs(patch: Partial<AveragingPrefs>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveAveragingPrefs(next);
  }

  const buyPrice = lockedPrice ?? ltp;
  const locked = lockedPrice !== null;
  /** The frozen price, when the live one has since drifted away from it. */
  const movedFrom = lockedPrice !== null && priceMoved(lockedPrice, ltp) ? lockedPrice : null;
  const indexName = INSTRUMENT_LABELS[position.instrument];

  const market = useMemo(() => ({ spot, ltp, nowMs, stale }), [spot, ltp, nowMs, stale]);
  const plan = useMemo(
    () => ({ extraLots, buyPrice, funds: prefs.funds, riskLimitPct: prefs.riskLimitPct }),
    [extraLots, buyPrice, prefs.funds, prefs.riskLimitPct],
  );
  const result = useMemo(() => simulateAveraging(position, market, plan), [position, market, plan]);

  const tableLots = prefs.funds === null ? UNSET_FUNDS_TABLE_LOTS : result.maxAffordableLots;
  const lotsTable = useMemo(
    () => buildLotsTable(position, market, result.buyPrice, tableLots),
    [position, market, result.buyPrice, tableLots],
  );
  const ladder = useMemo(
    () => buildLadder(position, market, result.extraLots, result.buyPrice),
    [position, market, result.extraLots, result.buyPrice],
  );

  const sliderMax = Math.min(Math.max(tableLots, extraLots, 1), MAX_TABLE_LOTS);
  const { before, after } = result;
  const scenarioKeys = result.scenarios.after.map((s) => s.key);
  const activeTab = scenarioKeys.includes(ladderTab) ? ladderTab : "today";
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

  const greeksNote = GREEKS_SOURCE_LABEL[after.greeksSource];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <div role="group" aria-label="Position to simulate" className="flex flex-wrap gap-2">
            {candidates.map((c) => {
              const active = c.id === candidate.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => onSelect(c.id)}
                  className={`rounded-full border px-3 py-1 text-sm font-medium transition-colors active:scale-95 ${
                    active
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  {c.contract}
                  <span className="ml-1.5 font-mono text-xs opacity-70">
                    {c.position.lots} lot{c.position.lots === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted-foreground">
            <span className="font-mono tabular-nums">LTP {num(ltp)}</span>
            <span className="font-mono tabular-nums">Spot {formatLevel(spot)}</span>
            <span className="font-mono tabular-nums">Avg {num(position.avgPrice)}</span>
            <span className={stale ? "text-warning" : ""}>
              {stale ? `Last prices ${formatAsOf(nowMs)}` : `Updated ${new Date(nowMs).toLocaleTimeString("en-IN")}`}
            </span>
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={handleOpenInAnalysis}
            disabled={!canOpenAnalysis}
            className="flex items-center gap-1.5 rounded-lg bg-accent-solid px-3.5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ExternalLinkIcon className="size-4" />
            Open in Analysis
          </button>
          <p className="text-xs text-muted-foreground">
            {canOpenAnalysis ? "This position plus the simulated lots." : "Add a lot and a buy price first."}
          </p>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Simulation only — this never places an order. Treats this as a naked long leg; hedges in other rows are
        ignored.
      </p>

      <div className="grid items-start gap-5 xl:grid-cols-2">
        <div className="flex flex-col gap-5">
          {/* --- Inputs --------------------------------------------------- */}
          <section className="grid gap-4 sm:grid-cols-2" aria-label="Inputs">
            <div className="flex flex-col gap-2 sm:col-span-2">
              <div className="flex items-baseline justify-between gap-2">
                <label htmlFor="averaging-lots" className={labelClass}>
                  Lots to add
                </label>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {result.extraQty} qty · {formatINR(result.extraCost)}
                  {prefs.funds !== null && ` · ${result.maxAffordableLots} affordable`}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="averaging-lots"
                  type="range"
                  min={0}
                  max={sliderMax}
                  step={1}
                  value={Math.min(extraLots, sliderMax)}
                  onChange={(e) => setExtraLots(Number(e.target.value))}
                  className="h-2 min-w-0 flex-1 cursor-pointer accent-accent"
                />
                <Stepper value={extraLots} onChange={(v) => setExtraLots(Math.round(v))} step={1} min={0} max={1000} width="w-16" label="lots to add" />
              </div>
              <p className="text-xs text-muted-foreground">
                Lot size {position.lotSize} · holding {position.lots} lot{position.lots === 1 ? "" : "s"} at{" "}
                {num(position.avgPrice)}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="averaging-price" className={labelClass}>
                  Buy price
                  {!locked && (
                    <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] font-semibold normal-case tracking-normal text-profit">
                      <span className="size-1.5 animate-pulse rounded-full bg-profit" aria-hidden="true" />
                      live
                    </span>
                  )}
                </label>
                <button
                  type="button"
                  onClick={() => setLockedPrice(locked ? null : ltp)}
                  aria-pressed={locked}
                  title={locked ? "Follow the live price again" : "Freeze the buy price"}
                  className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium transition-colors active:scale-95 ${
                    locked
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <LockIcon className="size-3" />
                  {locked ? "Locked" : "Lock price"}
                </button>
              </div>
              <div>
                <Stepper
                  id="averaging-price"
                  value={buyPrice}
                  onChange={(v) => setLockedPrice(v)}
                  step={PRICE_TICK}
                  precision={2}
                  min={0}
                  width="w-24"
                  label="buy price"
                />
              </div>
              {movedFrom !== null && (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 font-semibold text-warning">
                    LTP moved {signedPct(((ltp - movedFrom) / movedFrom) * 100)}
                  </span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    now {num(ltp)} vs {num(movedFrom)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setLockedPrice(null)}
                    className="font-medium text-accent hover:underline"
                  >
                    Use live
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="averaging-funds" className={labelClass}>
                  Available funds (₹)
                </label>
                <div>
                  <Stepper
                    id="averaging-funds"
                    value={prefs.funds ?? 0}
                    onChange={(v) => updatePrefs({ funds: v > 0 ? v : null })}
                    step={5000}
                    min={0}
                    width="w-24"
                    label="available funds"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="averaging-limit" className={labelClass}>
                  Risk limit (%)
                </label>
                <div>
                  <Stepper
                    id="averaging-limit"
                    value={prefs.riskLimitPct}
                    onChange={(v) => updatePrefs({ riskLimitPct: v })}
                    step={5}
                    min={1}
                    max={100}
                    width="w-14"
                    label="capital-at-risk limit percent"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* --- Warnings -------------------------------------------------- */}
          {result.warnings.length > 0 && (
            <section className="flex flex-col gap-2" aria-label="Warnings">
              {result.warnings.map((w) => {
                const s = SEVERITY_STYLES[w.severity];
                return (
                  <div key={w.id} className={`flex items-start gap-2.5 rounded-lg border p-3 ${s.box}`}>
                    <AlertCircleIcon className={`mt-0.5 size-4 shrink-0 ${s.text}`} />
                    <p className="min-w-0 text-sm">
                      <span className="font-medium">{w.title}.</span>{" "}
                      <span className="text-muted-foreground">{w.detail}</span>
                    </p>
                  </div>
                );
              })}
            </section>
          )}

          {/* --- Before vs After ------------------------------------------- */}
          <section className="flex flex-col gap-2" aria-label="Before and after">
            <h3 className={sectionTitle}>Before vs after</h3>
            <div className="overflow-x-auto rounded-xl border border-border bg-background">
              <table className="w-full min-w-[320px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-right">
                    <th className={`${thClass} text-left`} scope="col">
                      <span className="sr-only">Metric</span>
                    </th>
                    <th className={thClass} scope="col">
                      Before
                    </th>
                    <th className={thClass} scope="col">
                      After
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <CompareRow
                    label="Quantity"
                    before={`${before.qty} (${before.lots} lot${before.lots === 1 ? "" : "s"})`}
                    after={`${after.qty} (${after.lots} lot${after.lots === 1 ? "" : "s"})`}
                  />
                  <CompareRow
                    label="Avg price"
                    before={num(before.avgPrice)}
                    after={num(after.avgPrice)}
                    note={result.avgImprovementPct === null ? undefined : `${signedPct(-result.avgImprovementPct, 2)}`}
                    noteTone={result.avgImprovementPct === null ? undefined : toneOf(result.avgImprovementPct)}
                  />
                  <CompareRow
                    label="Capital at risk"
                    hint="Total premium paid"
                    before={formatINR(before.capitalAtRisk)}
                    after={formatINR(after.capitalAtRisk)}
                  />
                  <CompareRow label="Extra cost" hint="New money" before="—" after={formatINR(result.extraCost)} />
                  <CompareRow
                    label="Max loss"
                    hint="Worst P&L at expiry"
                    before={before.maxLoss === null ? "Unlimited" : formatINR(before.maxLoss)}
                    after={after.maxLoss === null ? "Unlimited" : formatINR(after.maxLoss)}
                  />
                  <CompareRow label="Breakeven premium" before={num(before.breakevenPremium)} after={num(after.breakevenPremium)} />
                  <CompareRow
                    label="Breakeven at expiry"
                    hint={`${indexName} level`}
                    before={before.breakevenLevel === null ? "—" : formatLevel(before.breakevenLevel)}
                    after={after.breakevenLevel === null ? "—" : formatLevel(after.breakevenLevel)}
                    note={levelNote(before, after, position.type)?.text}
                    noteTone={levelNote(before, after, position.type)?.tone}
                  />
                  <CompareRow
                    label="POP"
                    hint="Chance of profit at expiry"
                    before={pct(before.pop)}
                    after={pct(after.pop)}
                  />
                  <CompareRow
                    label="Net theta / day"
                    before={formatINR(before.theta)}
                    after={formatINR(after.theta)}
                    afterClass="text-danger-fg"
                    beforeClass="text-danger-fg"
                  />
                  <CompareRow label="Net delta" before={num(before.delta, 1)} after={num(after.delta, 1)} />
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Black-Scholes at the strike&apos;s IV, before brokerage — the same model and legs as the Analysis tab.
              {greeksNote && <span className="text-warning"> Greeks: {greeksNote}.</span>}
            </p>
          </section>

          {/* --- Breakeven move --------------------------------------------- */}
          <section className="flex flex-col gap-2" aria-label="Breakeven move">
            <h3 className={sectionTitle}>Breakeven move</h3>
            <div className="overflow-x-auto rounded-xl border border-border bg-background">
              <table className="w-full min-w-[360px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-right">
                    <th className={`${thClass} text-left`} scope="col">
                      <span className="sr-only">Measure</span>
                    </th>
                    {result.scenarios.after.map((s) => (
                      <th key={s.key} className={thClass} scope="col">
                        {s.label}
                        {s.key !== "today" && (
                          <span className="block text-[10px] font-medium normal-case tracking-normal text-muted-foreground">
                            theta-adjusted
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <th scope="row" className="px-2 py-2 text-left text-sm font-normal text-muted-foreground">
                      Premium rise needed
                    </th>
                    {result.scenarios.after.map((s, i) => (
                      <td key={s.key} className="px-2 py-2 text-right font-mono tabular-nums">
                        {riseText(s)}
                        <span className="block text-xs text-muted-foreground">was {riseText(result.scenarios.before[i], true)}</span>
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-border">
                    <th scope="row" className="px-2 py-2 text-left text-sm font-normal text-muted-foreground">
                      of which theta
                    </th>
                    {result.scenarios.after.map((s) => (
                      <td key={s.key} className="px-2 py-2 text-right font-mono tabular-nums text-muted-foreground">
                        {s.key === "today" ? "—" : `₹${num(s.thetaDrag)}`}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-border">
                    <th scope="row" className="px-2 py-2 text-left text-sm font-medium">
                      {indexName} move needed
                    </th>
                    {result.scenarios.after.map((s, i) => (
                      <td key={s.key} className="px-2 py-2 text-right font-mono tabular-nums">
                        <span className={`text-base font-semibold ${s.inProfit ? "text-profit" : ""}`}>
                          {s.move === null ? "—" : signedPts(s.move)}
                        </span>
                        {s.inProfit && <span className="block text-[10px] text-profit">in profit — cushion</span>}
                        {s.level !== null && (
                          <span className="block text-xs text-muted-foreground">→ {formatLevel(s.level)}</span>
                        )}
                        <span className="block text-xs text-muted-foreground">
                          was {result.scenarios.before[i].move === null ? "—" : signedPts(result.scenarios.before[i].move as number)}
                        </span>
                      </td>
                    ))}
                  </tr>
                  <tr>
                    <th scope="row" className="px-2 py-2 text-left text-xs font-normal text-muted-foreground">
                      Delta-gamma estimate
                    </th>
                    {result.scenarios.after.map((s) => (
                      <td key={s.key} className="px-2 py-2 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {s.deltaGammaMove === null ? "—" : signedPts(s.deltaGammaMove)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              The move is solved on the Analysis payoff itself, so it includes theta by then. Premium rise is the gain
              the option needs over today&apos;s LTP, plus the decay it will have lost. The estimate is a second-order
              cross-check from today&apos;s delta and gamma.
            </p>
          </section>
        </div>

        <div className="flex flex-col gap-5">
          {/* --- Lots table -------------------------------------------------- */}
          <section className="flex flex-col gap-2" aria-label="Lots table">
            <h3 className={sectionTitle}>Lots to add</h3>
            {lotsTable.rows.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                {prefs.funds === null
                  ? "Enter your available funds to see what you can afford."
                  : result.buyPrice === null
                    ? "Enter a buy price to see the lots."
                    : "Your funds don't cover a single lot at this price."}
              </p>
            ) : (
              <div className="max-h-72 overflow-auto rounded-xl border border-border bg-background">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-background">
                    <tr className="border-b border-border text-right">
                      <th className={thClass} scope="col">Lots</th>
                      <th className={thClass} scope="col">Extra cost</th>
                      <th className={thClass} scope="col">New avg</th>
                      <th className={thClass} scope="col">Premium rise</th>
                      <th className={thClass} scope="col">Move today</th>
                      <th className={thClass} scope="col">Loss if ₹0</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lotsTable.rows.map((row) => {
                      const selected = row.lots === result.extraLots;
                      const marginal = row.lots === lotsTable.marginalLots;
                      return (
                        <tr
                          key={row.lots}
                          onClick={() => setExtraLots(row.lots)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              setExtraLots(row.lots);
                            }
                          }}
                          tabIndex={0}
                          aria-current={selected ? "true" : undefined}
                          className={`cursor-pointer border-b border-border text-right last:border-0 hover:bg-muted/40 ${
                            selected ? "bg-accent/10" : marginal ? "bg-warning/10" : ""
                          }`}
                        >
                          <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">
                            <span className="inline-flex items-center justify-end gap-1.5">
                              {marginal && (
                                <span
                                  title={`From here, each lot lowers your average by under 0.5% — row ${row.lots} is the first`}
                                  className="rounded bg-warning/20 px-1 text-[10px] font-semibold uppercase text-warning"
                                >
                                  marginal
                                </span>
                              )}
                              {row.lots}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">{formatINR(row.extraCost)}</td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">
                            {num(row.newAvg)}
                            <span
                              className={`ml-1 text-xs ${
                                row.improvementPct > 0 ? "text-profit" : row.improvementPct < 0 ? "text-danger-fg" : "text-muted-foreground"
                              }`}
                            >
                              {signedPct(-row.improvementPct, 2)}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">
                            {signedINR(row.premiumRise)}
                            {row.premiumRisePct !== null && (
                              <span className="ml-1 text-xs text-muted-foreground">{signedPct(row.premiumRisePct, 0)}</span>
                            )}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums">
                            {row.moveToday === null ? "—" : signedPts(row.moveToday)}
                          </td>
                          <td className="whitespace-nowrap px-2 py-2 font-mono tabular-nums text-danger-fg">
                            {formatINR(row.lossIfZero)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {lotsTable.rows.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Move today is the index points to break even right now; negative means the position would already
                be in profit. Click a row to simulate that many lots.
              </p>
            )}
            {lotsTable.marginalLots !== null && (
              <p className="text-xs text-muted-foreground">
                {lotsTable.marginalLots === 1
                  ? "Even the first lot lowers your average by under 0.5% at this price."
                  : `Past ${lotsTable.marginalLots - 1} lot${lotsTable.marginalLots === 2 ? "" : "s"}, each extra lot lowers your average by under 0.5%.`}
              </p>
            )}
            {prefs.funds !== null && result.maxAffordableLots > MAX_TABLE_LOTS && (
              <p className="text-xs text-muted-foreground">Showing the first {MAX_TABLE_LOTS} lots.</p>
            )}
          </section>

          {/* --- P&L ladder -------------------------------------------------- */}
          <section className="flex flex-col gap-2" aria-label="P&L ladder">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className={sectionTitle}>P&amp;L ladder</h3>
              <div role="tablist" aria-label="Ladder date" className="flex gap-1 rounded-lg border border-border p-0.5">
                {result.scenarios.after.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === s.key}
                    onClick={() => setLadderTab(s.key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                      activeTab === s.key ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-border bg-background">
              <table className="w-full min-w-[360px] border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border text-right">
                    <th className={thClass} scope="col">Move</th>
                    <th className={thClass} scope="col">Level</th>
                    <th className={thClass} scope="col">Before</th>
                    <th className={thClass} scope="col">After</th>
                  </tr>
                </thead>
                <tbody>
                  {ladder.map((row) => {
                    const b = row.before[activeTab];
                    const a = row.after[activeTab];
                    return (
                      <tr
                        key={row.offset}
                        className={`border-b border-border text-right last:border-0 ${row.offset === 0 ? "bg-muted/40 font-semibold" : ""}`}
                      >
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums text-muted-foreground">
                          {row.offset === 0 ? "Spot" : signedPts(row.offset)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-mono tabular-nums text-muted-foreground">
                          {formatLevel(row.level)}
                        </td>
                        <PnlCell value={b} />
                        <PnlCell value={a} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
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

// --- Pieces -----------------------------------------------------------------------

function toneOf(improvementPct: number): "profit" | "loss" | undefined {
  return improvementPct > 0 ? "profit" : improvementPct < 0 ? "loss" : undefined;
}

/** How the expiry break-even level moved: a lower one helps a call, a higher one helps a put. */
function levelNote(
  before: PositionSnapshot,
  after: PositionSnapshot,
  type: "CE" | "PE",
): { text: string; tone: "profit" | "loss" } | undefined {
  if (before.breakevenLevel === null || after.breakevenLevel === null) return undefined;
  const delta = after.breakevenLevel - before.breakevenLevel;
  if (Math.abs(delta) < 0.005) return undefined;
  const favourable = type === "CE" ? delta < 0 : delta > 0;
  return { text: signedPts(delta), tone: favourable ? "profit" : "loss" };
}

function riseText(s: ScenarioResult, short = false): string {
  const rupees = `${s.premiumRise > 0 ? "+" : ""}₹${num(s.premiumRise)}`;
  if (short || s.premiumRisePct === null) return rupees;
  return `${rupees} (${signedPct(s.premiumRisePct, 0)})`;
}

function CompareRow({
  label,
  hint,
  before,
  after,
  note,
  noteTone,
  beforeClass = "",
  afterClass = "",
}: {
  label: string;
  hint?: string;
  before: ReactNode;
  after: ReactNode;
  note?: string;
  noteTone?: "profit" | "loss";
  beforeClass?: string;
  afterClass?: string;
}) {
  return (
    <tr className="border-b border-border last:border-0">
      <th scope="row" className="px-2 py-2 text-left text-sm font-normal text-muted-foreground" title={hint}>
        {label}
        {hint && <span className="block text-[10px] leading-tight">{hint}</span>}
      </th>
      <td className={`whitespace-nowrap px-2 py-2 text-right font-mono tabular-nums text-muted-foreground ${beforeClass}`}>
        {before}
      </td>
      <td className={`whitespace-nowrap px-2 py-2 text-right font-mono font-semibold tabular-nums ${afterClass}`}>
        {after}
        {note && (
          <span
            className={`block text-xs font-normal ${
              noteTone === "profit" ? "text-profit" : noteTone === "loss" ? "text-danger-fg" : "text-muted-foreground"
            }`}
          >
            {note}
          </span>
        )}
      </td>
    </tr>
  );
}

function PnlCell({ value }: { value: number | null }) {
  if (value === null) return <td className="px-2 py-1.5 text-right text-muted-foreground">—</td>;
  const tint = value > 0 ? "bg-profit/10" : value < 0 ? "bg-loss/10" : "";
  return (
    <td className={`whitespace-nowrap px-2 py-1.5 text-right font-mono tabular-nums ${tint} ${pnlColorClass(value)}`}>
      {formatINR(value)}
    </td>
  );
}
