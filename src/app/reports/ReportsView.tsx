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
  Pie,
  PieChart,
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
  computeReturnPct,
  computeTradeMixByInstrument,
  CUMULATIVE_RANGE_LABELS,
  CUMULATIVE_RANGES,
  DATE_RANGE_LABELS,
  DATE_RANGES,
  filterEntriesByClosingRange,
  filterEntriesByRange,
  summarizeEntries,
  type AccountGrowthPoint,
  type CategoryPnl,
  type CumulativePoint,
  type CumulativeRange,
  type DateRange,
  type TradeMixSlice,
} from "@/lib/calculateReports";
import { formatINR, formatPct, pnlColorClass } from "@/lib/format";
import { getCachedPayments, getPayments, subscribeToPaymentChanges, type Payment } from "@/lib/paymentStore";
import { showToast } from "@/lib/toast";
import {
  getCachedTradeEntries,
  getTradeEntries,
  subscribeToTradeEntryChanges,
  type TradeEntry,
} from "@/lib/tradeEntriesStore";

const RANGE_OPTIONS = DATE_RANGES.map((r) => ({ value: r, label: DATE_RANGE_LABELS[r] }));

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
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
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
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

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
              active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
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
          <span className="size-2 rounded-full bg-accent" /> Equity
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

/** Cycled by slice index — accent/info/soft-accent cover today's 3 instruments, with success/danger as headroom for more. */
const TRADE_MIX_COLORS = ["var(--accent)", "var(--info)", "var(--accent-soft)", "var(--success)", "var(--danger)"];

function TradeMixTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  const slice = payload[0].payload as TradeMixSlice & { pct: number };
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-lg">
      <div className="text-muted-foreground">{slice.label}</div>
      <div className="mt-0.5 font-mono font-semibold">
        {slice.count} trade{slice.count === 1 ? "" : "s"} · {Math.round(slice.pct)}%
      </div>
    </div>
  );
}

/** Trade *count* composition, not P&L — where activity concentrates, as opposed to every other chart on this page which is about profit. Fixed pixel height (not "100%") — a ResponsiveContainer with a percentage height inside nested flex wrappers has no reliably non-zero resolved height to measure against and renders nothing. */
function TradeMixChart({ data }: { data: TradeMixSlice[] }) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const withPct = data.map((d) => ({ ...d, pct: total > 0 ? (d.count / total) * 100 : 0 }));
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="w-full flex-1">
        <ResponsiveContainer width="100%" height={280}>
          <PieChart>
            <Tooltip content={TradeMixTooltip} />
            <Pie
              data={withPct}
              dataKey="count"
              nameKey="label"
              innerRadius={80}
              outerRadius={120}
              paddingAngle={2}
              strokeWidth={0}
            >
              {withPct.map((slice, i) => (
                <Cell key={slice.label} fill={TRADE_MIX_COLORS[i % TRADE_MIX_COLORS.length]} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex w-full shrink-0 flex-col justify-center gap-3 sm:w-auto sm:min-w-[170px]">
        {withPct.map((slice, i) => (
          <div key={slice.label} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: TRADE_MIX_COLORS[i % TRADE_MIX_COLORS.length] }}
              />
              {slice.label}
            </span>
            <span className="font-mono font-medium tabular-nums">
              {slice.count} · {Math.round(slice.pct)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const STREAK_LABELS = { win: "win streak", loss: "loss streak", none: "no streak yet" } as const;

export default function ReportsView() {
  const [entries, setEntries] = useState<TradeEntry[] | null>(getCachedTradeEntries);
  const [payments, setPayments] = useState<Payment[] | null>(getCachedPayments);
  const [range, setRange] = useState<DateRange>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState(todayISODate());
  const [breakdownBy, setBreakdownBy] = useState<CategoryBreakdown>("instrument");
  const [cumulativeRange, setCumulativeRange] = useState<CumulativeRange>("7d");
  const [categoryValueMode, setCategoryValueMode] = useState<ValueMode>("amount");
  const [cumulativeValueMode, setCumulativeValueMode] = useState<ValueMode>("amount");

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
  const cumulative = useMemo(
    () =>
      entries
        ? padCumulativeToToday(computeCumulativeSeries(filterEntriesByClosingRange(entries, cumulativeRange)), cumulativeRange)
        : null,
    [entries, cumulativeRange],
  );
  const byInstrument = useMemo(() => (filtered ? computePnlByInstrument(filtered) : null), [filtered]);
  const bySide = useMemo(() => (filtered ? computePnlBySide(filtered) : null), [filtered]);
  const byOptionType = useMemo(() => (filtered ? computePnlByOptionType(filtered) : null), [filtered]);
  const byMonth = useMemo(() => (filtered ? computePnlByMonth(filtered) : null), [filtered]);
  const byDayOfWeek = useMemo(() => (filtered ? computePnlByDayOfWeek(filtered) : null), [filtered]);
  const tradeMix = useMemo(() => (filtered ? computeTradeMixByInstrument(filtered) : null), [filtered]);

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
  const dailyPnl = useMemo(() => computeDailyPnlMap(entries ?? []), [entries]);

  // Also always the full history — see computeAccountGrowthSeries' own comment.
  const accountGrowth = useMemo(
    () => computeAccountGrowthSeries(entries ?? [], payments ?? []),
    [entries, payments],
  );
  // Net Pay Ins to date (not filtered by the page's range) — the denominator
  // for every "Return %" figure below, so a return is always relative to
  // capital actually put in, not just to whatever closed within the range.
  const latestCapital = accountGrowth.length > 0 ? accountGrowth[accountGrowth.length - 1].capital : 0;
  const returnPct = summary ? computeReturnPct(summary.netPnl, latestCapital) : null;
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
            {
              label: "Return %",
              value: returnPct === null ? "—" : formatPct(returnPct, 2),
              color: returnPct === null ? "" : pnlColorClass(returnPct),
            },
            { label: "Win Rate", value: `${summary.winRatePct.toFixed(0)}%`, color: "" },
            { label: "Total Trades", value: String(summary.totalTrades), color: "" },
            { label: "Avg P&L / Trade", value: formatINR(summary.avgPnl), color: pnlColorClass(summary.avgPnl) },
          ]
        : null,
    [summary, returnPct],
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {statTiles?.map((stat) => (
              <section key={stat.label} className="rounded-xl border border-border bg-background p-4">
                <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</dd>
              </section>
            ))}
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            {summary && (
              <section className="rounded-xl border border-border bg-background p-4">
                <h2 className="text-sm font-medium">Performance</h2>
                <div className="mt-2 flex flex-col divide-y divide-border">
                  <div className="flex items-center justify-between gap-3 py-1.5 first:pt-0">
                    <dt className="text-sm text-muted-foreground">Best Trade</dt>
                    <div className="text-right">
                      <dd
                        className={`font-mono text-base font-semibold tabular-nums ${summary.bestTrade ? pnlColorClass(summary.bestTrade.pnl) : "text-muted-foreground"}`}
                      >
                        {summary.bestTrade ? formatINR(summary.bestTrade.pnl) : "—"}
                      </dd>
                      {summary.bestTrade && (
                        <p className="truncate text-xs text-muted-foreground">{summary.bestTrade.label}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1.5">
                    <dt className="text-sm text-muted-foreground">Worst Trade</dt>
                    <div className="text-right">
                      <dd
                        className={`font-mono text-base font-semibold tabular-nums ${summary.worstTrade ? pnlColorClass(summary.worstTrade.pnl) : "text-muted-foreground"}`}
                      >
                        {summary.worstTrade ? formatINR(summary.worstTrade.pnl) : "—"}
                      </dd>
                      {summary.worstTrade && (
                        <p className="truncate text-xs text-muted-foreground">{summary.worstTrade.label}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1.5">
                    <dt className="text-sm text-muted-foreground">Max Drawdown</dt>
                    <dd
                      className={`font-mono text-base font-semibold tabular-nums ${summary.maxDrawdown > 0 ? "text-loss" : "text-muted-foreground"}`}
                    >
                      {summary.maxDrawdown > 0 ? `-${formatINR(summary.maxDrawdown)}` : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1.5">
                    <dt className="text-sm text-muted-foreground">Current Streak</dt>
                    <div className="text-right">
                      <dd
                        className={`font-mono text-base font-semibold tabular-nums ${
                          summary.currentStreak.type === "win"
                            ? "text-profit"
                            : summary.currentStreak.type === "loss"
                              ? "text-loss"
                              : "text-muted-foreground"
                        }`}
                      >
                        {summary.currentStreak.type === "none" ? "—" : summary.currentStreak.count}
                      </dd>
                      <p className="text-xs text-muted-foreground">{STREAK_LABELS[summary.currentStreak.type]}</p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1.5">
                    <dt className="text-sm text-muted-foreground">Profit Factor</dt>
                    <dd className="font-mono text-base font-semibold tabular-nums">
                      {summary.profitFactor === null ? "∞" : summary.profitFactor.toFixed(2)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1.5">
                    <dt className="text-sm text-muted-foreground">Avg Win</dt>
                    <dd className="font-mono text-base font-semibold tabular-nums text-profit">
                      {formatINR(summary.avgWin)}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 py-1.5 last:pb-0">
                    <dt className="text-sm text-muted-foreground">Avg Loss</dt>
                    <dd className="font-mono text-base font-semibold tabular-nums text-loss">
                      {formatINR(summary.avgLoss)}
                    </dd>
                  </div>
                </div>

                <div className="mt-3 border-t border-border pt-3">
                  <div className="flex items-center justify-between">
                    <dt className="text-sm text-muted-foreground">Win Rate</dt>
                    <span className="font-mono text-base font-semibold tabular-nums">
                      {summary.winCount}W / {summary.lossCount}L
                      {summary.totalTrades - summary.winCount - summary.lossCount > 0
                        ? ` / ${summary.totalTrades - summary.winCount - summary.lossCount} flat`
                        : ""}
                    </span>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-loss/20">
                    <div
                      className="h-full rounded-full bg-profit transition-[width] duration-300"
                      style={{ width: `${summary.winRatePct}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      <span className="font-medium text-foreground">{summary.squaredOffCount}</span> squared off
                    </span>
                    <span>
                      <span className="font-medium text-foreground">{summary.holdCount}</span> on hold
                    </span>
                  </div>
                </div>
              </section>
            )}

            <section className="flex flex-col rounded-xl border border-border bg-background p-5 sm:p-6">
              <h2 className="text-sm font-medium">Trade Mix</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Share of trades by instrument — where activity concentrates, not where the profit came from.
              </p>
              <div className="mt-2 min-h-0 flex-1">
                {tradeMix && tradeMix.length > 0 ? (
                  <TradeMixChart data={tradeMix} />
                ) : (
                  <EmptyCategoryNote text="No trades in this range." />
                )}
              </div>
            </section>
          </div>

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
                            className="absolute inset-0 rounded-full bg-accent"
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
                            className="absolute inset-0 rounded-full bg-accent"
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
    </motion.div>
  );
}
