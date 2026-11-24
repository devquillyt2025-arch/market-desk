"use client";

/** What has happened: the last 30 days, how well the trading went, the latest closed trades, and the account behind them. Figures only. */

import Link from "next/link";

import type { ReportSummary } from "@/lib/calculateReports";
import { dayLabel, type DayBar, type FundsBrief, type PaperBrief, type TradeLine } from "@/lib/dashboardBrief";
import { formatINR, formatPct, pnlColorClass } from "@/lib/format";

import { Card, DayBars, Money, NA, Ring, Skeleton, Stat } from "./parts";

// --- 30 days ----------------------------------------------------------------------------

export function ThirtyDaysCard({ summary, chargesIn, bars, loading, index }: { summary: ReportSummary | null; chargesIn: boolean; bars: readonly DayBar[] | null; loading: boolean; index: number }) {
  const headline = summary === null ? null : chargesIn ? summary.netPnl : summary.totalPnl;
  return (
    <Card title="30 days" href="/reports" index={index} meta={summary ? `${summary.totalTrades} trades` : undefined}>
      <div>
        <span className="block text-[11px] text-muted-foreground">{chargesIn ? "Net" : "Gross"}</span>
        <span className="block text-3xl font-semibold leading-tight tracking-tight">{headline === null ? loading ? <Skeleton className="mt-1 h-8 w-36" /> : <NA /> : <Money value={headline} />}</span>
      </div>
      <div className="min-h-20 flex-1">{bars === null ? loading ? <Skeleton className="h-full min-h-20 w-full" /> : null : <DayBars bars={bars} className="h-full" />}</div>
      <dl className="mt-auto flex justify-between gap-3 border-t border-border/70 pt-3">
        <Stat label="Gross">{summary ? <Money value={summary.totalPnl} /> : <NA />}</Stat>
        <Stat label="Charges">{summary && chargesIn ? formatINR(summary.totalCharges) : <NA />}</Stat>
        <Stat label="Per trade">{summary ? <Money value={summary.avgPnl} /> : <NA />}</Stat>
      </dl>
    </Card>
  );
}

// --- Quality ----------------------------------------------------------------------------

export function QualityCard({ summary, index }: { summary: ReportSummary | null; index: number }) {
  const streak = summary && summary.currentStreak.type !== "none" ? summary.currentStreak : null;
  return (
    <Card title="Quality" href="/reports" index={index}>
      <div className="flex items-center gap-4">
        <Ring pct={summary && summary.totalTrades > 0 ? summary.winRatePct : null} label="Win rate" />
        <div className="min-w-0">
          <span className="block text-xl font-semibold tabular-nums" title="Wins / losses">
            {summary ? `${summary.winCount} / ${summary.lossCount}` : <NA />}
          </span>
          <span className="mt-0.5 flex items-baseline gap-1.5 text-[11px] text-muted-foreground">
            Streak
            {streak === null ? <NA /> : <span className={`text-sm font-semibold tabular-nums ${streak.type === "win" ? "text-profit" : "text-danger-fg"}`}>{`${streak.count} ${streak.type === "win" ? "W" : "L"}`}</span>}
          </span>
        </div>
      </div>
      <dl className="mt-auto grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border/70 pt-3">
        <Stat label="Profit factor">{summary?.profitFactor != null ? summary.profitFactor.toFixed(2) : <NA />}</Stat>
        <Stat label="Drawdown" title="Largest fall from a peak of the running P&L">
          {summary && summary.maxDrawdown > 0 ? <Money value={-summary.maxDrawdown} /> : <NA />}
        </Stat>
        <Stat label="Avg win">{summary && summary.winCount > 0 ? <Money value={summary.avgWin} /> : <NA />}</Stat>
        <Stat label="Avg loss">{summary && summary.lossCount > 0 ? <Money value={summary.avgLoss} /> : <NA />}</Stat>
        <Stat label="Best" title={summary?.bestTrade?.label}>
          {summary?.bestTrade ? <Money value={summary.bestTrade.pnl} /> : <NA />}
        </Stat>
        <Stat label="Worst" title={summary?.worstTrade?.label}>
          {summary?.worstTrade ? <Money value={summary.worstTrade.pnl} /> : <NA />}
        </Stat>
      </dl>
    </Card>
  );
}

// --- Latest trades ----------------------------------------------------------------------

const SHOWN_TRADES = 4;

export function TradesCard({ lines, loading, index }: { lines: readonly TradeLine[] | null; loading: boolean; index: number }) {
  return (
    <Card title="Closed" href="/reports" index={index}>
      {lines === null ? (
        loading ? (
          <>
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </>
        ) : (
          <span className="text-2xl font-semibold text-muted-foreground">—</span>
        )
      ) : lines.length === 0 ? (
        <span className="text-2xl font-semibold text-muted-foreground">0</span>
      ) : (
        <ul className="-mt-1 flex flex-col">
          {lines.slice(0, SHOWN_TRADES).map((line) => (
            <li key={line.id}>
              <Link href="/reports" className="-mx-2 flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 transition-colors hover:bg-muted/60">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{line.label}</span>
                  <span className="block text-[11px] tabular-nums text-muted-foreground">{dayLabel(line.date)}</span>
                </span>
                <Money value={line.pnl} className="shrink-0 text-sm font-semibold" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// --- Account ----------------------------------------------------------------------------

export function AccountCard({ funds, paper, index }: { funds: FundsBrief | null; paper: PaperBrief | null; index: number }) {
  return (
    <Card title="Account" href="/payment" index={index}>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
        <Stat label="Capital">{funds ? formatINR(funds.capital) : <NA />}</Stat>
        <Stat label="Return">{funds?.returnPct != null ? <span className={pnlColorClass(funds.returnPct)}>{formatPct(funds.returnPct, 1)}</span> : <NA />}</Stat>
        <Stat label="Paid out">{funds ? formatINR(funds.paidOut) : <NA />}</Stat>
        <Stat label="Pending">{funds ? funds.pending : <NA />}</Stat>
      </dl>
      <Link href="/paper-trade" className="-mx-2 mt-auto block rounded-lg border-t border-border/70 px-2 pt-3 transition-colors hover:bg-muted/60" aria-label="Paper trade">
        <span className="mb-2 block text-[11px] font-medium uppercase tracking-[0.1em] text-muted-foreground">Paper</span>
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Open">{paper ? paper.open : <NA />}</Stat>
          <Stat label="P&L">{paper ? <Money value={paper.pnl} /> : <NA />}</Stat>
          <Stat label="Win">{paper?.winRatePct != null ? `${Math.round(paper.winRatePct)}%` : <NA />}</Stat>
        </dl>
      </Link>
    </Card>
  );
}
