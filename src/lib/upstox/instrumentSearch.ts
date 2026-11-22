/**
 * Server-side helpers behind /api/upstox/instrument-search - pure, so they can be tested without a network.
 *
 * Indices and stocks are searched by Upstox's own search endpoint (the same one its apps use); commodities are
 * searched here, in the MCX contract list this app already holds, because Upstox's search returns a
 * commodity once per expiry month while the Watchlist wants it once.
 */

import { commodityName, commodityUnit, contractMonthLabel, isOfferedCommodity } from "@/lib/mcxCommodities";
import type { WatchSearchResult } from "@/lib/watchlist";
import { commodityItemKey, GIFT_NIFTY } from "@/lib/watchlist";
import type { McxFuture } from "@/lib/upstox/mcx";

/** The typed query, tidied - or null when it's too short to be worth a search (or absurdly long). */
export function cleanQuery(raw: string | null): string | null {
  if (raw === null) return null;
  const query = raw.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return query.length >= 2 && query.length <= 40 ? query : null;
}

/** Commodities whose symbol or name contains every word typed - exact symbol first, then names starting with it, then the rest. */
export function searchCommodities(futures: ReadonlyMap<string, McxFuture>, query: string, limit = 6): WatchSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const q = query.toLowerCase();

  const hits: { result: WatchSearchResult; rank: number }[] = [];
  for (const future of futures.values()) {
    if (!isOfferedCommodity(future.symbol)) continue;
    const name = commodityName(future.symbol, future.name);
    const haystack = `${future.symbol} ${name} ${future.name}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;

    const rank = future.symbol.toLowerCase() === q ? 0 : name.toLowerCase().startsWith(q) || future.symbol.toLowerCase().startsWith(q) ? 1 : 2;
    const unit = commodityUnit(future.symbol);
    hits.push({
      rank,
      result: {
        kind: "commodity",
        itemKey: commodityItemKey(future.symbol),
        symbol: future.symbol,
        name,
        detail: ["MCX", contractMonthLabel(future.expiry), unit].filter(Boolean).join(" · "),
      },
    });
  }
  return hits.sort((a, b) => a.rank - b.rank || a.result.name.localeCompare(b.result.name)).slice(0, limit).map((h) => h.result);
}

/**
 * Global indices the Watchlist can hold. Upstox's search never returns these (a search for "gift" finds only Nifty
 * indices), so they are matched here, on the words people use for them. Just GIFT Nifty for now.
 */
export function searchGlobalIndices(query: string): WatchSearchResult[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const haystack = `${GIFT_NIFTY.name} ${GIFT_NIFTY.symbol} sgx nifty nse ix gift city`.toLowerCase();
  if (!terms.every((term) => haystack.includes(term))) return [];
  return [{ ...GIFT_NIFTY, detail: "NSE IX · GIFT City" }];
}

function rowsOf(body: unknown): Record<string, unknown>[] {
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** NSE stocks (and ETFs - Upstox files them as equities) from Upstox's search response. */
export function mapEquityRows(body: unknown, limit = 8): WatchSearchResult[] {
  const out: WatchSearchResult[] = [];
  for (const row of rowsOf(body)) {
    const key = text(row.instrument_key);
    const symbol = text(row.trading_symbol);
    if (row.segment !== "NSE_EQ" || row.instrument_type !== "EQ" || !key || !symbol) continue;
    out.push({ kind: "equity", itemKey: key, symbol, name: text(row.short_name) ?? text(row.name) ?? symbol, detail: "NSE" });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * NSE and BSE indices from Upstox's search response. Its search is fuzzy - "gold" brings back BSE Capital Goods - which
 * is fine for finding a stock by a half-remembered name but just noise among a few hundred indices, so when the
 * query is passed an index has to actually contain every word of it.
 */
export function mapIndexRows(body: unknown, limit = 6, query?: string): WatchSearchResult[] {
  const terms = (query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const out: WatchSearchResult[] = [];
  for (const row of rowsOf(body)) {
    const key = text(row.instrument_key);
    const symbol = text(row.trading_symbol);
    if ((row.segment !== "NSE_INDEX" && row.segment !== "BSE_INDEX") || !key || !symbol) continue;
    const name = text(row.short_name) ?? text(row.name) ?? symbol;
    const haystack = `${name} ${symbol}`.toLowerCase();
    if (!terms.every((term) => haystack.includes(term))) continue;
    out.push({ kind: "index", itemKey: key, symbol, name, detail: row.segment === "BSE_INDEX" ? "BSE index" : "NSE index" });
    if (out.length >= limit) break;
  }
  return out;
}
