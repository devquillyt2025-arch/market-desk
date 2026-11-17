/**
 * The Watchlist's logic, with no React and no fetching: what an item is, the starting list, reordering, and the
 * handful of numbers a row shows (the move, where the price sits in today's range, how the whole list is doing).
 * Kept apart from the page so each of those can be tested on its own.
 */

import { formatLevel } from "@/lib/format";
import { commodityGlyph, commodityUnit, contractMonthLabel, HEATMAP_COMMODITIES, commodityName } from "@/lib/mcxCommodities";

/** The Watchlist page's two halves: the saved list of Indian instruments, and the global prices MCX follows. */
export const WATCH_TABS = ["india", "global"] as const;
export type WatchTab = (typeof WATCH_TABS)[number];

/** A remembered tab read back from storage - or null if it is missing or isn't one of the two. */
export function parseWatchTab(raw: unknown): WatchTab | null {
  return (WATCH_TABS as readonly unknown[]).includes(raw) ? (raw as WatchTab) : null;
}

export const WATCHLIST_KINDS = ["index", "commodity", "equity"] as const;
export type WatchlistKind = (typeof WATCHLIST_KINDS)[number];

export const KIND_LABELS: Record<WatchlistKind, string> = {
  index: "Indices",
  commodity: "Commodities",
  equity: "Stocks",
};

export type WatchlistItem = {
  id: string;
  kind: WatchlistKind;
  /**
   * Stable identity, unique across the list. An index or stock: its Upstox instrument key. A commodity:
   * `MCX_COM|<symbol>` - never a contract key, because the contract changes every month (see commodityItemKey).
   */
  itemKey: string;
  /** Short display symbol: NIFTY, RELIANCE, CRUDEOIL. */
  symbol: string;
  name: string;
  /** Position in the list, ascending. */
  sortOrder: number;
};

/** An item before it has been saved - no id yet. */
export type WatchlistSeed = Omit<WatchlistItem, "id">;

/** The identity of a commodity on the list: the commodity itself, not whichever month's contract is current. */
export function commodityItemKey(symbol: string): string {
  return `MCX_COM|${symbol}`;
}

/**
 * GIFT Nifty - the Nifty 50 futures traded at NSE IX in GIFT City, from 6:30 am to 2:45 am, so it moves while the Indian
 * market is shut and is read as a hint of where Nifty will open. Upstox files it among its global indices, under the key
 * below (named after the SGX Nifty it replaced); it is quoted like any index, so it is kept on the list as one.
 */
export const GIFT_NIFTY_KEY = "GLOBAL_INDEX|SGX NIFTY";
export const GIFT_NIFTY: Omit<WatchlistSeed, "sortOrder"> = { kind: "index", itemKey: GIFT_NIFTY_KEY, symbol: "GIFTNIFTY", name: "GIFT Nifty" };

const INDEX_SEEDS: Omit<WatchlistSeed, "sortOrder">[] = [
  { kind: "index", itemKey: "NSE_INDEX|Nifty 50", symbol: "NIFTY", name: "Nifty 50" },
  { kind: "index", itemKey: "NSE_INDEX|Nifty Bank", symbol: "BANKNIFTY", name: "Bank Nifty" },
  { kind: "index", itemKey: "BSE_INDEX|SENSEX", symbol: "SENSEX", name: "Sensex" },
];

/**
 * What a fresh Watchlist holds: the three indices, then the Heatmap's commodities. The migration seeds the same
 * list into the database (a test keeps the two in step); this copy is also what shows, read-only, before that
 * migration has been run.
 */
export const DEFAULT_WATCHLIST: WatchlistSeed[] = [
  ...INDEX_SEEDS,
  ...HEATMAP_COMMODITIES.map((symbol) => ({ kind: "commodity" as const, itemKey: commodityItemKey(symbol), symbol, name: commodityName(symbol) })),
].map((seed, i) => ({ ...seed, sortOrder: i + 1 }));

/** One hit from the Add popup's search - everything needed to put it on the list. */
export type WatchSearchResult = {
  kind: WatchlistKind;
  itemKey: string;
  symbol: string;
  name: string;
  /** A short line saying what it is: "NSE index", "MCX Nov 2026 · ₹/bbl". */
  detail: string;
};

// --- Order -----------------------------------------------------------------------

/** A copy of `items` with the one at `from` moved to `to` (both clamped to the list). */
export function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  const out = [...items];
  if (out.length === 0 || from < 0 || from >= out.length) return out;
  const target = Math.min(Math.max(to, 0), out.length - 1);
  const [moved] = out.splice(from, 1);
  out.splice(target, 0, moved);
  return out;
}

/** The list renumbered 1…n by position. */
export function withSortOrder(items: readonly WatchlistItem[]): WatchlistItem[] {
  return items.map((item, i) => ({ ...item, sortOrder: i + 1 }));
}

/** Only the items whose position differs between two orderings of the same list - all a reorder has to write. */
export function changedPositions(before: readonly WatchlistItem[], after: readonly WatchlistItem[]): WatchlistItem[] {
  const was = new Map(before.map((item) => [item.id, item.sortOrder]));
  return after.filter((item) => was.get(item.id) !== item.sortOrder);
}

/** Where a newly added item goes: the end. */
export function nextSortOrder(items: readonly WatchlistItem[]): number {
  return items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 1;
}

export function hasItem(items: readonly WatchlistItem[], itemKey: string): boolean {
  return items.some((item) => item.itemKey === itemKey);
}

// --- What a quote says -----------------------------------------------------------

/** One instrument's live numbers, as /api/upstox/watchlist returns them (already reduced from Upstox's full quote). */
export type WatchQuote = {
  price: number;
  /** Yesterday's close - what today's move is measured from. */
  prevClose: number | null;
  change: number | null;
  changePct: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  /** A commodity: the contract month its price is for. */
  contract: { label: string; expiry: string } | null;
};

export type MoveDirection = "up" | "down" | "flat";

/** Up, down or flat - decided on the percentage as shown (to 2 decimals), so a -0.001% wobble isn't painted red. */
export function moveDirection(changePct: number | null): MoveDirection {
  if (changePct === null) return "flat";
  const shown = Math.round(changePct * 100) / 100;
  return shown > 0 ? "up" : shown < 0 ? "down" : "flat";
}

/** "+44.30" / "-48.00" / "0.00" - a signed move in the instrument's own units. */
export function formatMove(change: number): string {
  const text = formatLevel(Math.abs(change));
  return change > 0 ? `+${text}` : change < 0 ? `-${text}` : text;
}

/** "+0.18%" / "-0.60%" / "0.00%". */
export function formatMovePct(changePct: number): string {
  const shown = Math.round(changePct * 100) / 100;
  return `${shown > 0 ? "+" : ""}${shown.toFixed(2)}%`;
}

/** An index is a level in points; everything else is a price in rupees. */
export function formatPrice(kind: WatchlistKind, price: number): string {
  return kind === "index" ? formatLevel(price) : `₹${formatLevel(price)}`;
}

const rangeEnd = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
const rangeEndSmall = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });

/** One end of the day's range, kept short for a small label: whole numbers from 1,000 up (1,36,481), up to two decimals below (311.8). */
export function formatRangeValue(value: number): string {
  return (value >= 1000 ? rangeEnd : rangeEndSmall).format(value);
}

/** Where `price` sits between today's low and high, 0 (at the low) to 1 (at the high); null without a usable range. */
export function dayRangePosition(low: number | null, high: number | null, price: number): number | null {
  if (low === null || high === null || !(high > low)) return null;
  return Math.min(1, Math.max(0, (price - low) / (high - low)));
}

/** How many of the quoted items are up, down or flat today. */
export function marketBreadth(quotes: readonly (WatchQuote | undefined)[]): { up: number; down: number; flat: number; total: number } {
  const out = { up: 0, down: 0, flat: 0, total: 0 };
  for (const quote of quotes) {
    if (!quote) continue;
    out[moveDirection(quote.changePct)]++;
    out.total++;
  }
  return out;
}

// --- How an item is drawn --------------------------------------------------------

/** The three indices the app tracks have a short mark of their own - initials would make Nifty 50 "N5". */
const INDEX_MARKS: Record<string, string> = { NIFTY: "N50", BANKNIFTY: "BN", SENSEX: "SX", GIFTNIFTY: "GN" };

/** Two or three characters for the tile: a commodity's glyph (Au, CL), an index's mark (N50, BN, SX), otherwise the initials of its name. */
export function itemGlyph(item: Pick<WatchlistItem, "kind" | "symbol" | "name">): string {
  if (item.kind === "commodity") return commodityGlyph(item.symbol);
  if (item.kind === "index" && INDEX_MARKS[item.symbol]) return INDEX_MARKS[item.symbol];
  const words = item.name.trim().split(/[\s\-_/&.]+/).filter(Boolean);
  if (words.length === 0) return item.symbol.slice(0, 2).toUpperCase();
  const letters = words.length === 1 ? Array.from(words[0]).slice(0, 2) : [Array.from(words[0])[0], Array.from(words[1])[0]];
  return letters.join("").toUpperCase();
}

/** The line under the name: what it is, and for a commodity which month's contract and what the price is per. */
export function itemDetail(item: Pick<WatchlistItem, "kind" | "itemKey" | "symbol">, quote?: Pick<WatchQuote, "contract">): string {
  if (item.kind === "commodity") {
    const month = quote?.contract ? contractMonthLabel(quote.contract.expiry) : "MCX";
    const unit = commodityUnit(item.symbol);
    return [month === "MCX" ? "MCX" : `MCX ${month}`, unit].filter(Boolean).join(" · ");
  }
  if (item.kind === "index") {
    if (item.itemKey === GIFT_NIFTY_KEY) return "NSE IX · GIFT City";
    return item.itemKey.startsWith("BSE_") ? "BSE index" : item.itemKey.startsWith("GLOBAL_") ? "Global index" : "NSE index";
  }
  return item.itemKey.startsWith("BSE_") ? "BSE" : "NSE";
}

// --- Sorting and filtering: a view of the list, never a change to it -------------

export const SORT_KEYS = ["name", "price", "change", "range"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export type SortDir = "asc" | "desc";
export type SortState = { key: SortKey; dir: SortDir };

/** The column headers' own words. */
export const SORT_LABELS: Record<SortKey, string> = { name: "Instrument", price: "Price", change: "Change today", range: "Day range" };

/** What the first click on a column gives: A to Z for names, biggest first for numbers. */
export const FIRST_SORT_DIR: Record<SortKey, SortDir> = { name: "asc", price: "desc", change: "desc", range: "desc" };

/**
 * What a click on a column header does: the first click sorts that column its natural way, the second reverses it, the
 * third lets go and the list goes back to your own order. A click on a different column starts that one over.
 */
export function nextSort(current: SortState | null, key: SortKey): SortState | null {
  if (!current || current.key !== key) return { key, dir: FIRST_SORT_DIR[key] };
  if (current.dir === FIRST_SORT_DIR[key]) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return null;
}

const SORT_PHRASES: Record<SortKey, Record<SortDir, string>> = {
  name: { asc: "A to Z", desc: "Z to A" },
  price: { asc: "lowest first", desc: "highest first" },
  change: { asc: "biggest losers first", desc: "biggest gainers first" },
  range: { asc: "nearest the day's low first", desc: "nearest the day's high first" },
};

/** "Change today, biggest gainers first" - for a status line or a screen reader. */
export function describeSort(sort: SortState): string {
  return `${SORT_LABELS[sort.key]}, ${SORT_PHRASES[sort.key][sort.dir]}`;
}

/** The number a row sorts on, or null when it has none (no quote yet, or no day range). Percentages are taken to 2 decimals, as shown, so a tie on screen is a tie here. */
function numericSortValue(quote: WatchQuote | undefined, key: Exclude<SortKey, "name">): number | null {
  if (!quote) return null;
  if (key === "price") return quote.price;
  if (key === "change") return quote.changePct === null ? null : Math.round(quote.changePct * 100) / 100;
  return dayRangePosition(quote.low, quote.high, quote.price);
}

/**
 * `items` in the sort's order - a new array; the list itself is never reordered. Ties keep their order in the list, so
 * equal rows don't shuffle on each refresh; a row with nothing to sort on goes last whichever way you sort, rather than
 * leading the list as a "lowest" value.
 */
export function sortItems<T extends WatchlistItem>(items: readonly T[], quotes: Readonly<Record<string, WatchQuote | undefined>>, sort: SortState | null): T[] {
  if (!sort) return [...items];
  const sign = sort.dir === "asc" ? 1 : -1;
  const decorated = items.map((item, index) => ({ item, index, value: sort.key === "name" ? null : numericSortValue(quotes[item.itemKey], sort.key) }));

  decorated.sort((a, b) => {
    if (sort.key === "name") {
      return sign * a.item.name.localeCompare(b.item.name, "en", { sensitivity: "base", numeric: true }) || a.index - b.index;
    }
    if (a.value === null || b.value === null) return a.value === b.value ? a.index - b.index : a.value === null ? 1 : -1;
    return sign * (a.value - b.value) || a.index - b.index;
  });
  return decorated.map((d) => d.item);
}

export type Mover = "up" | "down";
export type ViewFilter = { text: string; mover: Mover | null };

/** Whether a row survives the text box and the gainers/losers chips. Words typed must each appear in the name or symbol; a row with no price can't be called a gainer or a loser. */
export function matchesView(item: Pick<WatchlistItem, "name" | "symbol">, quote: WatchQuote | undefined, filter: ViewFilter): boolean {
  const terms = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length > 0) {
    const haystack = `${item.name} ${item.symbol}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) return false;
  }
  if (filter.mover !== null) return quote !== undefined && moveDirection(quote.changePct) === filter.mover;
  return true;
}

/** A saved sort read back from storage - or null if it is missing or isn't one of the choices on offer. */
export function parseSort(raw: unknown): SortState | null {
  if (!raw || typeof raw !== "object") return null;
  const { key, dir } = raw as Record<string, unknown>;
  const validKey = (SORT_KEYS as readonly unknown[]).includes(key);
  return validKey && (dir === "asc" || dir === "desc") ? { key: key as SortKey, dir } : null;
}
