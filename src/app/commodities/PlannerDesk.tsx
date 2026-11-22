"use client";

/**
 * The Trade plan tab: from live MCX natural gas futures data, what each timeframe's Heikin Ashi bars say, and for the one chosen the
 * plan that goes with it - entry reference, stop, target, ratio, and what it risks and earns per lot after costs - with the
 * evidence for the rule alongside.
 *
 * It states a signal and a plan, never an instruction, and has no way to place an order. No timeframe or ratio has shown an edge
 * (see the Evidence section); the words "best", "buy" and "sell" do not appear. Loaded on demand, like the natural gas desk.
 */

import Link from "next/link";
import { useMemo, type ReactNode } from "react";

import { THIN_TRADING_PCT } from "@/lib/natgasPlanner/config";
import { makePlan } from "@/lib/natgasPlanner/plan";
import { entryWindow } from "@/lib/natgasPlanner/signals";
import type { Side } from "@/lib/natgasPlanner/types";

import NatgasSkeleton from "./NatgasSkeleton";
import PlannerChart, { type ChartLine } from "./PlannerChart";
import PlannerEvidence from "./PlannerEvidence";
import { OverviewTable, TimeframeSwitcher } from "./PlannerOverview";
import { EvidenceNote, PlanBlock, PlanControls, SignalCard } from "./PlannerPlan";
import { istClock, istStampLong, pct, price } from "./plannerFormat";
import { useNatgasPlanner } from "./useNatgasPlanner";
import { usePlannerPrefs } from "./usePlannerPrefs";

function Chip({ tone, children }: { tone: "live" | "shut" | "warn"; children: ReactNode }) {
  const dot = tone === "live" ? "bg-profit" : tone === "warn" ? "bg-warning" : "bg-muted-foreground";
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${tone === "warn" ? "border-warning/40 bg-warning/10 text-warning-strong" : "border-border bg-card"}`}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

export default function PlannerDesk({ nowMs }: { nowMs: number }) {
  const [prefs, update] = usePlannerPrefs();
  const { data, tokenExpired, failing, chartPending } = useNatgasPlanner(prefs.tf);

  const overview = data?.timeframes.find((t) => t.tf === prefs.tf) ?? null;
  const refPrice = data ? (data.ltp?.price ?? data.lastClose) : null;
  const window = useMemo(() => entryWindow(nowMs, data?.market.open ?? false), [nowMs, data?.market.open]);

  const sides: Side[] = prefs.side === "auto" ? (overview?.direction ? [overview.direction] : ["long", "short"]) : [prefs.side];
  const noSignal = prefs.side === "auto" && overview !== null && overview.direction === null;
  const plans = useMemo(
    () =>
      overview && refPrice
        ? sides.map((side) => ({
            side,
            plan: makePlan({
              side,
              entry: refPrice,
              atr: overview.atr,
              atrMult: prefs.atrMult,
              ratio: prefs.ratio,
              stopPct: prefs.stopMode === "pct" ? prefs.stopValue : null,
              stopAbs: prefs.stopMode === "abs" ? prefs.stopValue : null,
              riskBudget: prefs.riskBudget,
            }),
          }))
        : [],
    // `sides` follows the signal and the side choice, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [overview, refPrice, prefs.side, prefs.atrMult, prefs.ratio, prefs.stopMode, prefs.stopValue, prefs.riskBudget],
  );

  if (nowMs === 0) return <NatgasSkeleton />;
  if (tokenExpired) {
    return (
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Upstox needs a fresh token</h2>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          The candles come from Upstox, and its token has lapsed. Paste a new one in{" "}
          <Link href="/settings" className="font-medium text-accent underline-offset-2 hover:underline">
            Settings
          </Link>{" "}
          and this tab fills in by itself.
        </p>
      </section>
    );
  }
  if (!data || !overview) {
    return failing ? (
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Couldn&apos;t load the planner</h2>
        <p className="mt-2 text-sm text-muted-foreground">Upstox didn&apos;t answer. It will try again in a moment.</p>
      </section>
    ) : (
      <NatgasSkeleton />
    );
  }

  const live = data.mode === "live" && data.market.open;
  const change = refPrice !== null && data.prevClose !== null ? refPrice - data.prevClose : null;
  const thin = data.thinPct !== null && data.thinPct > THIN_TRADING_PCT;
  const entryLabel = live && data.ltp ? "last traded price" : "last close";
  const one = plans.length === 1 ? plans[0] : null;
  const lines: ChartLine[] = one?.plan
    ? [
        { label: "Target", price: one.plan.target, tone: "target" },
        { label: "Entry", price: one.plan.entry, tone: "entry" },
        { label: "Stop", price: one.plan.stop, tone: "stop" },
      ]
    : [];
  const greyed = window.state !== "open" || noSignal;
  const note = noSignal ? "No signal - shown for planning" : window.state !== "open" ? "Outside the entry window" : prefs.side !== "auto" && overview.direction !== prefs.side ? "Side chosen by you" : null;

  return (
    <div className="space-y-3">
      <h2 className="sr-only">Natural gas signal and plan</h2>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={live ? "live" : "shut"}>
            <span className="font-semibold">{data.contract.label}</span>
          </Chip>
          <Chip tone={data.market.open ? "live" : "shut"}>
            <span className="font-semibold">MCX</span>
            <span className="text-muted-foreground">{data.market.open ? `trading until ${data.market.closes}` : "shut"}</span>
          </Chip>
          <Chip tone={live ? "live" : "shut"}>
            <span className="font-semibold">{live ? "Live" : "Last session"}</span>
            <span className="text-muted-foreground">{data.lastCandleAt ? (live ? `last candle ${istClock(data.lastCandleAt)}` : istStampLong(data.lastCandleAt)) : "no candles"}</span>
          </Chip>
          {thin && (
            <Chip tone="warn">
              <span className="font-semibold">Thin trading</span>
              <span>{Math.round(data.thinPct ?? 0)}% of the last hour had no trades</span>
            </Chip>
          )}
          {failing && (
            <Chip tone="warn">
              <span>Couldn&apos;t refresh - showing the last answer</span>
            </Chip>
          )}
        </div>
        <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
          <span className="text-2xl font-semibold tabular-nums tracking-tight">{refPrice !== null ? price(refPrice) : "–"}</span>
          {change !== null && refPrice !== null && (
            <span className="text-sm tabular-nums text-muted-foreground">
              {change >= 0 ? "+" : "-"}
              {price(Math.abs(change))} ({change >= 0 ? "+" : ""}
              {pct((change / data.prevClose!) * 100)}) <span className="text-xs">on the previous session</span>
            </span>
          )}
          <span className="text-xs text-muted-foreground">Active contract: {data.contract.reason}.</span>
        </p>
      </div>

      <section aria-label="Timeframes" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
        <TimeframeSwitcher timeframes={data.timeframes} selected={prefs.tf} onSelect={(tf) => update({ tf })} />
        <div className="mt-4">
          <OverviewTable timeframes={data.timeframes} selected={prefs.tf} onSelect={(tf) => update({ tf })} entry={refPrice} />
        </div>
      </section>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <SignalCard overview={overview} window={window} side={prefs.side} onSide={(side) => update({ side })} flipEnd={overview.fresh ? overview.lastBarEnd : null} />
        <section aria-label="Plan" className="rounded-2xl border border-border bg-card p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Plan</h2>
          <div className="mt-3">
            <PlanControls prefs={prefs} onChange={update} />
          </div>
          <div className={`mt-4 grid gap-3 ${plans.length > 1 ? "2xl:grid-cols-2" : ""}`}>
            {plans.map(({ side, plan }) => (
              <PlanBlock key={side} side={side} plan={plan} atrMult={prefs.atrMult} entryLabel={entryLabel} greyed={greyed} note={note} />
            ))}
          </div>
          <EvidenceNote />
        </section>
      </div>

      <PlannerChart bars={data.selected.chart} tf={data.selected.tf} lines={data.selected.tf === prefs.tf ? lines : []} pending={chartPending} />
      <PlannerEvidence replay={data.replay} tf={prefs.tf} ratio={prefs.ratio} />
    </div>
  );
}
