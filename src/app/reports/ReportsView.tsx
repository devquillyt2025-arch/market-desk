"use client";

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";

import DatePicker from "@/components/DatePicker";
import { DownloadIcon, InboxIcon, PrinterIcon } from "@/components/icons";
import LoadingState from "@/components/LoadingState";
import PnlCalendarHeatmap from "@/components/PnlCalendarHeatmap";
import Select from "@/components/Select";
import {
  buildReportCsv,
  computeAccountGrowthSeries,
  computeCumulativeSeries,
  computeDailyPnlMap,
  computePnlByDayOfWeek,
  computePnlByInstrument,
  computePnlByMonth,
  computePnlByOptionType,
  computePnlBySide,
  DATE_RANGE_LABELS,
  DATE_RANGES,
  filterEntriesByRange,
  summarizeEntries,
  type AccountGrowthPoint,
  type CategoryPnl,
  type CumulativePoint,
  type DateRange,
} from "@/lib/calculateReports";
import { formatINR, pnlColorClass } from "@/lib/format";
import { getCachedPayments, getPayments, subscribeToPaymentChanges, type Payment } from "@/lib/paymentStore";
import { showToast } from "@/lib/toast";
import {
  getCachedTradeEntries,
  getTradeEntries,
  subscribeToTradeEntryChanges,
  type TradeEntry,
} from "@/lib/tradeEntriesStore";

const RANGE_OPTIONS = DATE_RANGES.map((r) => ({ value: r, label: DATE_RANGE_LABELS[r] }));

function formatAxisDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function todayISODate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function downloadCsv(filename: string, csv: string) {
  // A leading BOM so Excel (which otherwise guesses the system codepage) reads the ₹ symbol and non-ASCII text correctly.
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function CumulativeTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as CumulativePoint;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground">{formatAxisDate(point.date)}</div>
      <div className={`mt-0.5 font-mono font-semibold ${pnlColorClass(point.cumulativePnl)}`}>
        {formatINR(point.cumulativePnl)}
      </div>
    </div>
  );
}

function CategoryTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as CategoryPnl;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground">{point.label}</div>
      <div className={`mt-0.5 font-mono font-semibold ${pnlColorClass(point.pnl)}`}>{formatINR(point.pnl)}</div>
    </div>
  );
}

function AccountGrowthTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as AccountGrowthPoint;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground">{formatAxisDate(point.date)}</div>
      <div className="mt-1 flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-info" /> Capital
        </span>
        <span className="font-mono font-semibold">{formatINR(point.capital)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-4">
        <span className="flex items-center gap-1.5 text-muted-foreground">
          <span className="size-2 rounded-full bg-accent" /> Equity
        </span>
        <span className={`font-mono font-semibold ${pnlColorClass(point.equity - point.capital)}`}>
          {formatINR(point.equity)}
        </span>
      </div>
    </div>
  );
}

function CategoryPnlChart({ data }: { data: CategoryPnl[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 16, right: 12, left: 12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
        <XAxis
          dataKey="label"
          axisLine={{ stroke: "var(--border)" }}
          tickLine={false}
          tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
        />
        <YAxis hide />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={CategoryTooltip} />
        <Bar dataKey="pnl" radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={entry.pnl >= 0 ? "var(--profit)" : "var(--loss)"} />
          ))}
          <LabelList
            dataKey="pnl"
            position="top"
            formatter={(value) => formatINR(Number(value))}
            style={{ fill: "var(--muted-foreground)", fontSize: 11 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EmptyCategoryNote({ text }: { text: string }) {
  return (
    <div className="flex h-[220px] items-center justify-center text-center text-sm text-muted-foreground">{text}</div>
  );
}

const STREAK_LABELS = { win: "win streak", loss: "loss streak", none: "no streak yet" } as const;

export default function ReportsView() {
  const [entries, setEntries] = useState<TradeEntry[] | null>(getCachedTradeEntries);
  const [payments, setPayments] = useState<Payment[] | null>(getCachedPayments);
  const [range, setRange] = useState<DateRange>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(todayISODate());

  useEffect(() => {
    async function load() {
      try {
        setEntries(await getTradeEntries());
      } catch {
        showToast("Couldn't load report data. Check your connection.");
      }
    }
    load();
    return subscribeToTradeEntryChanges(load);
  }, []);

  // Account Growth pulls from the Payment tab too — its own fetch/subscribe,
  // independent of the trade-entries load above.
  useEffect(() => {
    async function load() {
      try {
        setPayments(await getPayments());
      } catch {
        showToast("Couldn't load payment data for account growth. Check your connection.");
      }
    }
    load();
    return subscribeToPaymentChanges(load);
  }, []);

  const filtered = useMemo(
    () =>
      entries ? filterEntriesByRange(entries, range, range === "custom" ? { from: customFrom, to: customTo } : undefined) : null,
    [entries, range, customFrom, customTo],
  );
  const summary = useMemo(() => (filtered ? summarizeEntries(filtered) : null), [filtered]);
  const cumulative = useMemo(() => (filtered ? computeCumulativeSeries(filtered) : null), [filtered]);
  const byInstrument = useMemo(() => (filtered ? computePnlByInstrument(filtered) : null), [filtered]);
  const bySide = useMemo(() => (filtered ? computePnlBySide(filtered) : null), [filtered]);
  const byOptionType = useMemo(() => (filtered ? computePnlByOptionType(filtered) : null), [filtered]);
  const byMonth = useMemo(() => (filtered ? computePnlByMonth(filtered) : null), [filtered]);
  const byDayOfWeek = useMemo(() => (filtered ? computePnlByDayOfWeek(filtered) : null), [filtered]);

  // Deliberately over the *full* history, not `filtered` — the calendar has
  // its own month navigation, independent of the page's date-range filter.
  const dailyPnl = useMemo(() => computeDailyPnlMap(entries ?? []), [entries]);

  // Also always the full history — see computeAccountGrowthSeries' own comment.
  const accountGrowth = useMemo(
    () => computeAccountGrowthSeries(entries ?? [], payments ?? []),
    [entries, payments],
  );
  // Defaults to the month of the most recent *closing* date, matching the
  // calendar's own closing_date-based data — opening the calendar on a
  // month with entries but no closed trades would just show it empty.
  const heatmapInitialMonth = useMemo(() => {
    const closingDates = (entries ?? []).map((e) => e.closing_date).filter((d): d is string => Boolean(d));
    if (closingDates.length === 0) return new Date();
    const latest = closingDates.reduce((max, d) => (d > max ? d : max), closingDates[0]);
    const [y, m] = latest.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }, [entries]);

  const statTiles = useMemo(
    () =>
      summary
        ? [
            { label: "Total P&L", value: formatINR(summary.totalPnl), color: pnlColorClass(summary.totalPnl) },
            { label: "Win Rate", value: `${summary.winRatePct.toFixed(0)}%`, color: "" },
            { label: "Total Trades", value: String(summary.totalTrades), color: "" },
            { label: "Avg P&L / Trade", value: formatINR(summary.avgPnl), color: pnlColorClass(summary.avgPnl) },
          ]
        : null,
    [summary],
  );

  function handleExportCsv() {
    if (!filtered || filtered.length === 0) {
      showToast("No trade entries in this range to export.");
      return;
    }
    downloadCsv(`reports-${range}-${todayISODate()}.csv`, buildReportCsv(filtered));
  }

  function handlePrint() {
    window.print();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Full analysis of your Trade Entries — P&amp;L trend, breakdowns, streaks, and drawdown.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          {range === "custom" && (
            <>
              <div className="w-32">
                <DatePicker value={customFrom} onChange={setCustomFrom} clearable />
              </div>
              <span className="text-xs text-muted-foreground">to</span>
              <div className="w-32">
                <DatePicker value={customTo} onChange={setCustomTo} clearable />
              </div>
            </>
          )}
          <div className="w-28">
            <Select value={range} onChange={setRange} options={RANGE_OPTIONS} align="right" />
          </div>
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <DownloadIcon className="size-4" />
            CSV
          </button>
          <button
            type="button"
            onClick={handlePrint}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <PrinterIcon className="size-4" />
            Print
          </button>
        </div>
      </div>

      {entries === null ? (
        <LoadingState className="h-40" label="Loading reports…" />
      ) : filtered && filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-10 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No trade entries in this range. Log some in Trade Entries to see reports here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statTiles?.map((stat) => (
              <section key={stat.label} className="rounded-xl border border-border bg-background p-4">
                <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</dd>
              </section>
            ))}
          </div>

          <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
            <h2 className="text-sm font-medium">Cumulative P&amp;L</h2>
            <div className="mt-2">
              <ResponsiveContainer width="100%" height={240}>
                <AreaChart data={cumulative ?? []} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="cumulative-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatAxisDate}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    minTickGap={24}
                  />
                  <YAxis hide />
                  <ReferenceLine y={0} stroke="var(--border)" />
                  <Tooltip
                    cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                    content={CumulativeTooltip}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulativePnl"
                    stroke="var(--accent)"
                    strokeWidth={2}
                    fill="url(#cumulative-fill)"
                    dot={false}
                    activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--background)", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-medium">Account Growth</h2>
              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-info" /> Capital (Pay Ins − Payouts)
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2 rounded-full bg-accent" /> Equity (Capital + P&amp;L)
                </span>
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Always the full history, from your first Pay In on the Payment tab — not limited by the range above.
              Trade P&amp;L lands on its closing date; positions still on hold haven&apos;t moved the balance yet.
            </p>
            <div className="mt-2">
              {accountGrowth.length === 0 ? (
                <EmptyCategoryNote text="Add a Pay In on the Payment tab to start tracking account growth here." />
              ) : (
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={accountGrowth} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
                    <defs>
                      <linearGradient id="equity-fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="var(--border)" strokeOpacity={0.6} />
                    <XAxis
                      dataKey="date"
                      tickFormatter={formatAxisDate}
                      axisLine={{ stroke: "var(--border)" }}
                      tickLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      minTickGap={24}
                    />
                    <YAxis hide />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <Tooltip
                      cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                      content={AccountGrowthTooltip}
                    />
                    <Area
                      type="stepAfter"
                      dataKey="capital"
                      stroke="var(--info)"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      fill="none"
                      dot={false}
                      activeDot={{ r: 3, fill: "var(--info)", stroke: "var(--background)", strokeWidth: 2 }}
                    />
                    <Area
                      type="monotone"
                      dataKey="equity"
                      stroke="var(--accent)"
                      strokeWidth={2}
                      fill="url(#equity-fill)"
                      dot={false}
                      activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--background)", strokeWidth: 2 }}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </section>

          {summary && (
            <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
              <h2 className="text-sm font-medium">Performance</h2>
              <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted-foreground">Best Trade</dt>
                  <dd
                    className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${summary.bestTrade ? pnlColorClass(summary.bestTrade.pnl) : "text-muted-foreground"}`}
                  >
                    {summary.bestTrade ? formatINR(summary.bestTrade.pnl) : "—"}
                  </dd>
                  {summary.bestTrade && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{summary.bestTrade.label}</p>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Worst Trade</dt>
                  <dd
                    className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${summary.worstTrade ? pnlColorClass(summary.worstTrade.pnl) : "text-muted-foreground"}`}
                  >
                    {summary.worstTrade ? formatINR(summary.worstTrade.pnl) : "—"}
                  </dd>
                  {summary.worstTrade && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{summary.worstTrade.label}</p>
                  )}
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Max Drawdown</dt>
                  <dd
                    className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${summary.maxDrawdown > 0 ? "text-loss" : "text-muted-foreground"}`}
                  >
                    {summary.maxDrawdown > 0 ? `-${formatINR(summary.maxDrawdown)}` : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Current Streak</dt>
                  <dd
                    className={`mt-0.5 font-mono text-sm font-semibold tabular-nums ${
                      summary.currentStreak.type === "win"
                        ? "text-profit"
                        : summary.currentStreak.type === "loss"
                          ? "text-loss"
                          : "text-muted-foreground"
                    }`}
                  >
                    {summary.currentStreak.type === "none" ? "—" : summary.currentStreak.count}
                  </dd>
                  <p className="mt-0.5 text-xs text-muted-foreground">{STREAK_LABELS[summary.currentStreak.type]}</p>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Profit Factor</dt>
                  <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums">
                    {summary.profitFactor === null ? "∞" : summary.profitFactor.toFixed(2)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Avg Win</dt>
                  <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-profit">
                    {formatINR(summary.avgWin)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Avg Loss</dt>
                  <dd className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-loss">
                    {formatINR(summary.avgLoss)}
                  </dd>
                </div>
              </div>
            </section>
          )}

          <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
            <h2 className="text-sm font-medium">Daily P&amp;L Calendar</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              By closing date — P&amp;L lands on the day a position was squared off, not the day it was opened.
              Entries still on hold don&apos;t show here yet.
            </p>
            <div className="mt-2">
              <PnlCalendarHeatmap dailyPnl={dailyPnl} initialMonth={heatmapInitialMonth} />
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
              <h2 className="text-sm font-medium">P&amp;L by Instrument</h2>
              <div className="mt-2">
                <CategoryPnlChart data={byInstrument ?? []} />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
              <h2 className="text-sm font-medium">P&amp;L by Day of Week</h2>
              <div className="mt-2">
                <CategoryPnlChart data={byDayOfWeek ?? []} />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
              <h2 className="text-sm font-medium">P&amp;L by Side</h2>
              <div className="mt-2">
                <CategoryPnlChart data={bySide ?? []} />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
              <h2 className="text-sm font-medium">P&amp;L by Option Type</h2>
              <div className="mt-2">
                {byOptionType && byOptionType.length > 0 ? (
                  <CategoryPnlChart data={byOptionType} />
                ) : (
                  <EmptyCategoryNote text="No options trades (with a CE/PE set) in this range." />
                )}
              </div>
            </section>
          </div>

          <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
            <h2 className="text-sm font-medium">P&amp;L by Month</h2>
            <div className="mt-2">
              {byMonth && byMonth.length > 0 ? (
                <CategoryPnlChart data={byMonth} />
              ) : (
                <EmptyCategoryNote text="No data in this range." />
              )}
            </div>
          </section>

          {summary && (
            <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">Win Rate</h2>
                <span className="font-mono text-sm font-semibold tabular-nums">
                  {summary.winCount}W / {summary.lossCount}L
                  {summary.totalTrades - summary.winCount - summary.lossCount > 0
                    ? ` / ${summary.totalTrades - summary.winCount - summary.lossCount} flat`
                    : ""}
                </span>
              </div>
              <div className="mt-3 h-2.5 w-full overflow-hidden rounded-full bg-loss/20">
                <div
                  className="h-full rounded-full bg-profit transition-[width] duration-300"
                  style={{ width: `${summary.winRatePct}%` }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  <span className="font-medium text-foreground">{summary.squaredOffCount}</span> squared off
                </span>
                <span>
                  <span className="font-medium text-foreground">{summary.holdCount}</span> on hold
                </span>
              </div>
            </section>
          )}
        </>
      )}
    </motion.div>
  );
}
