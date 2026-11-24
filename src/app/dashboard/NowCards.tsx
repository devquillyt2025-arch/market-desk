"use client";

/** What is happening: the indices and their breadth, the commodities, the world, and the open positions. Figures only - every card is a way into its tab. */

import Link from "next/link";

import { DIRECTION, MoveArrow } from "@/app/commodities/direction";
import { byMoveDescending, CATEGORIES, CATEGORY_LABELS, moveIntensity, summarize, type BoardEntry } from "@/lib/commodityBoard";
import { moversOf, type Breadth, type PositionLine } from "@/lib/dashboardBrief";
import { formatCompactINR, formatINR, formatLevel } from "@/lib/format";
import { commodityName } from "@/lib/mcxCommodities";
import { formatMovePct, moveDirection, type WatchQuote } from "@/lib/watchlist";

import { Card, Money, Move, NA, RangeBar, Skeleton, SplitBar, Stat } from "./parts";

// --- Indices and breadth ----------------------------------------------------------------

export type IndexRow = { key: string; name: string; quote: WatchQuote | undefined };

function BreadthBlock({ breadth }: { breadth: Breadth | null }) {
  return (
    <Link href="/heatmap" className="-mx-2 block rounded-lg px-2 py-2 transition-colors hover:bg-muted/60">
      {breadth === null ? (
        <span className="block py-3 text-center text-base font-semibold">
          <NA />
        </span>
      ) : (
        <>
          <span className="flex items-center justify-between text-base font-semibold tabular-nums">
            <span className="inline-flex items-center gap-1.5 text-profit">
              <MoveArrow direction="up" className="size-2" />
              {breadth.up}
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">Nifty 50</span>
            <span className="inline-flex items-center gap-1.5 text-danger-fg">
              {breadth.down}
              <MoveArrow direction="down" className="size-2" />
            </span>
          </span>
          <span className="mt-1.5 block">
            <SplitBar up={breadth.up} flat={breadth.flat} down={breadth.down} />
          </span>
          <span className="mt-1.5 flex items-center justify-between gap-3 text-[11px] tabular-nums text-muted-foreground">
            <span className="min-w-0 truncate">
              {breadth.leaders[0] ? (
                <>
                  {breadth.leaders[0].symbol} <Move pct={breadth.leaders[0].changePct} />
                </>
              ) : (
                <NA />
              )}
            </span>
            <span className="min-w-0 truncate text-right">
              {breadth.laggards[0] ? (
                <>
                  {breadth.laggards[0].symbol} <Move pct={breadth.laggards[0].changePct} />
                </>
              ) : (
                <NA />
              )}
            </span>
          </span>
        </>
      )}
    </Link>
  );
}

export function IndicesCard({ rows, breadth, index }: { rows: readonly IndexRow[]; breadth: Breadth | null; index: number }) {
  return (
    <Card title="Indices" href="/watchlist" index={index}>
      <ul className="-mt-1 flex flex-col">
        {rows.map(({ key, name, quote }) => (
          <li key={key}>
            <Link href="/watchlist" className="-mx-2 block rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60">
              <span className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs text-muted-foreground">{name}</span>
                <span className="text-sm font-semibold tabular-nums">{quote ? formatLevel(quote.price) : <NA />}</span>
              </span>
              <span className="mt-1.5 flex items-center gap-3">
                {quote ? <RangeBar quote={quote} /> : <span aria-hidden="true" className="block h-1 flex-1 rounded-full bg-muted" />}
                <Move pct={quote?.changePct} className="w-14 shrink-0 text-right text-xs" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-auto border-t border-border/70 pt-1">
        <BreadthBlock breadth={breadth} />
      </div>
    </Card>
  );
}

// --- Commodities ------------------------------------------------------------------------

function Count({ n, direction }: { n: number | null; direction: "up" | "down" | "flat" }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-2xl font-semibold leading-none tabular-nums ${DIRECTION[direction].text}`}>
      <MoveArrow direction={direction} className="size-2.5" />
      {n === null ? "—" : n}
    </span>
  );
}

function Mover({ entry }: { entry: BoardEntry }) {
  return (
    <li className="flex items-baseline justify-between gap-3 text-xs">
      <span className="min-w-0 truncate text-muted-foreground">{commodityName(entry.symbol)}</span>
      <Move pct={entry.quote?.changePct} />
    </li>
  );
}

export function CommoditiesCard({ entries, index }: { entries: readonly BoardEntry[]; index: number }) {
  const all = summarize(entries, "all");
  const { up, down } = moversOf(entries, 3);
  const ordered = byMoveDescending(entries);
  const maxAbs = ordered.reduce((max, { quote }) => Math.max(max, Math.abs(quote?.changePct ?? 0)), 0);
  const quoted = all.quoted > 0;

  return (
    <Card title="Commodities" href="/commodities" index={index} meta={all.avgPct === null ? undefined : <Move pct={all.avgPct} className="text-sm" />}>
      <div className="flex items-end justify-between gap-2">
        <Count n={quoted ? all.up : null} direction="up" />
        <Count n={quoted ? all.down : null} direction="down" />
        <Count n={quoted ? all.flat : null} direction="flat" />
      </div>
      <Link href="/commodities" aria-label="Every contract, from the biggest riser to the biggest faller" className="flex gap-[3px]">
        {ordered.map(({ symbol, quote }) => {
          const direction = moveDirection(quote?.changePct ?? null);
          const tint = direction === "up" ? "var(--profit)" : "var(--danger-fg)";
          return (
            <span
              key={symbol}
              title={`${commodityName(symbol)}  ${quote?.changePct != null ? formatMovePct(quote.changePct) : "no quote"}`}
              className={`h-7 min-w-0 flex-1 rounded-[4px] transition-colors duration-500 ${quote ? "" : "border border-dashed border-border-strong"}`}
              style={{ backgroundColor: direction === "flat" ? "var(--muted)" : `color-mix(in srgb, ${tint} ${Math.round(moveIntensity(quote?.changePct ?? null, maxAbs) * 100)}%, var(--muted))` }}
            />
          );
        })}
      </Link>
      <dl className="grid grid-cols-3 gap-2">
        {CATEGORIES.map((category) => (
          <Stat key={category} label={CATEGORY_LABELS[category].split(" ")[0]}>
            <Move pct={summarize(entries, category).avgPct} className="text-xs" />
          </Stat>
        ))}
      </dl>
      <ul className="mt-auto flex flex-col gap-1.5 border-t border-border/70 pt-3">
        {up.map((entry) => (
          <Mover key={entry.symbol} entry={entry} />
        ))}
        {down.map((entry) => (
          <Mover key={entry.symbol} entry={entry} />
        ))}
      </ul>
    </Card>
  );
}

// --- World ------------------------------------------------------------------------------

export type WorldTile = {
  key: string;
  label: string;
  /** The full name and the exact level, for the tooltip. */
  title: string;
  level: string;
  pct: number | null;
  /** Its market is trading now. */
  open: boolean;
};

export function WorldCard({ tiles, index }: { tiles: readonly WorldTile[]; index: number }) {
  const maxAbs = tiles.reduce((max, t) => Math.max(max, Math.abs(t.pct ?? 0)), 0);
  return (
    <Card title="World" href="/watchlist" index={index}>
      <ul className="grid grid-cols-3 gap-1.5">
        {tiles.map((tile) => {
          const direction = moveDirection(tile.pct);
          const tint = direction === "up" ? "var(--profit)" : "var(--danger-fg)";
          const strength = direction === "flat" ? 0 : Math.round(moveIntensity(tile.pct, maxAbs) * 22);
          return (
            <li key={tile.key} title={tile.title} className="relative flex min-w-0 flex-col gap-0.5 rounded-lg px-1.5 py-2" style={{ backgroundColor: `color-mix(in srgb, ${tint} ${strength}%, var(--muted))` }}>
              {tile.open && <span role="img" aria-label="trading now" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-profit" />}
              <span className="truncate text-[10.5px] text-muted-foreground">{tile.label}</span>
              <Move pct={tile.pct} className="text-[13px] font-semibold" />
              <span className="truncate text-[10.5px] tabular-nums text-muted-foreground">{tile.level}</span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// --- Positions --------------------------------------------------------------------------

const SHOWN_POSITIONS = 4;

export function PositionsCard({ lines, margin, exposure, loaded, index }: { lines: readonly PositionLine[] | null; margin: number | null; exposure: number | null; loaded: boolean; index: number }) {
  const shown = (lines ?? []).slice(0, SHOWN_POSITIONS);
  const more = (lines?.length ?? 0) - shown.length;
  return (
    <Card title="Positions" href="/portfolio" index={index} meta={lines === null ? undefined : lines.length}>
      {lines === null ? (
        <>
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </>
      ) : lines.length === 0 ? (
        <span className="text-2xl font-semibold text-muted-foreground">0</span>
      ) : (
        <ul className="-mt-1 flex flex-col">
          {shown.map((line) => (
            <li key={line.id}>
              <Link href="/portfolio" className="-mx-2 block min-h-11 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/60">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-[13px] font-medium">{line.label}</span>
                  <Money value={line.pnl} className="shrink-0 text-[13px] font-semibold" />
                </span>
                <span className="mt-0.5 flex items-baseline justify-between gap-3 text-[11px] tabular-nums text-muted-foreground">
                  <span>
                    {line.side === "sell" ? "Sell" : "Buy"} · {line.lots}
                  </span>
                  <span className="truncate">
                    {formatLevel(line.entry)} → {line.live === null ? "—" : formatLevel(line.live)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
          {more > 0 && <li className="px-0 pt-1 text-[11px] tabular-nums text-muted-foreground">+{more}</li>}
        </ul>
      )}
      <dl className="mt-auto grid grid-cols-2 gap-3 border-t border-border/70 pt-3">
        <Stat label="Margin">{margin !== null ? formatINR(margin) : loaded ? <NA /> : <Skeleton className="h-4 w-16" />}</Stat>
        <Stat label="Exposure" title="Lots x lot size x the price of what each position is written on">
          {exposure !== null && exposure > 0 ? `₹${formatCompactINR(exposure)}` : loaded ? <NA /> : <Skeleton className="h-4 w-16" />}
        </Stat>
      </dl>
    </Card>
  );
}
