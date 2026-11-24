"use client";

/**
 * The Trade plan tab: from live MCX natural gas futures data, what each timeframe's Heikin Ashi bars say - the signal when the latest
 * bar has just flipped.
 *
 * The contract can be chosen (any future still listed, or the one with the most business); left alone it is the nearest that isn't
 * about to expire. It states a signal and levels, never an instruction, and has no way to place an order. No timeframe or ratio has shown
 * an edge, and the note under the cards says so; the words "best", "buy" and "sell" do not appear. Loaded on demand, like the natural gas desk.
 */

import Link from "next/link";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import { shownContract } from "@/lib/natgasContract";
import { THIN_TRADING_PCT, type Timeframe } from "@/lib/natgasPlanner/config";

import ContractSelect from "./ContractSelect";
import NatgasSkeleton from "./NatgasSkeleton";
import { TimeframeStrip } from "./PlannerOverview";
import SupportResistance from "./SupportResistance";
import { istClock, istStampLong, pct, price } from "./plannerFormat";
import { useNatgasPlanner } from "./useNatgasPlanner";
import { usePlannerPrefs } from "./usePlannerPrefs";

function Chip({ tone, children }: { tone: "live" | "shut" | "warn"; children: ReactNode }) {
  const dot = tone === "live" ? "bg-profit" : tone === "warn" ? "bg-warning" : "bg-muted-foreground";
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs ${tone === "warn" ? "border-warning/40 bg-warning/10 text-warning-strong" : "border-border bg-card"}`}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

/** `slot` is the place beside the tabs the contract, status and price are drawn into (null until the toolbar has it). */
/**
 * The server's answer carries every timeframe's reading at once, so choosing a timeframe here changes nothing it is asked: it always asks for
 * the same one (which only decides which chart it also sends, and the page draws no chart). A choice is then instant, with no round trip.
 */
const SERVER_TF: Timeframe = 5;

export default function PlannerDesk({ nowMs, slot }: { nowMs: number; slot: HTMLElement | null }) {
  const [prefs, update] = usePlannerPrefs();
  const { data, tokenExpired, failing, contractPending } = useNatgasPlanner(SERVER_TF, prefs.contract);

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
  if (!data) {
    return failing ? (
      <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Couldn&apos;t load the planner</h2>
        <p className="mt-2 text-sm text-muted-foreground">Upstox didn&apos;t answer. It will try again in a moment.</p>
      </section>
    ) : (
      <NatgasSkeleton />
    );
  }

  // What the dropdown shows: the choice made, or - while it is the default - the contract the default turned out to be.
  const contractValue = shownContract(prefs.contract, data.contracts, data.contract.key);
  const refPrice = data.ltp?.price ?? data.lastClose;
  const live = data.mode === "live" && data.market.open;
  const change = refPrice !== null && data.prevClose !== null ? refPrice - data.prevClose : null;
  const thin = data.thinPct !== null && data.thinPct > THIN_TRADING_PCT;

  // Drawn beside the tabs, not here: the contract, the two status chips and the price, on the tabs' own row when there is room.
  const header = (
    <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ContractSelect id="plan-contract" hideLabel contracts={data.contracts} value={contractValue} onChange={(contract) => update({ contract })} hint={`${data.contract.label}: ${data.contract.reason}. The Natural gas tab follows the same choice.`} />
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
      <p className="flex items-baseline gap-x-3 whitespace-nowrap">
        <span className="text-2xl font-semibold tabular-nums tracking-tight">{refPrice !== null ? price(refPrice) : "–"}</span>
        {change !== null && refPrice !== null && (
          <span className="text-sm tabular-nums text-muted-foreground" title="Change on the previous session">
            {change >= 0 ? "+" : "-"}
            {price(Math.abs(change))} ({change >= 0 ? "+" : ""}
            {pct((change / data.prevClose!) * 100)})<span className="sr-only"> on the previous session</span>
          </span>
        )}
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      <h2 className="sr-only">Natural gas signals</h2>

      {slot && createPortal(header, slot)}

      <div className={`space-y-3 transition-opacity ${contractPending ? "pointer-events-none opacity-50" : ""}`} aria-busy={contractPending}>
        <section aria-label="Timeframes" className="rounded-2xl border border-border bg-card p-3.5 sm:p-4">
          <TimeframeStrip title="Heikin Ashi" legend="Latest completed bar: its colour, bars since it last flipped, and ATR" timeframes={data.timeframes} selected={prefs.tf} onSelect={(tf) => update({ tf })} entry={refPrice} updatedAt={data.asOf} />
          {/* The same timeframes read from plain candles. (Absent from an older server's answer, so the strip waits for it.) */}
          {data.candleTimeframes && (
            <TimeframeStrip
              title="Candles"
              legend="Latest completed candle: open, high, low, close. Green when it closes above its open"
              timeframes={data.candleTimeframes}
              selected={prefs.tf}
              onSelect={(tf) => update({ tf })}
              entry={refPrice}
              updatedAt={data.asOf}
              candle
              className="mt-4 border-t border-border/60 pt-4"
            />
          )}
          <p className="mt-3 text-[13px] text-muted-foreground">No timeframe or ratio has shown a proven edge. Costs are about ₹330 a lot per round trip.</p>
        </section>

        {/* For the timeframe chosen here or on a card above (the ringed one). */}
        <SupportResistance tf={prefs.tf} onSelect={(tf) => update({ tf })} overview={data.timeframes.find((t) => t.tf === prefs.tf) ?? null} price={refPrice} />
      </div>
    </div>
  );
}
