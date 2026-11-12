/**
 * Server-side helpers behind /api/upstox/watchlist - pure, so they can be tested without a network.
 *
 * The client sends the list's instruments; this validates every one before it goes anywhere near an Upstox
 * URL (an instrument key is spliced into a query string), works out the key each is quoted under, and reduces
 * Upstox's full quote - depth, circuit limits and all - to the few numbers a row shows.
 */

import { contractMonthLabel } from "@/lib/mcxCommodities";
import { WATCHLIST_KINDS, type WatchlistKind, type WatchQuote } from "@/lib/watchlist";
import type { McxFuture } from "@/lib/upstox/mcx";

/** What the client names per instrument - not an Upstox key yet, for a commodity. */
export type WatchRequestItem = { itemKey: string; kind: WatchlistKind; symbol: string };

/** A watchlist is a handful of instruments; this stops a request from asking for hundreds. */
export const MAX_WATCH_ITEMS = 60;

/**
 * An Upstox index or equity key: `NSE_EQ|INE002A01018`, `NSE_INDEX|Nifty 50`. Letters, digits and a few
 * punctuation marks the names use - no comma (it separates keys), no slash, no second pipe.
 */
const UPSTOX_KEY = /^(NSE|BSE)_(INDEX|EQ)\|[A-Za-z0-9 &._+()%-]{1,48}$/;
const COMMODITY_SYMBOL = /^[A-Z0-9]{2,20}$/;

function validItem(raw: unknown): WatchRequestItem | null {
  if (!raw || typeof raw !== "object") return null;
  const { itemKey, kind, symbol } = raw as Record<string, unknown>;
  if (typeof itemKey !== "string" || typeof symbol !== "string" || typeof kind !== "string") return null;
  if (!(WATCHLIST_KINDS as readonly string[]).includes(kind)) return null;

  if (kind === "commodity") {
    return COMMODITY_SYMBOL.test(symbol) ? { itemKey, kind: "commodity", symbol } : null;
  }
  const wanted = kind === "index" ? "INDEX" : "EQ";
  const match = UPSTOX_KEY.exec(itemKey);
  return match && match[2] === wanted ? { itemKey, kind: kind as WatchlistKind, symbol } : null;
}

/** The request body as a clean, de-duplicated list - or null when it isn't one, or when any entry in it is not valid. */
export function parseWatchRequest(body: unknown): WatchRequestItem[] | null {
  const raw = body && typeof body === "object" ? (body as { items?: unknown }).items : undefined;
  if (!Array.isArray(raw) || raw.length > MAX_WATCH_ITEMS) return null;
  const seen = new Set<string>();
  const items: WatchRequestItem[] = [];
  for (const entry of raw) {
    const item = validItem(entry);
    if (!item) return null;
    if (seen.has(item.itemKey)) continue;
    seen.add(item.itemKey);
    items.push(item);
  }
  return items;
}

/**
 * The key an item is quoted under, and for a commodity the contract month behind it. An index or stock is quoted
 * by its own key; a commodity by whichever future is current - null if the exchange lists none for it.
 */
export function resolveQuoteKey(
  item: WatchRequestItem,
  futures: ReadonlyMap<string, McxFuture>,
): { key: string; contract: WatchQuote["contract"] } | null {
  if (item.kind !== "commodity") return { key: item.itemKey, contract: null };
  const future = futures.get(item.symbol);
  if (!future) return null;
  return { key: future.key, contract: { label: contractMonthLabel(future.expiry), expiry: future.expiry } };
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * One entry of Upstox's `/v2/market-quote/quotes`, reduced. Yesterday's close isn't in it - it is the price less
 * `net_change` (checked against the Nifty: 25,299.35 less 44.30 is the 25,255.05 it closed at). Null when
 * the instrument has no price at all: nothing has traded, and a row of zeros would read as an answer.
 */
export function parseQuoteEntry(entry: unknown, contract: WatchQuote["contract"]): WatchQuote | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { last_price?: unknown; net_change?: unknown; ohlc?: Record<string, unknown> | null; volume?: unknown };
  const price = positive(e.last_price);
  if (price === null) return null;

  const change = finite(e.net_change);
  const prevClose = change === null ? null : positive(price - change);
  return {
    price,
    prevClose,
    change: prevClose === null ? null : change,
    changePct: prevClose === null || change === null ? null : (change / prevClose) * 100,
    open: positive(e.ohlc?.open),
    high: positive(e.ohlc?.high),
    low: positive(e.ohlc?.low),
    volume: finite(e.volume),
    contract,
  };
}
