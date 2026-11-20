/**
 * The ticker across the top of every page: which prices it shows, in what order, and how it moves. Pure - no React, no network.
 *
 * What can be shown is one catalogue: the prices the strip has always carried (WTI, Brent, USD/INR, WTI in ₹, natural gas, gold),
 * Nifty 50, Bank Nifty, Sensex, GIFT Nifty and the Dow futures (from Upstox), and every world index (from Yahoo Finance). The choice - the ids in order, whether
 * the ticker loops, how fast - is a per-device convenience kept in localStorage like the insight-tab switches; it never goes to
 * Supabase, so there is nothing to migrate.
 */

import { DOW_FUTURES_KEY } from "@/lib/globalIndicesTable";
import { buildStrip } from "@/lib/globalMarkets";
import { WORLD_INDICES, WORLD_REGIONS, type WorldRegion } from "@/lib/worldIndices";
import { GIFT_NIFTY_KEY, INDEX_SEEDS } from "@/lib/watchlist";

/** Which feed a price comes from - each is polled only while something of it is ticked. */
export type TickerSource = "markets" | "upstox" | "world";
export type TickerSectionId = "india" | "prices" | "futures" | WorldRegion;

export type TickerItemDef = {
  id: string;
  /** Short enough for a tile. */
  label: string;
  /** The full name, for the tooltip and the editor. */
  title: string;
  section: TickerSectionId;
  source: TickerSource;
};

/** The editor's groups, in the order they are listed. */
export const TICKER_SECTIONS: readonly { id: TickerSectionId; label: string }[] = [
  { id: "india", label: "Indian indices" },
  { id: "futures", label: "GIFT Nifty & futures" },
  { id: "prices", label: "Commodities & rupee" },
  ...WORLD_REGIONS,
];

export const GIFT_TICKER_ID = "gift";
export const DOW_FUTURES_TICKER_ID = "dow-futures";

export const NIFTY_TICKER_ID = "nifty";
export const BANK_NIFTY_TICKER_ID = "banknifty";
export const SENSEX_TICKER_ID = "sensex";

type UpstoxTicker = { id: string; itemKey: string; symbol: string; name: string; title: string; section: "india" | "futures" };

/**
 * The Upstox-fed prices: the ticker id, and the instrument key the quote hook is asked for. The three Indian indices are the
 * Watchlist's own first three rows (one source of truth for their keys); GIFT Nifty and the Dow futures are Upstox's global indices.
 */
export const TICKER_UPSTOX: readonly UpstoxTicker[] = [
  ...INDEX_SEEDS.map((seed): UpstoxTicker => ({
    id: seed.symbol.toLowerCase(),
    itemKey: seed.itemKey,
    symbol: seed.symbol,
    name: seed.name,
    title: `${seed.name} · ${seed.itemKey.startsWith("BSE") ? "BSE" : "NSE"}`,
    section: "india",
  })),
  {
    id: GIFT_TICKER_ID,
    itemKey: GIFT_NIFTY_KEY,
    symbol: "GIFTNIFTY",
    name: "GIFT Nifty",
    title: "GIFT Nifty - Nifty futures at NSE IX in GIFT City, trading 6:30 am to 2:45 am",
    section: "futures",
  },
  { id: DOW_FUTURES_TICKER_ID, itemKey: DOW_FUTURES_KEY, symbol: "DOWFUTURES", name: "Dow Futures", title: "Dow Jones futures", section: "futures" },
];

/** Every price the ticker can show, grouped as the editor lists them. */
export const TICKER_ITEMS: readonly TickerItemDef[] = [
  // The strip's own order (WTI in ₹ sits right after the rupee rate it is built from).
  ...buildStrip({}).map((item): TickerItemDef => ({ id: item.key, label: item.label, title: item.title, section: "prices", source: "markets" })),
  ...TICKER_UPSTOX.map((item): TickerItemDef => ({ id: item.id, label: item.name, title: item.title, section: item.section, source: "upstox" })),
  ...WORLD_INDICES.map((index): TickerItemDef => ({ id: index.id, label: index.name, title: `${index.name} · ${index.country}`, section: index.region, source: "world" })),
];

const BY_ID = new Map<string, TickerItemDef>(TICKER_ITEMS.map((item) => [item.id, item]));

export function tickerItemDef(id: string): TickerItemDef | undefined {
  return BY_ID.get(id);
}

/** The catalogue split into the editor's groups (all of them non-empty). */
export function tickerSections(): { id: TickerSectionId; label: string; items: TickerItemDef[] }[] {
  return TICKER_SECTIONS.map(({ id, label }) => ({ id, label, items: TICKER_ITEMS.filter((item) => item.section === id) }));
}

/** Pixels per second the ticker slides at. */
export const TICKER_SPEED_MIN = 20;
export const TICKER_SPEED_MAX = 140;
export const TICKER_SPEED_STEP = 5;
export const TICKER_SPEED_DEFAULT = 50;

export type TickerPrefs = {
  /** What is shown, left to right. */
  ids: readonly string[];
  /** Slides endlessly (when there is more than fits) rather than sitting still for the reader to scroll. */
  loop: boolean;
  speed: number;
};

/** What a first visit shows: the indices that tell India how the world opened, and the prices the strip has always carried. */
export const DEFAULT_TICKER_IDS: readonly string[] = [
  GIFT_TICKER_ID,
  "^DJI",
  "^GSPC",
  "^IXIC",
  "^N225",
  "^HSI",
  "^GDAXI",
  "^FTSE",
  "WTI",
  "BRENT",
  "USDINR",
  "WTI_INR",
  "NATGAS",
  "GOLD",
];

export const DEFAULT_TICKER_PREFS: TickerPrefs = { ids: DEFAULT_TICKER_IDS, loop: true, speed: TICKER_SPEED_DEFAULT };

export function clampSpeed(value: number): number {
  return Math.min(TICKER_SPEED_MAX, Math.max(TICKER_SPEED_MIN, Math.round(value)));
}

/**
 * Reads what was saved. Anything missing or unreadable falls back to the default; ids this version doesn't know (an index that
 * was dropped from the list since) and repeats are left out. An empty list is a real choice - everything unticked - and is kept.
 */
export function parseTickerPrefs(raw: string | null | undefined): TickerPrefs {
  if (!raw) return DEFAULT_TICKER_PREFS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return DEFAULT_TICKER_PREFS;
    const { ids, loop, speed } = value as Record<string, unknown>;
    const known = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && BY_ID.has(id)) : null;
    return {
      ids: known ? [...new Set(known)] : DEFAULT_TICKER_IDS,
      loop: loop !== false,
      speed: typeof speed === "number" && Number.isFinite(speed) ? clampSpeed(speed) : TICKER_SPEED_DEFAULT,
    };
  } catch {
    return DEFAULT_TICKER_PREFS;
  }
}

export function serializeTickerPrefs(prefs: TickerPrefs): string {
  return JSON.stringify({ ids: prefs.ids, loop: prefs.loop, speed: prefs.speed });
}

/** Ticks or unticks a price. A newly ticked one goes to the end; an id that isn't in the catalogue changes nothing. */
export function toggleTickerItem(prefs: TickerPrefs, id: string): TickerPrefs {
  if (!BY_ID.has(id)) return prefs;
  return { ...prefs, ids: prefs.ids.includes(id) ? prefs.ids.filter((x) => x !== id) : [...prefs.ids, id] };
}

/** Moves a shown price to `toIndex` (clamped to the list), the others keeping their order. */
export function moveTickerItem(prefs: TickerPrefs, id: string, toIndex: number): TickerPrefs {
  const from = prefs.ids.indexOf(id);
  if (from === -1) return prefs;
  const to = Math.min(prefs.ids.length - 1, Math.max(0, toIndex));
  if (to === from) return prefs;
  const ids = [...prefs.ids];
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  return { ...prefs, ids };
}

/** Whether the choice is the one a first visit gets - the editor's Reset has nothing to do then. */
export function isDefaultTickerPrefs(prefs: TickerPrefs): boolean {
  return prefs.loop === DEFAULT_TICKER_PREFS.loop && prefs.speed === DEFAULT_TICKER_PREFS.speed && prefs.ids.length === DEFAULT_TICKER_IDS.length && prefs.ids.every((id, i) => id === DEFAULT_TICKER_IDS[i]);
}

export type TickerNeeds = {
  /** Any of the strip's own prices is ticked (the app-wide poll already covers them). */
  markets: boolean;
  /** The Yahoo indices ticked - the only ones asked of the server. */
  world: string[];
  /** The Upstox instruments ticked. */
  upstox: typeof TICKER_UPSTOX;
};

/** Which feeds the ticked prices need, so a feed nobody ticked is never polled. */
export function tickerNeeds(ids: readonly string[]): TickerNeeds {
  const wanted = new Set(ids);
  return {
    markets: ids.some((id) => BY_ID.get(id)?.source === "markets"),
    world: ids.filter((id) => BY_ID.get(id)?.source === "world"),
    upstox: TICKER_UPSTOX.filter((item) => wanted.has(item.id)),
  };
}

/** How long one trip of the loop takes (seconds) for a row `contentPx` wide at `speed` pixels a second. Never so short it blurs. */
export function tickerLoopSeconds(contentPx: number, speed: number): number {
  const pxPerSecond = Math.max(1, speed);
  return Math.max(8, contentPx / pxPerSecond);
}
