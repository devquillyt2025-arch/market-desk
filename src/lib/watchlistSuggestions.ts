/**
 * What the Watchlist's Add popup offers before anything is typed: a short, hand-picked set per kind, so the popup
 * is useful on first open and the common additions are one click. Anything already on the list is left out.
 *
 * Indices and commodities are named by key/symbol (checked against Upstox: `NSE_INDEX|India VIX`, `GLOBAL_INDEX|SGX NIFTY`
 * (GIFT Nifty) and the rest quote); the stocks come from the Heatmap's table, which already has each one's name and ISIN.
 */

import { getHeatmapStock } from "@/lib/heatmap/constituents";
import { commodityName, commodityUnit } from "@/lib/mcxCommodities";
import { commodityItemKey, GIFT_NIFTY, type WatchSearchResult } from "@/lib/watchlist";

const INDEX_SUGGESTIONS: (Omit<WatchSearchResult, "kind" | "detail"> & { detail?: string })[] = [
  // First: it moves while NSE is shut, and is the usual read on where Nifty will open.
  { itemKey: GIFT_NIFTY.itemKey, symbol: GIFT_NIFTY.symbol, name: GIFT_NIFTY.name, detail: "NSE IX · GIFT City" },
  { itemKey: "NSE_INDEX|India VIX", symbol: "INDIA VIX", name: "India VIX" },
  { itemKey: "NSE_INDEX|Nifty Fin Service", symbol: "FINNIFTY", name: "Nifty Fin Service" },
  { itemKey: "NSE_INDEX|NIFTY MID SELECT", symbol: "MIDCPNIFTY", name: "Nifty Midcap Select" },
  { itemKey: "NSE_INDEX|Nifty Next 50", symbol: "NIFTYNXT50", name: "Nifty Next 50" },
];

/** The mini contracts - the full-size ones are already on the starting list. */
const COMMODITY_SUGGESTIONS = ["CRUDEOILM", "GOLDM", "SILVERM", "NATGASMINI"] as const;

const STOCK_SUGGESTIONS = ["RELIANCE", "HDFCBANK", "ICICIBANK", "INFY", "TCS", "SBIN"] as const;

export type Suggestions = { indices: WatchSearchResult[]; commodities: WatchSearchResult[]; stocks: WatchSearchResult[] };

export function suggestedInstruments(listed: ReadonlySet<string>): Suggestions {
  const indices: WatchSearchResult[] = INDEX_SUGGESTIONS.map((s) => ({ ...s, kind: "index", detail: s.detail ?? "NSE index" }));
  const commodities: WatchSearchResult[] = COMMODITY_SUGGESTIONS.map((symbol) => ({
    kind: "commodity",
    itemKey: commodityItemKey(symbol),
    symbol,
    name: commodityName(symbol),
    detail: ["MCX", commodityUnit(symbol)].filter(Boolean).join(" · "),
  }));
  const stocks: WatchSearchResult[] = STOCK_SUGGESTIONS.flatMap((symbol) => {
    const stock = getHeatmapStock(symbol);
    return stock ? [{ kind: "equity" as const, itemKey: `NSE_EQ|${stock.isin}`, symbol, name: stock.name, detail: "NSE" }] : [];
  });

  const fresh = (results: WatchSearchResult[]) => results.filter((r) => !listed.has(r.itemKey));
  return { indices: fresh(indices), commodities: fresh(commodities), stocks: fresh(stocks) };
}
