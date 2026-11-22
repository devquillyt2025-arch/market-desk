/**
 * What the Commodities page works out from the quotes, with no React and no fetching: which sector a contract belongs to,
 * how the board is doing as a whole, the sorted order, the small live trace, and the day-range gauge. Kept apart from the
 * page so each can be tested on its own.
 *
 * The contract list is the app's own MCX commodity list (COMMODITY_INSTRUMENTS); the quote for each comes keyed the way the
 * Watchlist keys a commodity (commodityItemKey), because the contract month behind it changes every month.
 */

import { isMarketOpen } from "@/lib/averaging";
import {
  COMMODITY_INSTRUMENTS,
  DEFAULT_LOT_SIZES,
  mcxSessionCloseIst,
  underlyingFamily,
  type CommodityInstrument,
  type UnderlyingFamily,
} from "@/lib/types";
import { commodityItemKey, dayRangePosition, moveDirection, type MoveDirection, type WatchQuote } from "@/lib/watchlist";

// --- Sectors ----------------------------------------------------------------------

export type CommodityCategory = "energy" | "precious" | "base";

export const CATEGORIES: readonly CommodityCategory[] = ["energy", "precious", "base"];

export const CATEGORY_LABELS: Record<CommodityCategory, string> = {
  energy: "Energy",
  precious: "Precious metals",
  base: "Base metals",
};

const FAMILY_CATEGORY: Record<UnderlyingFamily, CommodityCategory> = {
  index: "base", // never a commodity here; keeps the table total
  crude: "energy",
  natgas: "energy",
  power: "energy",
  gold: "precious",
  silver: "precious",
  copper: "base",
  zinc: "base",
  aluminium: "base",
};

/** Every contract the page shows, in the order a trader reads them: energy, then precious metals, then base metals. */
export const BOARD_SYMBOLS: readonly CommodityInstrument[] = COMMODITY_INSTRUMENTS;

export function commodityCategory(symbol: CommodityInstrument): CommodityCategory {
  return FAMILY_CATEGORY[underlyingFamily(symbol)];
}

// --- Look: the metal each tile is struck from -----------------------------------------

/** What a commodity's tile is painted with: a brushed-metal surface, the ink that reads on it, and the glow it casts. */
export type MetalTone = {
  /** A CSS `background` value (a gradient). */
  surface: string;
  ink: string;
  /** A solid colour, used at low strength for the halo behind the card. */
  glow: string;
};

const TONES: Record<UnderlyingFamily, MetalTone> = {
  index: { surface: "linear-gradient(145deg, #c4b5fd, #6a5cf0)", ink: "#120d33", glow: "#9185ff" },
  crude: { surface: "linear-gradient(145deg, #57534e, #1c1917 70%)", ink: "#fbbf24", glow: "#d97706" },
  natgas: { surface: "linear-gradient(145deg, #bae6fd, #38bdf8 50%, #0369a1)", ink: "#04243a", glow: "#38bdf8" },
  power: { surface: "linear-gradient(145deg, #ddd6fe, #8b7cf6 55%, #5b45d6)", ink: "#110c2e", glow: "#9185ff" },
  gold: { surface: "linear-gradient(145deg, #fbe7a1, #e0b040 52%, #a9770f)", ink: "#2b1d03", glow: "#e0b040" },
  silver: { surface: "linear-gradient(145deg, #f8fafc, #b6c0cd 52%, #8190a3)", ink: "#0f172a", glow: "#cbd5e1" },
  copper: { surface: "linear-gradient(145deg, #f8c39b, #cc7a45 52%, #8f4a22)", ink: "#2b1204", glow: "#d9824a" },
  zinc: { surface: "linear-gradient(145deg, #cbd8e8, #8aa0bd 52%, #566b87)", ink: "#0b1220", glow: "#8aa0bd" },
  aluminium: { surface: "linear-gradient(145deg, #e3eef2, #9bbccb 52%, #5f8294)", ink: "#07161c", glow: "#7fb0c2" },
};

export function commodityTone(symbol: CommodityInstrument): MetalTone {
  return TONES[underlyingFamily(symbol)];
}

// --- The lot ---------------------------------------------------------------------------

/** What one lot is, in the exchange's own words. Left out where the app isn't sure (electricity) rather than guessed. */
const CONTRACT_SIZE: Partial<Record<CommodityInstrument, string>> = {
  CRUDEOIL: "100 bbl",
  CRUDEOILM: "10 bbl",
  NATURALGAS: "1,250 mmBtu",
  NATGASMINI: "250 mmBtu",
  GOLD: "1 kg",
  GOLDM: "100 g",
  GOLDTEN: "10 g",
  GOLDGUINEA: "8 g",
  GOLDPETAL: "1 g",
  SILVER: "30 kg",
  SILVERM: "5 kg",
  SILVERMIC: "1 kg",
  SILVER100: "100 g",
  COPPER: "2,500 kg",
  ZINC: "5,000 kg",
  ZINCMINI: "1,000 kg",
  ALUMINIUM: "5,000 kg",
  ALUMINI: "1,000 kg",
};

export type LotFacts = {
  /** "1 kg", "100 bbl" - null where it isn't known. */
  contractSize: string | null;
  /** What a ₹1 move in the quoted price is worth, per lot (the same multiplier every P&L figure in the app uses). */
  perRupee: number;
  /** The lot at today's price: price × multiplier. */
  lotValue: number;
};

/**
 * The lot, from the app's own multipliers (DEFAULT_LOT_SIZES). Gold is quoted per 10 g but a lot is a kilogram, so its
 * multiplier is 100 - which is why the grams written on the contract can't simply be multiplied by the price.
 */
export function lotFacts(symbol: CommodityInstrument, price: number): LotFacts {
  const perRupee = DEFAULT_LOT_SIZES[symbol];
  return { contractSize: CONTRACT_SIZE[symbol] ?? null, perRupee, lotValue: price * perRupee };
}

// --- The board -------------------------------------------------------------------------

export type BoardEntry = { symbol: CommodityInstrument; quote: WatchQuote | undefined };

/** One entry per contract, in display order, each with its quote if one has arrived. */
export function buildBoard(quotes: Readonly<Record<string, WatchQuote>>): BoardEntry[] {
  return BOARD_SYMBOLS.map((symbol) => ({ symbol, quote: quotes[commodityItemKey(symbol)] ?? quotes[symbol] }));
}

export type BoardFilter = CommodityCategory | "all";

export type Summary = {
  /** How many contracts the group has, quoted or not. */
  count: number;
  /** How many of them have a quote. */
  quoted: number;
  up: number;
  down: number;
  flat: number;
  /** The mean of today's % moves across the quoted contracts, or null while none has arrived. */
  avgPct: number | null;
};

/** How a group of contracts - one sector, or all - is doing. */
export function summarize(entries: readonly BoardEntry[], filter: BoardFilter): Summary {
  const out: Summary = { count: 0, quoted: 0, up: 0, down: 0, flat: 0, avgPct: null };
  let sum = 0;
  let withPct = 0;
  for (const { symbol, quote } of entries) {
    if (filter !== "all" && commodityCategory(symbol) !== filter) continue;
    out.count++;
    if (!quote) continue;
    out.quoted++;
    out[moveDirection(quote.changePct)]++;
    if (quote.changePct !== null) {
      sum += quote.changePct;
      withPct++;
    }
  }
  if (withPct > 0) out.avgPct = sum / withPct;
  return out;
}

/** How far the average move must be from zero before the board "leans" one way: under this it is a flat market, whatever the sign of the rounding. */
export const MOOD_DEADBAND_PCT = 0.15;

/** Which way the board as a whole is leaning, for the hero's glow - flat until the average move is big enough to mean something. */
export function boardMood(avgPct: number | null): MoveDirection {
  if (avgPct === null || Math.abs(avgPct) < MOOD_DEADBAND_PCT) return "flat";
  return avgPct > 0 ? "up" : "down";
}

/** The biggest riser and the biggest faller today - only where the move is real (it isn't flat once rounded as shown). Ties go to the first listed, which is the full-size contract. */
export function topMovers(entries: readonly BoardEntry[]): { gainer: BoardEntry | null; loser: BoardEntry | null } {
  let gainer: BoardEntry | null = null;
  let loser: BoardEntry | null = null;
  for (const entry of entries) {
    const pct = entry.quote?.changePct ?? null;
    if (pct === null) continue;
    const direction = moveDirection(pct);
    if (direction === "up" && (gainer === null || pct > (gainer.quote?.changePct ?? -Infinity))) gainer = entry;
    if (direction === "down" && (loser === null || pct < (loser.quote?.changePct ?? Infinity))) loser = entry;
  }
  return { gainer, loser };
}

export type BoardSort = "default" | "gainers" | "losers";

export const SORT_LABELS: Record<BoardSort, string> = { default: "Default", gainers: "Gainers", losers: "Losers" };

/** The entries in the chosen order. Contracts with no move to rank (no quote yet) always go last; the rest keep their listed order on a tie. */
export function sortEntries(entries: readonly BoardEntry[], sort: BoardSort): BoardEntry[] {
  if (sort === "default") return [...entries];
  const sign = sort === "gainers" ? -1 : 1;
  return entries
    .map((entry, index) => ({ entry, index, pct: entry.quote?.changePct ?? null }))
    .sort((a, b) => {
      if (a.pct === null || b.pct === null) return a.pct === b.pct ? a.index - b.index : a.pct === null ? 1 : -1;
      return sign * (a.pct - b.pct) || a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/** The entries ordered from the biggest riser to the biggest faller, with the unquoted at the end - the order of the mosaic strip. */
export function byMoveDescending(entries: readonly BoardEntry[]): BoardEntry[] {
  return sortEntries(entries, "gainers");
}

/**
 * How strongly to colour a contract's mosaic cell, 0-1: its move against the largest move on the board, never below a
 * floor so a small but real move is still visibly coloured (and a flat one isn't).
 */
export function moveIntensity(changePct: number | null, maxAbsPct: number): number {
  if (changePct === null || moveDirection(changePct) === "flat") return 0;
  if (!(maxAbsPct > 0)) return 0.5;
  return Math.min(1, Math.max(0.28, Math.abs(changePct) / maxAbsPct));
}

// --- Market hours ---------------------------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Whether MCX is trading right now, and when tonight's session ends in IST ("23:30" in US summer, "23:55" in winter). */
export function mcxSessionStatus(nowMs: number): { open: boolean; closesAt: "23:30" | "23:55" } {
  const istDate = new Date(nowMs + IST_OFFSET_MS).toISOString().slice(0, 10);
  return { open: isMarketOpen(nowMs, "CRUDEOIL"), closesAt: mcxSessionCloseIst(istDate) };
}

// --- The live trace -------------------------------------------------------------------

/** How many ticks a contract's trace keeps: one every few seconds, so a few minutes. */
export const SPARK_MAX = 60;

/** The trace with one more price on the end, oldest dropped past `max`. */
export function pushTick(history: readonly number[] | undefined, price: number, max: number = SPARK_MAX): number[] {
  const next = history ? [...history, price] : [price];
  return next.length > max ? next.slice(next.length - max) : next;
}

export type SparkShape = {
  /** An SVG path for the line. */
  line: string;
  /** The same path closed down to the baseline, for the soft fill under it. */
  area: string;
  end: { x: number; y: number };
};

type Point = { x: number; y: number };

const fixed = (n: number) => n.toFixed(1);

/** A smooth curve through the points: each point is a control point, and the curve passes through the midpoints between them, so it never overshoots. */
function smoothPath(points: readonly Point[]): string {
  let d = `M${fixed(points[0].x)},${fixed(points[0].y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 };
    d += `Q${fixed(points[i].x)},${fixed(points[i].y)} ${fixed(mid.x)},${fixed(mid.y)}`;
  }
  const last = points[points.length - 1];
  return `${d}L${fixed(last.x)},${fixed(last.y)}`;
}

/**
 * The trace as SVG paths inside a `width` × `height` box, or null with fewer than two prices.
 *
 * The vertical scale never zooms in past `minSpan` (a fraction of the price): without that floor a one-tick wobble of
 * 0.01% is stretched to fill the box and reads like a crash. A flat trace sits in the middle as a flat line.
 */
export function sparkShape(prices: readonly number[], width: number, height: number, pad = 3, minSpan = 0.0012): SparkShape | null {
  if (prices.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const price of prices) {
    if (price < min) min = price;
    if (price > max) max = price;
  }
  const last = prices[prices.length - 1];
  const span = Math.max(max - min, Math.abs(last) * minSpan, 1e-9);
  const mid = (min + max) / 2;
  const bottom = mid - span / 2;
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const points = prices.map((price, i) => ({
    x: pad + (i / (prices.length - 1)) * innerW,
    y: pad + (1 - (price - bottom) / span) * innerH,
  }));
  const line = smoothPath(points);
  const end = points[points.length - 1];
  return { line, area: `${line}L${fixed(end.x)},${height}L${fixed(points[0].x)},${height}Z`, end };
}

// --- The day-range gauge -----------------------------------------------------------------

export type RangeGauge = {
  /** Where the price sits between today's low (0) and high (1). */
  price: number;
  /** Where yesterday's close sits, clamped to the range - the point today's move is measured from. Null when there's no previous close. */
  reference: number | null;
  direction: MoveDirection;
};

/** The gauge for a quote, or null without a usable low-high range. */
export function rangeGauge(quote: WatchQuote): RangeGauge | null {
  const price = dayRangePosition(quote.low, quote.high, quote.price);
  if (price === null) return null;
  const reference = quote.prevClose === null ? null : dayRangePosition(quote.low, quote.high, quote.prevClose);
  return { price, reference, direction: moveDirection(quote.changePct) };
}
