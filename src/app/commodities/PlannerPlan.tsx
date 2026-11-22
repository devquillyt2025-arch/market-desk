"use client";

/**
 * The signal for the chosen timeframe and the plan for it: where the stop and target sit and what the trade risks and earns per lot
 * AFTER costs. The plan is worked out here, on the page, from the ATR and the price - so it moves as the controls do - by the same
 * pure code the replay uses. It is a plan, not an instruction: nothing here places an order, and a fixed note says what the evidence is.
 */

import type { ReactNode } from "react";

import { ATR_MULT_RANGE, RATIOS, SESSION } from "@/lib/natgasPlanner/config";
import { costShareTone, type Plan } from "@/lib/natgasPlanner/plan";
import type { EntryWindow, TfOverview } from "@/lib/natgasPlanner/signals";
import type { Side } from "@/lib/natgasPlanner/types";

import { MoveArrow } from "./direction";
import { inr, istClock, pct, price, span, tfWords } from "./plannerFormat";
import type { PlannerPrefs, PlannerSide, StopMode } from "./usePlannerPrefs";

const FIELD = "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-base tabular-nums text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30 sm:text-sm";
const LABEL = "mb-1 block text-xs font-medium text-muted-foreground";
const SEGMENT = (on: boolean) => `min-h-10 rounded-lg px-3 text-sm font-medium transition-colors pointer-coarse:min-h-11 ${on ? "bg-muted text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`;

// --- the signal -------------------------------------------------------------------------

const WINDOW_TEXT = (w: EntryWindow): string => {
  switch (w.state) {
    case "open":
      return `Entry window open${w.msToFlatBy !== null ? ` · ${span(w.msToFlatBy)} to flat-by ${istClock(w.flatByMs!)}` : ""}`;
    case "after-last-entry":
      return `No new entries after ${String(Math.floor(SESSION.lastEntry / 60))}:${String(SESSION.lastEntry % 60).padStart(2, "0")}${w.msToFlatBy !== null ? ` · ${span(w.msToFlatBy)} to flat-by` : ""}`;
    case "before-open":
      return "Before the 09:00 open";
    case "after-flat-by":
      return "Past flat-by (23:20)";
    default:
      return "MCX is shut - outside the entry window";
  }
};

export function SignalCard({ overview, window: entryWindow, side, onSide, flipEnd }: { overview: TfOverview; window: EntryWindow; side: PlannerSide; onSide: (s: PlannerSide) => void; flipEnd: number | null }) {
  const fresh = overview.direction !== null;
  const colour = overview.green === null ? null : overview.green ? "green" : "red";
  return (
    <section aria-label="Signal" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Signal · {tfWords(overview.tf)}</p>
      <p className="mt-1.5 flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
        {fresh ? (
          <>
            <MoveArrow direction={overview.direction === "long" ? "up" : "down"} className="size-4" />
            {overview.direction === "long" ? "Long signal" : "Short signal"}
          </>
        ) : (
          "No fresh signal"
        )}
      </p>
      <p className="mt-1.5 text-sm text-muted-foreground">
        {colour === null
          ? "This timeframe has no completed bar yet."
          : fresh
            ? `Heikin Ashi turned ${colour} on the bar that closed at ${flipEnd ? istClock(flipEnd) : "–"}.`
            : `The latest completed bar is ${colour}${overview.barsSinceFlip !== null ? `, ${overview.barsSinceFlip} ${overview.barsSinceFlip === 1 ? "bar" : "bars"} since the last flip` : ""}. A signal needs a colour change on the latest completed bar.`}
      </p>
      <p className="mt-3 rounded-lg bg-muted/60 px-3 py-2 text-xs text-muted-foreground">{WINDOW_TEXT(entryWindow)}</p>

      <div role="group" aria-label="Plan for which side" className="mt-4 inline-flex rounded-xl border border-border bg-background p-0.5">
        {(["auto", "long", "short"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={side === s} onClick={() => onSide(s)} className={SEGMENT(side === s)}>
            {s === "auto" ? "Follow signal" : s === "long" ? "Long" : "Short"}
          </button>
        ))}
      </div>
    </section>
  );
}

// --- the plan ---------------------------------------------------------------------------

const TONE_TEXT = { good: "bg-profit/10 text-profit ring-profit/25", warn: "bg-warning/10 text-warning-strong ring-warning/30", bad: "bg-danger-fg/10 text-danger-fg ring-danger-fg/25" } as const;
const TONE_WORD = { good: "Under 20%", warn: "20 to 25%", bad: "Over 25%" } as const;

function NumberField({ id, label, value, prefix, suffix, onCommit, max }: { id: string; label: string; value: number; prefix?: string; suffix?: string; onCommit: (v: number) => void; max?: number }) {
  return (
    <div>
      <label htmlFor={id} className={LABEL}>
        {label}
      </label>
      <div className="relative">
        {prefix && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted-foreground">
            {prefix}
          </span>
        )}
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          defaultValue={value ? String(value) : ""}
          placeholder="0"
          onChange={(e) => {
            const text = e.target.value.trim().replace(",", ".");
            const v = text === "" ? 0 : Number(text);
            if (Number.isFinite(v) && v >= 0 && (max === undefined || v <= max)) onCommit(v);
          }}
          className={`${FIELD} ${prefix ? "pl-7" : ""} ${suffix ? "pr-9" : ""}`}
        />
        {suffix && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export function PlanControls({ prefs, onChange }: { prefs: PlannerPrefs; onChange: (patch: Partial<PlannerPrefs>) => void }) {
  const mults: number[] = [];
  for (let m = ATR_MULT_RANGE.min; m <= ATR_MULT_RANGE.max + 1e-9; m += ATR_MULT_RANGE.step) mults.push(m);
  return (
    <div className="space-y-4">
      <div>
        <span className={LABEL} id="ratio-label">
          Target for each ₹1 risked
        </span>
        <div role="group" aria-labelledby="ratio-label" className="inline-flex flex-wrap gap-1 rounded-xl border border-border bg-background p-0.5">
          {RATIOS.map((r) => (
            <button key={r} type="button" aria-pressed={prefs.ratio === r} onClick={() => onChange({ ratio: r })} className={`${SEGMENT(prefs.ratio === r)} tabular-nums`}>
              1:{r}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="stop-mode" className={LABEL}>
            Stop sized by
          </label>
          <select id="stop-mode" value={prefs.stopMode} onChange={(e) => onChange({ stopMode: e.target.value as StopMode })} className={FIELD}>
            <option value="atr">ATR (14)</option>
            <option value="pct">% of price</option>
            <option value="abs">₹ a mmBtu</option>
          </select>
        </div>
        {prefs.stopMode === "atr" ? (
          <div>
            <label htmlFor="atr-mult" className={LABEL}>
              ATR multiple
            </label>
            <select id="atr-mult" value={prefs.atrMult} onChange={(e) => onChange({ atrMult: Number(e.target.value) })} className={FIELD}>
              {mults.map((m) => (
                <option key={m} value={m}>
                  {m}× ATR
                </option>
              ))}
            </select>
          </div>
        ) : (
          <NumberField key={prefs.stopMode} id="stop-value" label={prefs.stopMode === "pct" ? "Stop distance" : "Stop distance"} value={prefs.stopValue} suffix={prefs.stopMode === "pct" ? "%" : undefined} prefix={prefs.stopMode === "abs" ? "₹" : undefined} onCommit={(v) => onChange({ stopValue: v })} max={prefs.stopMode === "pct" ? 20 : 100} />
        )}
        <NumberField id="risk-budget" label="Risk budget" prefix="₹" value={prefs.riskBudget} onCommit={(v) => onChange({ riskBudget: v })} />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-t border-border/60 py-2 text-sm first:border-t-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

export function PlanBlock({ side, plan, atrMult, entryLabel, greyed, note }: { side: Side; plan: Plan | null; atrMult: number; entryLabel: string; greyed: boolean; note: string | null }) {
  const long = side === "long";
  return (
    <div className={`rounded-xl border border-border/80 p-3.5 sm:p-4 ${greyed ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <MoveArrow direction={long ? "up" : "down"} />
          Plan · {long ? "Long" : "Short"}
        </h3>
        {note && <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground">{note}</span>}
      </div>

      {plan === null ? (
        <p className="mt-3 text-sm text-muted-foreground">There aren&apos;t enough bars for an ATR yet. Size the stop by hand (% or ₹) to plan.</p>
      ) : (
        <>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[19rem] text-sm">
              <caption className="sr-only">Entry, stop and target for the {long ? "long" : "short"} plan</caption>
              <thead>
                <tr className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="pb-1.5 pr-3 text-left" />
                  <th scope="col" className="pb-1.5 pr-3 text-right">
                    Price
                  </th>
                  <th scope="col" className="pb-1.5 pr-3 text-right">
                    From entry
                  </th>
                  <th scope="col" className="pb-1.5 pr-3 text-right">
                    ₹ / mmBtu
                  </th>
                  <th scope="col" className="pb-1.5 text-right">
                    ₹ / lot
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 tabular-nums">
                <tr>
                  <th scope="row" className="py-2 pr-3 text-left text-xs font-normal text-muted-foreground">
                    Entry <span className="block text-[11px]">{entryLabel}</span>
                  </th>
                  <td className="py-2 pr-3 text-right font-medium">{price(plan.entry)}</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">–</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground">–</td>
                  <td className="py-2 text-right text-muted-foreground">–</td>
                </tr>
                <tr>
                  <th scope="row" className="py-2 pr-3 text-left text-xs font-normal text-muted-foreground">
                    Stop
                  </th>
                  <td className="py-2 pr-3 text-right font-semibold">{price(plan.stop)}</td>
                  <td className="py-2 pr-3 text-right">{long ? "-" : "+"}{pct(plan.riskPct)}</td>
                  <td className="py-2 pr-3 text-right">{plan.stopDist.toFixed(2)}</td>
                  <td className="py-2 text-right">{inr(plan.grossRisk)}</td>
                </tr>
                <tr>
                  <th scope="row" className="py-2 pr-3 text-left text-xs font-normal text-muted-foreground">
                    Target
                  </th>
                  <td className="py-2 pr-3 text-right font-semibold">{price(plan.target)}</td>
                  <td className="py-2 pr-3 text-right">{long ? "+" : "-"}{pct(plan.rewardPct)}</td>
                  <td className="py-2 pr-3 text-right">{plan.targetDist.toFixed(2)}</td>
                  <td className="py-2 text-right">{inr(plan.grossReward)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <dl className="mt-3">
            <Row label="Loss at the stop, after costs">
              <span className="font-semibold">{inr(plan.netRisk)}</span> <span className="text-xs text-muted-foreground">(costs {inr(plan.feesAtStop)} + a tick of slippage)</span>
            </Row>
            <Row label="Gain at the target, after costs">
              <span className="font-semibold">{inr(plan.netReward)}</span> <span className="text-xs text-muted-foreground">(costs {inr(plan.feesAtTarget)})</span>
            </Row>
            <Row label="Win rate needed to break even">
              <span className="font-semibold">{pct(plan.breakEven * 100, 1)}</span> <span className="text-xs text-muted-foreground">with costs · {pct(plan.breakEvenNoCost * 100, 1)} without</span>
            </Row>
            <Row label="Costs as a share of the risk">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${TONE_TEXT[costShareTone(plan.costShare)]}`}>
                {pct(plan.costShare * 100, 1)} · {TONE_WORD[costShareTone(plan.costShare)]}
              </span>
            </Row>
            <Row label="Lots for your risk budget">{plan.lots > 0 ? <span className="font-semibold">{plan.lots} {plan.lots === 1 ? "lot" : "lots"}</span> : <span className="text-xs text-muted-foreground">{plan.lotsNote}</span>}</Row>
            <Row label="Value of one lot">{inr(plan.notional)}</Row>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            Stop: {plan.stopSource === "atr" ? `${atrMult}× ATR, rounded up to the tick` : plan.stopSource === "cost-floor" ? `the cost floor (${plan.stopDist.toFixed(2)}) - wider than ${atrMult}× ATR, so costs stay near a fifth of the risk` : "the distance you set"}. Target ratio as the ticks allow: 1:{plan.effectiveRatio.toFixed(2)}.
          </p>
        </>
      )}
    </div>
  );
}

export function EvidenceNote() {
  return <p className="mt-4 rounded-lg bg-muted/60 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">No timeframe or ratio has shown a proven edge. Costs are about ₹330 a lot per round trip. This is a plan to size a trade, not a call to take it.</p>;
}
