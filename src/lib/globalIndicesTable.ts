/**
 * The "Global indices" table at the top of the Watchlist's Global markets tab: ten headline indices, each with the last price,
 * the day's change, high, low, open and previous close. Pure - no network, no React.
 *
 * Two sources, because neither has all ten. GIFT Nifty (Nifty futures at NSE IX, trading 6:30 am to 2:45 am) and the Dow
 * futures come from Upstox - GIFT Nifty is on no free public feed, and Upstox's Dow futures is the one it quotes - and are
 * about a minute behind. The other eight come from Yahoo Finance, about 15 minutes behind. Splitting them also means the
 * eight keep working on the morning the daily Upstox token has lapsed.
 */

import { isSessionOpen, worldIndexDef, type WorldQuote } from "@/lib/worldIndices";
import { GIFT_NIFTY_KEY, type WatchlistItem, type WatchQuote } from "@/lib/watchlist";

export const DOW_FUTURES_KEY = "GLOBAL_INDEX|DOW FUTURES";

type UpstoxRow = { key: string; source: "upstox"; itemKey: string; name: string; code: string; country: string };
type YahooRow = { key: string; source: "yahoo"; id: string };

/** In the order the table shows them: India's own read first, then the US, then Asia, then Europe. */
export const GLOBAL_TOP_TABLE: readonly (UpstoxRow | YahooRow)[] = [
  { key: "gift", source: "upstox", itemKey: GIFT_NIFTY_KEY, name: "GIFT Nifty", code: "GN", country: "India (NSE IX, GIFT City)" },
  { key: "^DJI", source: "yahoo", id: "^DJI" },
  { key: "dow-futures", source: "upstox", itemKey: DOW_FUTURES_KEY, name: "Dow Futures", code: "US", country: "United States" },
  { key: "^GSPC", source: "yahoo", id: "^GSPC" },
  { key: "^N225", source: "yahoo", id: "^N225" },
  { key: "^HSI", source: "yahoo", id: "^HSI" },
  { key: "^GDAXI", source: "yahoo", id: "^GDAXI" },
  { key: "^FCHI", source: "yahoo", id: "^FCHI" },
  { key: "^KS11", source: "yahoo", id: "^KS11" },
  { key: "^FTSE", source: "yahoo", id: "^FTSE" },
];

/** The Yahoo indices the table shows - the only ones the Watchlist page asks the feed for. */
export const GLOBAL_TOP_YAHOO_IDS: ReadonlySet<string> = new Set(GLOBAL_TOP_TABLE.flatMap((row) => (row.source === "yahoo" ? [row.id] : [])));

/** The Upstox instruments behind the table, shaped as the Watchlist's quote hook wants them (kept as a constant so the poll isn't restarted on every render). */
export const GLOBAL_TOP_UPSTOX_ITEMS: WatchlistItem[] = GLOBAL_TOP_TABLE.flatMap((row, i) =>
  row.source === "upstox" ? [{ id: `global-top-${row.key}`, kind: "index" as const, itemKey: row.itemKey, symbol: row.key === "gift" ? "GIFTNIFTY" : "DOWFUTURES", name: row.name, sortOrder: i + 1 }] : [],
);

export type GlobalTopRow = {
  key: string;
  name: string;
  /** A two-letter mark for the tile: the country, or GN for GIFT Nifty. */
  code: string;
  country: string;
  source: "upstox" | "yahoo";
  /** Null while there is no price for it. */
  price: number | null;
  previousClose: number | null;
  /** The move since the previous close, in points and in percent (null without a previous close). */
  change: number | null;
  changePct: number | null;
  high: number | null;
  low: number | null;
  open: number | null;
  /** When it last traded (ms since epoch). */
  asOf: number | null;
  /** Trading as of the reference time; null without a price. */
  live: boolean | null;
};

const EMPTY = { price: null, previousClose: null, change: null, changePct: null, high: null, low: null, open: null, asOf: null, live: null } as const;

/**
 * The table's rows in order, each filled from its own source and left empty (dashes on the page) while that source has nothing
 * for it. `nowMs` is the moment the prices were fetched, so "open" is judged against that, not the clock.
 */
export function buildGlobalTopRows(
  world: Readonly<Record<string, WorldQuote | undefined>>,
  upstox: Readonly<Record<string, WatchQuote | undefined>>,
  nowMs: number,
): GlobalTopRow[] {
  return GLOBAL_TOP_TABLE.map((row): GlobalTopRow => {
    if (row.source === "upstox") {
      const base = { key: row.key, name: row.name, code: row.code, country: row.country, source: "upstox" as const };
      const q = upstox[row.itemKey];
      if (!q) return { ...base, ...EMPTY };
      const live = q.asOf != null ? isSessionOpen({ asOf: q.asOf, sessionStart: null, sessionEnd: null }, {}, nowMs) : null;
      return {
        ...base,
        price: q.price,
        previousClose: q.prevClose,
        change: q.change,
        changePct: q.changePct,
        high: q.high,
        low: q.low,
        open: q.open,
        asOf: q.asOf ?? null,
        live,
      };
    }

    const def = worldIndexDef(row.id);
    const base = { key: row.key, name: def?.name ?? row.id, code: def?.code ?? "", country: def?.country ?? "", source: "yahoo" as const };
    const q = world[row.id];
    if (!q) return { ...base, ...EMPTY };
    const change = q.previousClose === null ? null : q.price - q.previousClose;
    return {
      ...base,
      price: q.price,
      previousClose: q.previousClose,
      change,
      changePct: change === null || q.previousClose === null ? null : (change / q.previousClose) * 100,
      high: q.dayHigh,
      low: q.dayLow,
      open: q.open ?? null,
      asOf: q.asOf,
      live: def ? isSessionOpen(q, def, nowMs) : null,
    };
  });
}
