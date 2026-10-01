"use client";

import { motion } from "framer-motion";
import { useMemo, useState } from "react";

import LoadingState from "@/components/LoadingState";
import LivePricingBanners from "@/components/LivePricingBanners";
import { AlertCircleIcon, RefreshIcon } from "@/components/icons";
import { formatLevel, formatPct } from "@/lib/format";
import { HEATMAP_TABS, getHeatmapStocks, type HeatmapStock } from "@/lib/heatmap/constituents";
import {
  DEFAULT_HEATMAP_RANGE,
  HEATMAP_RANGES,
  RANGE_BANDS,
  RANGE_PHRASES,
  type HeatmapRange,
} from "@/lib/heatmap/ranges";
import type { Instrument } from "@/lib/types";
import type { HeatmapQuote, IndexQuote } from "@/lib/upstox/types";
import { HEATMAP_POLL_MS, useHeatmap } from "@/lib/useHeatmap";

/**
 * Tile and legend fills, sampled from the reference design. Deliberately
 * fixed colors, not the app's --profit/--loss tokens: white text sits on all
 * of them in both themes, and the soft / solid / deep three-step on each side
 * is what makes the grid scannable at a glance.
 */
const SHADES = {
  strongUp: "bg-[#027a2e]",
  up: "bg-[#119f57]",
  softUp: "bg-[#77bf8a]",
  flat: "bg-[#6b7080]",
  softDown: "bg-[#f5808b]",
  down: "bg-[#c91e2d]",
  strongDown: "bg-[#a11212]",
} as const;

type Band = (typeof RANGE_BANDS)[HeatmapRange];

/** Where the move lands on the scale — `band` says how big "solid" and "deep" are for the active range. */
function shadeFor(pct: number | null, { small, large }: Band): string {
  if (pct === null || pct === 0) return SHADES.flat;
  if (pct >= large) return SHADES.strongUp;
  if (pct >= small) return SHADES.up;
  if (pct > 0) return SHADES.softUp;
  if (pct > -small) return SHADES.softDown;
  if (pct > -large) return SHADES.down;
  return SHADES.strongDown;
}

/** The legend chips, top to bottom of the scale — built from the same bands the tiles use, so they can't disagree. */
function legendFor({ small, large }: Band): { shade: string; label: string }[] {
  return [
    { shade: SHADES.strongUp, label: `Above +${large}%` },
    { shade: SHADES.up, label: `+${large} to +${small}%` },
    { shade: SHADES.softUp, label: `+${small} to 0%` },
    { shade: SHADES.softDown, label: `0 to -${small}%` },
    { shade: SHADES.down, label: `-${small} to -${large}%` },
    { shade: SHADES.strongDown, label: `Below -${large}%` },
  ];
}

/** Whole-paisa price with trailing zeros dropped — ₹419, ₹316.2, ₹714.65. */
function formatPrice(price: number): string {
  return `₹${Number(price.toFixed(2))}`;
}

function pillClass(active: boolean, padding = "px-4"): string {
  return `rounded-lg ${padding} py-2 text-sm font-medium transition-colors active:scale-95 ${
    active ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
  }`;
}

/** Stock logos come from a third-party CDN keyed by NSE symbol; a few (new listings) are missing, so fall back to initials rather than a broken-image icon. */
function StockLogo({ symbol }: { symbol: string }) {
  const [failed, setFailed] = useState(false);

  return (
    <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white sm:size-10">
      {failed ? (
        <span className="text-xs font-bold text-[#292e3f]">{symbol.slice(0, 2)}</span>
      ) : (
        // Plain <img>: tiny third-party logos that need no optimization, and next/image would require whitelisting the CDN in next.config.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://images.dhan.co/symbol/${encodeURIComponent(symbol)}.png`}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
          className="size-full object-contain p-1"
        />
      )}
    </span>
  );
}

function StockTile({ stock, quote, band }: { stock: HeatmapStock; quote: HeatmapQuote; band: Band }) {
  // Rounded first so the color and the label agree — a -0.001% move reads
  // "0.00%", and shouldn't be painted red.
  const pct = quote.changePct === null ? null : Math.round(quote.changePct * 100) / 100;

  return (
    <div
      title={stock.name}
      className={`relative flex h-[92px] flex-col justify-between rounded-xl p-3 text-white shadow-md transition-colors duration-500 ${shadeFor(pct, band)}`}
    >
      <span className="self-end text-xl font-bold leading-none tabular-nums">
        {pct === null ? "—" : formatPct(pct, 2)}
      </span>
      <div className="flex min-w-0 items-center gap-2.5">
        <StockLogo symbol={stock.symbol} />
        <div className="min-w-0 leading-tight">
          <div className="w-fit max-w-full truncate text-sm font-semibold underline decoration-[#6b5fa0] decoration-2 underline-offset-4">
            {stock.symbol}
          </div>
          <div className="mt-1 text-sm tabular-nums">{formatPrice(quote.price)}</div>
        </div>
      </div>
    </div>
  );
}

/** Green/red text for a signed move, readable on both themes (the --loss token is tuned for fills and is too dim as text on dark). */
function moveTone(value: number): string {
  if (value > 0) return "text-profit";
  if (value < 0) return "text-danger-fg";
  return "text-muted-foreground";
}

function IndexCard({
  label,
  quote,
  rangeLabel,
  active,
}: {
  label: string;
  quote: IndexQuote | undefined;
  rangeLabel: HeatmapRange;
  active: boolean;
}) {
  const change = quote?.change ?? null;
  const changePct = quote?.changePct ?? null;

  // Two lines, and the second spans the card (level left, move right) — so the
  // box is filled edge to edge instead of leaving a dead column on the right.
  // The move drops under the level if a narrow card can't fit both.
  return (
    <section
      className={`rounded-xl border bg-background px-3.5 py-2.5 transition-colors ${
        active ? "border-accent/60" : "border-border"
      }`}
    >
      <div className="flex items-center gap-1.5">
        <h2 className="text-xs text-muted-foreground">{label}</h2>
        <span className="rounded bg-muted px-1.5 text-[10px] font-medium leading-4 text-muted-foreground">
          {rangeLabel}
        </span>
      </div>
      <div className="mt-0.5 flex flex-wrap items-baseline justify-between gap-x-3">
        <p className="font-mono text-lg font-semibold tabular-nums">{quote ? formatLevel(quote.price) : "—"}</p>
        <p className={`font-mono text-xs tabular-nums ${change === null ? "text-muted-foreground" : moveTone(change)}`}>
          {change === null || changePct === null
            ? "—"
            : `${change > 0 ? "+" : ""}${formatLevel(change)} (${formatPct(Math.round(changePct * 100) / 100, 2)})`}
        </p>
      </div>
    </section>
  );
}

export default function HeatmapView() {
  const [index, setIndex] = useState<Instrument>("NIFTY");
  const [range, setRange] = useState<HeatmapRange>(DEFAULT_HEATMAP_RANGE);
  const { quotes, indices, tokenExpired, offline, loadError, lastPolledAt, manualRefreshing, handleManualRefresh } =
    useHeatmap(index, range, HEATMAP_POLL_MS);
  const band = RANGE_BANDS[range];

  // Biggest gainers first, biggest losers last — the reading order the grid
  // is built around. A stock with no comparison price (e.g. not listed that
  // far back) can't be ranked, so it sinks to the end.
  const tiles = useMemo(() => {
    if (!quotes) return null;
    const quoteBySymbol = new Map(quotes.map((q) => [q.symbol, q]));
    return getHeatmapStocks(index)
      .flatMap((stock) => {
        const quote = quoteBySymbol.get(stock.symbol);
        return quote ? [{ stock, quote }] : [];
      })
      .sort(
        (a, b) =>
          (b.quote.changePct ?? -Infinity) - (a.quote.changePct ?? -Infinity) ||
          a.stock.symbol.localeCompare(b.stock.symbol),
      );
  }, [quotes, index]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Heatmap</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            How every stock in the index has moved {RANGE_PHRASES[range]} — prices refresh every {HEATMAP_POLL_MS / 1000}s.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {lastPolledAt && !tokenExpired && !offline && (
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              Updated {new Date(lastPolledAt).toLocaleTimeString("en-IN")}
            </span>
          )}
          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={manualRefreshing}
            aria-label="Refresh now"
            title="Refresh now"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
          >
            <RefreshIcon className={`size-4 ${manualRefreshing ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {HEATMAP_TABS.map((tab) => (
          <IndexCard
            key={tab.id}
            label={tab.label}
            quote={indices?.find((q) => q.instrument === tab.id)}
            rangeLabel={range}
            active={tab.id === index}
          />
        ))}
      </div>

      <LivePricingBanners tokenExpired={tokenExpired} offline={offline} />

      {loadError && !tokenExpired && !offline && (
        <div className="flex items-center gap-3 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-loss">
          <AlertCircleIcon className="size-4 shrink-0" />
          <span className="flex-1">Couldn&apos;t refresh prices — {loadError}. Retrying automatically.</span>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {HEATMAP_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setIndex(tab.id)}
                aria-pressed={tab.id === index}
                className={pillClass(tab.id === index)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          {/* Phone: eight equal columns so all periods fit on one row instead of orphaning the last one. */}
          <div
            className="grid w-full grid-cols-8 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:items-center sm:gap-2"
            role="group"
            aria-label="Period"
          >
            {HEATMAP_RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                aria-pressed={r === range}
                className={pillClass(r === range, "px-0 sm:px-3")}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        <ul aria-label="Color scale" className="mt-1 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {legendFor(band).map(({ shade, label }) => (
            <li
              key={label}
              className={`rounded-xl px-2 py-2 text-center text-xs font-medium text-white sm:text-sm ${shade}`}
            >
              {label}
            </li>
          ))}
        </ul>

        {tiles === null ? (
          tokenExpired || offline ? (
            <div className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
              Prices will appear here once live pricing is back.
            </div>
          ) : (
            <LoadingState className="h-64" label="Loading heatmap…" />
          )
        ) : tiles.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-background p-10 text-center text-sm text-muted-foreground">
            No prices came back for this index yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {tiles.map(({ stock, quote }) => (
              <StockTile key={stock.symbol} stock={stock} quote={quote} band={band} />
            ))}
          </div>
        )}

        {range !== "1D" && tiles && tiles.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Beyond a day, changes use Upstox&apos;s price history — adjusted for splits and bonuses, but not demergers,
            so a stock that demerged in this period will look weaker than it really was. Stocks listed more recently
            than the period show &ldquo;—&rdquo;.
          </p>
        )}
      </div>
    </motion.div>
  );
}
