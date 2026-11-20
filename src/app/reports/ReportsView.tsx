"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useState } from "react";
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

import Link from "next/link";

import CustomRangePanel from "@/components/CustomRangePanel";
import { DownloadIcon, RefreshIcon } from "@/components/icons";
import LoadingState from "@/components/LoadingState";
import PnlCalendarHeatmap from "@/components/PnlCalendarHeatmap";
import Select from "@/components/Select";
import UpstoxTradeSummary from "@/components/UpstoxTradeSummary";
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
  computeReturnPct,
  CUMULATIVE_RANGE_LABELS,
  CUMULATIVE_RANGES,
  DATE_RANGE_LABELS,
  DATE_RANGES,
  filterEntriesByClosingRange,
  filterEntriesByRange,
  reportWindow,
  summarizeTrades,
  type AccountGrowthPoint,
  type CategoryPnl,
  type CumulativePoint,
  type CumulativeRange,
  type DateRange,
} from "@/lib/calculateReports";
import { formatINR, formatPct, pnlColorClass } from "@/lib/format";
import { PAGE_HEIGHT_LOCK_CLASS } from "@/lib/layout";
import { localIsoDate } from "@/lib/localDate";
import { getCachedPayments, getPayments, subscribeToPaymentChanges, type Payment } from "@/lib/paymentStore";
import { showToast } from "@/lib/toast";
import { segmentsOfScope, UPSTOX_SUMMARY_SCOPE_LABELS, UPSTOX_SUMMARY_SCOPES, type UpstoxSummaryScope } from "@/lib/upstox/types";
import { usePnlCharges, useUpstoxReport } from "@/lib/useUpstoxReport";

const RANGE_OPTIONS = DATE_RANGES.map((r) => ({ value: r, label: DATE_RANGE_LABELS[r] }));
const SCOPE_OPTIONS = UPSTOX_SUMMARY_SCOPES.map((s) => ({ value: s, label: UPSTOX_SUMMARY_SCOPE_LABELS[s] }));

/** "21 Nov, 10:42" - when the report on screen was fetched. */
function formatUpdated(ms: number): string {
  return new Date(ms).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

const CATEGORY_BREAKDOWN_PILLS = [
  { value: "instrument", label: "Instrument" },
  { value: "dayOfWeek", label: "Day of Week" },
  { value: "side", label: "Side" },
  { value: "optionType", label: "Option Type" },
  { value: "month", label: "Month" },
] as const;
type CategoryBreakdown = (typeof CATEGORY_BREAKDOWN_PILLS)[number]["value"];

function formatAxisDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

/** Compact ₹ amount for a Y-axis tick — lakh/crore grouping, matching how the rest of the app reads Indian currency. */
function formatAxisAmount(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}₹${round1(abs / 1_00_00_000)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${round1(abs / 1_00_000)}L`;
  if (abs >= 1_000) return `${sign}₹${round1(abs / 1_000)}k`;
  return `${sign}₹${abs}`;
}

/** Compact % for a Y-axis tick, e.g. +12.3%. */
function formatAxisPct(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${round1(value)}%`;
}

function round1(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function todayISODate(): string {
  return localIsoDate();
}

/**
 * Anchors the Cumulative P&L chart to the selected window — a fixed range
 * (1W/15D/1M/3M) should always span from "today minus N days" to today, not
 * just from the first to the last trade that happened to close in it. Adds a
 * zero point at the window's start if trading only began partway through it,
 * and holds the line flat out to today if the last close wasn't today, so
 * the axis reads as a real calendar window rather than a data-driven one.
 */
function padCumulativeToToday(points: CumulativePoint[], range: CumulativeRange): CumulativePoint[] {
  const today = todayISODate();
  // "All" has no fixed window to anchor a start to, but it should still hold
  // flat out to today like every other range — otherwise it can end up
  // spanning *less* visible time than a narrower range (e.g. 3M) just
  // because nothing closed today, which reads as the range picker doing
  // nothing.
  if (range === "all") {
    if (points.length === 0) return points;
    const last = points[points.length - 1];
    return last.date < today ? [...points, { date: today, cumulativePnl: last.cumulativePnl }] : points;
  }
  const days = range === "7d" ? 7 : range === "15d" ? 15 : range === "30d" ? 30 : 90;
  const cutoffIso = localIsoDate(days);

  const padded = [...points];
  if (padded.length === 0 || padded[0].date > cutoffIso) {
    padded.unshift({ date: cutoffIso, cumulativePnl: 0 });
  }
  const last = padded[padded.length - 1];
  if (last.date < today) {
    padded.push({ date: today, cumulativePnl: last.cumulativePnl });
  }
  return padded;
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

type CumulativeChartPoint = CumulativePoint & { cumulativePct: number | null };

function CumulativeTooltip({ active, payload, mode }: TooltipContentProps & { mode: ValueMode }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as CumulativeChartPoint;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground">{formatAxisDate(point.date)}</div>
      <div className={`mt-0.5 font-mono font-semibold ${pnlColorClass(point.cumulativePnl)}`}>
        {mode === "percent" && point.cumulativePct !== null ? formatPct(point.cumulativePct) : formatINR(point.cumulativePnl)}
      </div>
    </div>
  );
}

type ValueMode = "amount" | "percent";

/** Small ₹ / % pill switch reused by the Category Breakdown and Cumulative P&L charts. */
function ValueModeToggle({
  mode,
  onChange,
  percentDisabled,
}: {
  mode: ValueMode;
  onChange: (mode: ValueMode) => void;
  /** True when there's no capital figure to divide by yet (no Pay In logged) — % would be meaningless. */
  percentDisabled?: boolean;
}) {
  const options: { value: ValueMode; label: string }[] = [
    { value: "amount", label: "₹" },
    { value: "percent", label: "%" },
  ];
  return (
    <div className="flex w-fit shrink-0 items-center gap-1 rounded-full border border-border bg-background p-1">
      {options.map((opt) => {
        const active = mode === opt.value;
        const disabled = opt.value === "percent" && percentDisabled;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            disabled={disabled}
            title={disabled ? "Add a Pay In on the Payment tab to see % of capital" : undefined}
            aria-pressed={active}
            className={`relative shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors active:scale-95 ${
              active ? "bg-accent-solid text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function CategoryTooltip({ active, payload, mode }: TooltipContentProps & { mode: ValueMode }) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0].payload as CategoryPnl;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground">{point.label}</div>
      <div className={`mt-0.5 font-mono font-semibold ${pnlColorClass(point.pnl)}`}>
        {mode === "percent" ? formatPct(point.pct) : formatINR(point.pnl)}
      </div>
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
          <span className="size-2 rounded-full bg-accent-solid" /> Equity
        </span>
        <span className={`font-mono font-semibold ${pnlColorClass(point.equity - point.capital)}`}>
          {formatINR(point.equity)}
        </span>
      </div>
    </div>
  );
}

function CategoryPnlChart({ data, mode }: { data: CategoryPnl[]; mode: ValueMode }) {
  const dataKey = mode === "percent" ? "pct" : "pnl";
  const formatValue = mode === "percent" ? formatPct : formatINR;
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
        <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={(props) => <CategoryTooltip {...props} mode={mode} />} />
        <Bar dataKey={dataKey} radius={[4, 4, 0, 0]} maxBarSize={48}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={entry.pnl >= 0 ? "var(--profit)" : "var(--loss)"} />
          ))}
          <LabelList
            dataKey={dataKey}
            position="top"
            formatter={(value) => formatValue(Number(value))}
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
  // Everything on this page is Upstox's own P&L report - not the Trade Entries journal - so it reads like Upstox's does.
  const report = useUpstoxReport();
  const [scope, setScope] = useState<UpstoxSummaryScope>("ALL");
  const [payments, setPayments] = useState<Payment[] | null>(getCachedPayments);
  const [range, setRange] = useState<DateRange>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(todayISODate());
  // Whether the floating From/To panel is showing — separate from `range`, so it can be dismissed and the range kept.
  const [customOpen, setCustomOpen] = useState(false);
  const [breakdownBy, setBreakdownBy] = useState<CategoryBreakdown>("instrument");
  const [cumulativeRange, setCumulativeRange] = useState<CumulativeRange>("7d");
  const [categoryValueMode, setCategoryValueMode] = useState<ValueMode>("amount");
  const [cumulativeValueMode, setCumulativeValueMode] = useState<ValueMode>("amount");

  // Account Growth pulls from the Payment tab too — its own fetch/subscribe,
  // independent of Upstox's report.
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

  // The report's trades in the segment picked (F&O + MCX by default) - what every section below is cut from.
  const scoped = useMemo(() => {
    const segments = segmentsOfScope(scope);
    return report.trades ? report.trades.filter((t) => segments.includes(t.segment)) : null;
  }, [report.trades, scope]);
  const filtered = useMemo(
    () => (scoped ? filterEntriesByRange(scoped, range, range === "custom" ? { from: customFrom, to: customTo } : undefined) : null),
    [scoped, range, customFrom, customTo],
  );
  // Upstox's charges for the same window: the one thing a report row doesn't carry, so Net P&L and Return % wait for them.
  const span = useMemo(() => reportWindow(range, { from: customFrom, to: customTo }), [range, customFrom, customTo]);
  const charges = usePnlCharges(scope, span.from, span.to, report.trades !== null);
  const summary = useMemo(() => (filtered ? summarizeTrades(filtered, charges.charges?.total ?? 0) : null), [filtered, charges.charges]);
  const buyValue = useMemo(() => (filtered ?? []).reduce((sum, t) => sum + t.buy_amount, 0), [filtered]);
  const cumulative = useMemo(
    () =>
      scoped
        ? padCumulativeToToday(computeCumulativeSeries(filterEntriesByClosingRange(scoped, cumulativeRange)), cumulativeRange)
        : null,
    [scoped, cumulativeRange],
  );
  const byInstrument = useMemo(() => (filtered ? computePnlByInstrument(filtered) : null), [filtered]);
  const bySide = useMemo(() => (filtered ? computePnlBySide(filtered) : null), [filtered]);
  const byOptionType = useMemo(() => (filtered ? computePnlByOptionType(filtered) : null), [filtered]);
  const byMonth = useMemo(() => (filtered ? computePnlByMonth(filtered) : null), [filtered]);
  const byDayOfWeek = useMemo(() => (filtered ? computePnlByDayOfWeek(filtered) : null), [filtered]);

  const categoryBreakdowns: Record<CategoryBreakdown, { data: CategoryPnl[] | null; emptyText: string }> = {
    instrument: { data: byInstrument, emptyText: "No data in this range." },
    dayOfWeek: { data: byDayOfWeek, emptyText: "No data in this range." },
    side: { data: bySide, emptyText: "No data in this range." },
    optionType: { data: byOptionType, emptyText: "No options trades (with a CE/PE set) in this range." },
    month: { data: byMonth, emptyText: "No data in this range." },
  };
  const activeBreakdown = categoryBreakdowns[breakdownBy];

  // Deliberately over the *full* history, not `filtered` — the calendar has
  // its own month navigation, independent of the page's date-range filter.
  const dailyPnl = useMemo(() => computeDailyPnlMap(scoped ?? []), [scoped]);

  // Also always the full history — see computeAccountGrowthSeries' own comment.
  const accountGrowth = useMemo(
    () => computeAccountGrowthSeries(scoped ?? [], payments ?? []),
    [scoped, payments],
  );
  // Net Pay Ins to date (not filtered by the page's range) — the denominator
  // for every "Return %" figure below, so a return is always relative to
  // capital actually put in, not just to whatever closed within the range.
  const latestCapital = accountGrowth.length > 0 ? accountGrowth[accountGrowth.length - 1].capital : 0;
  // Net of Upstox's real charges - so not until they have arrived.
  const returnPct = summary && charges.charges ? computeReturnPct(summary.netPnl, latestCapital) : null;
  const cumulativeWithPct: CumulativeChartPoint[] | null = useMemo(
    () =>
      cumulative
        ? cumulative.map((point) => ({ ...point, cumulativePct: computeReturnPct(point.cumulativePnl, latestCapital) }))
        : null,
    [cumulative, latestCapital],
  );
  // Defaults to the month of the most recent *closing* date, matching the
  // calendar's own closing_date-based data — opening the calendar on a
  // month with entries but no closed trades would just show it empty.
  const heatmapInitialMonth = useMemo(() => {
    const closingDates = (scoped ?? []).map((e) => e.closing_date).filter((d): d is string => Boolean(d));
    if (closingDates.length === 0) return new Date();
    const latest = closingDates.reduce((max, d) => (d > max ? d : max), closingDates[0]);
    const [y, m] = latest.split("-").map(Number);
    return new Date(y, m - 1, 1);
  }, [scoped]);

  // The headline figures that open the Performance card.
  const statTiles = useMemo<{ label: string; value: string; color: string; sub?: string }[] | null>(
    () =>
      summary
        ? [
            { label: "Total P&L", value: formatINR(summary.totalPnl), color: pnlColorClass(summary.totalPnl) },
            {
              label: "Return %",
              value: returnPct === null ? "—" : formatPct(returnPct, 2),
              color: returnPct === null ? "" : pnlColorClass(returnPct),
            },
            {
              label: "Win Rate",
              value: `${summary.winRatePct.toFixed(0)}%`,
              color: "",
              sub: `${summary.winCount}W / ${summary.lossCount}L${
                summary.totalTrades - summary.winCount - summary.lossCount > 0
                  ? ` / ${summary.totalTrades - summary.winCount - summary.lossCount}F`
                  : ""
              }`,
            },
            { label: "Total Trades", value: String(summary.totalTrades), color: "" },
            { label: "Avg P&L / Trade", value: formatINR(summary.avgPnl), color: pnlColorClass(summary.avgPnl) },
          ]
        : null,
    [summary, returnPct],
  );

  // Picking "Custom" (again, too) opens the date panel; any other range dismisses it.
  function handleRangeChange(next: DateRange) {
    setRange(next);
    setCustomOpen(next === "custom");
  }
  const closeCustom = useCallback(() => setCustomOpen(false), []);

  function handleExportCsv() {
    if (!filtered || filtered.length === 0) {
      showToast("No trades in this range to export.");
      return;
    }
    downloadCsv(`reports-${range}-${todayISODate()}.csv`, buildReportCsv(filtered));
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      // Locked to the viewport so the header (range, sync, export) stays put
      // above a divider and only the report below it scrolls. Printing drops
      // the lock — the important modifier outranks the lock's breakpoint
      // heights — so the whole report still comes out, not one screenful.
      className={`flex flex-col ${PAGE_HEIGHT_LOCK_CLASS} print:h-auto!`}
    >
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your Upstox P&amp;L report — P&amp;L trend, breakdowns, streaks, and drawdown.
          </p>
        </div>
        {/* `relative` anchors the custom-range panel: it floats under this row instead of sitting in it, so choosing Custom never reflows the header. */}
        <div className="relative flex flex-wrap items-center gap-2 print:hidden">
          <div className="w-28">
            <Select value={range} onChange={handleRangeChange} options={RANGE_OPTIONS} align="right" />
          </div>
          <AnimatePresence>
            {customOpen && range === "custom" && (
              <CustomRangePanel
                from={customFrom}
                to={customTo}
                onFromChange={setCustomFrom}
                onToChange={setCustomTo}
                onClose={closeCustom}
              />
            )}
          </AnimatePresence>
          <div className="w-36">
            <Select value={scope} onChange={setScope} options={SCOPE_OPTIONS} align="right" />
          </div>
          <button
            type="button"
            onClick={() => void report.refresh()}
            disabled={report.refreshing}
            aria-label="Refresh from Upstox"
            title="Refresh from Upstox"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 disabled:opacity-60"
          >
            <RefreshIcon className={`size-4 ${report.refreshing ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            <DownloadIcon className="size-4" />
            CSV
          </button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto pt-6 print:overflow-visible">
        {report.loading && <LoadingState className="h-40" label="Loading your Upstox report…" />}

        {/* Upstox couldn't be reached: say why, and whether what is below is an old copy. */}
        {report.error && !report.loading && (
          <div role="status" className="rounded-xl border border-border bg-background px-4 py-3 text-sm text-muted-foreground">
            {report.error === "token_expired" ? (
              <>
                Your Upstox token has expired.{" "}
                <Link href="/settings" className="font-medium text-accent hover:underline">
                  Add today&apos;s token
                </Link>{" "}
                to load the latest report.
              </>
            ) : report.error === "network_error" ? (
              "No internet connection."
            ) : (
              `Couldn't load Upstox's report — ${report.error}.`
            )}{" "}
            {report.trades && report.fetchedAt ? `Showing the copy saved on ${formatUpdated(report.fetchedAt)}.` : "Nothing is saved on this device yet."}{" "}
            <button type="button" onClick={() => void report.refresh()} className="font-medium text-accent hover:underline">
              Try again
            </button>
          </div>
        )}

        {report.trades && !report.error && report.fetchedAt && (
          <p className="-mb-3 text-xs text-muted-foreground print:hidden">
            From Upstox&apos;s P&amp;L report · updated {formatUpdated(report.fetchedAt)}. Upstox adds a day&apos;s trades to it the next day.
          </p>
        )}

        {summary && (
          <UpstoxTradeSummary scope={scope} from={span.from} to={span.to} summary={summary} buyValue={buyValue} charges={charges} />
        )}

        {filtered && filtered.length > 0 && (
          <>
            {summary && (
              <section className="rounded-xl border border-border bg-background p-4 sm:p-5">
                <h2 className="text-sm font-medium">Performance</h2>
                {/* Four tiles across, three rows: the headline figures first, then the trade-level ones. */}
                <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {statTiles?.map((stat) => (
                    <div key={stat.label} className="rounded-lg border border-border bg-card p-3">
                      <dt className="text-sm text-muted-foreground">{stat.label}</dt>
                      <dd className="mt-1">
                        <span className={`block font-mono text-lg font-semibold tabular-nums ${stat.color}`}>{stat.value}</span>
                        {stat.sub && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{stat.sub}</span>}
                      </dd>
                    </div>
                  ))}
                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-sm text-muted-foreground">Best Trade</dt>
                    <dd className="mt-1">
                      <span
                        className={`block font-mono text-lg font-semibold tabular-nums ${summary.bestTrade ? pnlColorClass(summary.bestTrade.pnl) : "text-muted-foreground"}`}
                      >
                        {summary.bestTrade ? formatINR(summary.bestTrade.pnl) : "—"}
                      </span>
                      {summary.bestTrade && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary.bestTrade.label}</span>}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-sm text-muted-foreground">Worst Trade</dt>
                    <dd className="mt-1">
                      <span
                        className={`block font-mono text-lg font-semibold tabular-nums ${summary.worstTrade ? pnlColorClass(summary.worstTrade.pnl) : "text-muted-foreground"}`}
                      >
                        {summary.worstTrade ? formatINR(summary.worstTrade.pnl) : "—"}
                      </span>
                      {summary.worstTrade && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{summary.worstTrade.label}</span>}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-sm text-muted-foreground">Max Drawdown</dt>
                    <dd
                      className={`mt-1 font-mono text-lg font-semibold tabular-nums ${summary.maxDrawdown > 0 ? "text-danger-fg" : "text-muted-foreground"}`}
                    >
                      {summary.maxDrawdown > 0 ? `-${formatINR(summary.maxDrawdown)}` : "—"}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-sm text-muted-foreground">Current Streak</dt>
                    <dd className="mt-1">
                      <span
                        className={`block font-mono text-lg font-semibold tabular-nums ${
                          summary.currentStreak.type === "win"
                            ? "text-profit"
                            : summary.currentStreak.type === "loss"
                              ? "text-danger-fg"
                              : "text-muted-foreground"
                        }`}
                      >
                        {summary.currentStreak.type === "none" ? "—" : summary.currentStreak.count}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">{STREAK_LABELS[summary.currentStreak.type]}</span>
                    </dd>
                  </div>

                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-sm text-muted-foreground">Profit Factor</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                      {summary.profitFactor === null ? "∞" : summary.profitFactor.toFixed(2)}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-sm text-muted-foreground">Avg Win</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-profit">
                      {formatINR(summary.avgWin)}
                    </dd>
                  </div>
                  <div className="rounded-lg border border-border bg-card p-3">
                    <dt className="text-sm text-muted-foreground">Avg Loss</dt>
                    <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-danger-fg">
                      {formatINR(summary.avgLoss)}
                    </dd>
                  </div>
                </dl>
              </section>
            )}

            <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium">Cumulative P&amp;L</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex w-fit max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-full border border-border bg-background p-1">
                    {CUMULATIVE_RANGES.map((r) => {
                      const active = cumulativeRange === r;
                      return (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setCumulativeRange(r)}
                          aria-pressed={active}
                          className={`relative shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors active:scale-95 ${
                            active ? "text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="cumulative-range-pill-active"
                              className="absolute inset-0 rounded-full bg-accent-solid"
                              transition={{ type: "spring", stiffness: 500, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10">{CUMULATIVE_RANGE_LABELS[r]}</span>
                        </button>
                      );
                    })}
                  </div>
                  <ValueModeToggle mode={cumulativeValueMode} onChange={setCumulativeValueMode} percentDisabled={latestCapital <= 0} />
                </div>
              </div>
              <div className="mt-2">
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={cumulativeWithPct ?? []} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
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
                    <YAxis
                      tickFormatter={cumulativeValueMode === "percent" ? formatAxisPct : formatAxisAmount}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      width={56}
                    />
                    <ReferenceLine y={0} stroke="var(--border)" />
                    <Tooltip
                      cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1 }}
                      content={(props) => <CumulativeTooltip {...props} mode={cumulativeValueMode} />}
                    />
                    <Area
                      type="stepAfter"
                      dataKey={cumulativeValueMode === "percent" ? "cumulativePct" : "cumulativePnl"}
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
                    <span className="size-2 rounded-full bg-accent-solid" /> Equity (Capital + P&amp;L)
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
                      <YAxis
                        tickFormatter={formatAxisAmount}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                        width={56}
                      />
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

            <section className="rounded-xl border border-border bg-background p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-medium">P&amp;L by {CATEGORY_BREAKDOWN_PILLS.find((p) => p.value === breakdownBy)?.label}</h2>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex w-fit max-w-full shrink-0 items-center gap-1 overflow-x-auto rounded-full border border-border bg-background p-1">
                    {CATEGORY_BREAKDOWN_PILLS.map((opt) => {
                      const active = breakdownBy === opt.value;
                      return (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => setBreakdownBy(opt.value)}
                          aria-pressed={active}
                          className={`relative shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors active:scale-95 ${
                            active ? "text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                          }`}
                        >
                          {active && (
                            <motion.span
                              layoutId="category-breakdown-pill-active"
                              className="absolute inset-0 rounded-full bg-accent-solid"
                              transition={{ type: "spring", stiffness: 500, damping: 35 }}
                            />
                          )}
                          <span className="relative z-10">{opt.label}</span>
                        </button>
                      );
                    })}
                  </div>
                  <ValueModeToggle mode={categoryValueMode} onChange={setCategoryValueMode} />
                </div>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {categoryValueMode === "percent"
                  ? "Each bar's share of this breakdown's own net P&L — a losing slice can push another past 100%."
                  : "Net P&L per slice, in ₹."}
              </p>
              <div className="mt-2">
                {activeBreakdown.data && activeBreakdown.data.length > 0 ? (
                  <CategoryPnlChart data={activeBreakdown.data} mode={categoryValueMode} />
                ) : (
                  <EmptyCategoryNote text={activeBreakdown.emptyText} />
                )}
              </div>
            </section>

          </>
        )}
      </div>
    </motion.div>
  );
}
