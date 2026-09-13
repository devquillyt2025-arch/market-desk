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

import { InboxIcon } from "@/components/icons";
import Select from "@/components/Select";
import {
  computeCumulativeSeries,
  computePnlByDayOfWeek,
  computePnlByInstrument,
  DATE_RANGE_LABELS,
  DATE_RANGES,
  filterEntriesByRange,
  summarizeEntries,
  type CategoryPnl,
  type CumulativePoint,
  type DateRange,
} from "@/lib/calculateReports";
import { formatINR, pnlColorClass } from "@/lib/format";
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

export default function ReportsView() {
  const [entries, setEntries] = useState<TradeEntry[] | null>(getCachedTradeEntries);
  const [range, setRange] = useState<DateRange>("30d");

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

  const filtered = useMemo(() => (entries ? filterEntriesByRange(entries, range) : null), [entries, range]);
  const summary = useMemo(() => (filtered ? summarizeEntries(filtered) : null), [filtered]);
  const cumulative = useMemo(() => (filtered ? computeCumulativeSeries(filtered) : null), [filtered]);
  const byInstrument = useMemo(() => (filtered ? computePnlByInstrument(filtered) : null), [filtered]);
  const byDayOfWeek = useMemo(() => (filtered ? computePnlByDayOfWeek(filtered) : null), [filtered]);

  const statTiles = summary
    ? [
        { label: "Total P&L", value: formatINR(summary.totalPnl), color: pnlColorClass(summary.totalPnl) },
        { label: "Win Rate", value: `${summary.winRatePct.toFixed(0)}%`, color: "" },
        { label: "Total Trades", value: String(summary.totalTrades), color: "" },
        { label: "Avg P&L / Trade", value: formatINR(summary.avgPnl), color: pnlColorClass(summary.avgPnl) },
      ]
    : null;

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
            Full analysis of your Trade Entries — P&amp;L trend, by instrument, and by day.
          </p>
        </div>
        <div className="w-28">
          <Select value={range} onChange={setRange} options={RANGE_OPTIONS} align="right" />
        </div>
      </div>

      {entries === null ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : filtered && filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No trade entries in this range. Log some in Trade Entries to see reports here.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {statTiles?.map((stat) => (
              <section key={stat.label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums ${stat.color}`}>{stat.value}</dd>
              </section>
            ))}
          </div>

          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
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
                    activeDot={{ r: 4, fill: "var(--accent)", stroke: "var(--card)", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          <div className="grid gap-6 lg:grid-cols-2">
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <h2 className="text-sm font-medium">P&amp;L by Instrument</h2>
              <div className="mt-2">
                <CategoryPnlChart data={byInstrument ?? []} />
              </div>
            </section>

            <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <h2 className="text-sm font-medium">P&amp;L by Day of Week</h2>
              <div className="mt-2">
                <CategoryPnlChart data={byDayOfWeek ?? []} />
              </div>
            </section>
          </div>

          {summary && (
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
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
