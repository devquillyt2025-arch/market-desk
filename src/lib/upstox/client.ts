/**
 * Browser-side callers for this app's own /api/upstox/* routes — never calls
 * Upstox directly (see option-chain/route.ts for why).
 */

import type { HeatmapTabId } from "@/lib/heatmap/constituents";
import type { HeatmapRange } from "@/lib/heatmap/ranges";
import { isCommodityInstrument, type Instrument } from "@/lib/types";
import type { WatchlistItem } from "@/lib/watchlist";
import {
  isUpstoxFutureQuoteError,
  isUpstoxHeatmapError,
  isUpstoxMarginError,
  isUpstoxOptionChainError,
  isUpstoxVolatilityError,
  type InstrumentSearchResult,
  type UpstoxFutureQuoteResult,
  type UpstoxHeatmapResult,
  type UpstoxWatchlistResult,
  type UpstoxMarginInstrumentRequest,
  type UpstoxMarginLine,
  type UpstoxOptionChainResult,
  type UpstoxPnlReportResult,
  type UpstoxPnlSegment,
  type UpstoxPnlSummaryResult,
  type UpstoxPositionsResult,
  type UpstoxVolatilityResult,
} from "@/lib/upstox/types";

/**
 * `strikes` only matters for a commodity, whose chain is a window around the money: the strikes held
 * are asked for by name so they are in it wherever they sit.
 */
export async function fetchOptionChain(instrument: Instrument, expiry: string, strikes: number[] = []): Promise<UpstoxOptionChainResult> {
  const params = new URLSearchParams({ instrument, expiry });
  if (strikes.length > 0 && isCommodityInstrument(instrument)) params.set("strikes", strikes.join(","));
  const res = await fetch(`/api/upstox/option-chain?${params}`, { cache: "no-store" });
  const body: UpstoxOptionChainResult = await res.json();

  if (!res.ok && !isUpstoxOptionChainError(body)) {
    // Defensive fallback — the route always returns { error } on a non-ok
    // status, but don't let a malformed response masquerade as chain data.
    return { error: `Request failed with status ${res.status}` };
  }
  return body;
}

/** One index future's live quote - what prices a futures position, which has no row in an option chain. */
export async function fetchFutureQuote(instrument: Instrument, expiry: string): Promise<UpstoxFutureQuoteResult> {
  const res = await fetch(`/api/upstox/future-quote?${new URLSearchParams({ instrument, expiry })}`, { cache: "no-store" });
  const body: UpstoxFutureQuoteResult = await res.json();

  if (!res.ok && !isUpstoxFutureQuoteError(body)) {
    // Same defensive fallback as fetchOptionChain.
    return { error: `Request failed with status ${res.status}` };
  }
  return body;
}

/**
 * Price + percent change over `range` for every constituent of an index, plus
 * the three headline index levels — feeds the Heatmap tab. `index` NIFTY means Nifty 50.
 */
export async function fetchHeatmap(index: HeatmapTabId, range: HeatmapRange): Promise<UpstoxHeatmapResult> {
  const res = await fetch(`/api/upstox/heatmap?${new URLSearchParams({ index, range })}`, { cache: "no-store" });
  const body: UpstoxHeatmapResult = await res.json();

  if (!res.ok && !isUpstoxHeatmapError(body)) {
    // Same defensive fallback as fetchOptionChain.
    return { error: `Request failed with status ${res.status}` };
  }
  return body;
}

/** How much an index has been moving, day to day, over a few look-backs - feeds the RRR planner. */
export async function fetchVolatility(instrument: Instrument): Promise<UpstoxVolatilityResult> {
  const res = await fetch(`/api/upstox/volatility?${new URLSearchParams({ instrument })}`, { cache: "no-store" });
  const body: UpstoxVolatilityResult = await res.json();

  if (!res.ok && !isUpstoxVolatilityError(body)) {
    // Same defensive fallback as fetchOptionChain.
    return { error: `Request failed with status ${res.status}` };
  }
  return body;
}

/** Live quotes for every instrument on the Watchlist - one call, whatever the list's length. */
export async function fetchWatchlistQuotes(items: Pick<WatchlistItem, "itemKey" | "kind" | "symbol">[]): Promise<UpstoxWatchlistResult> {
  try {
    const res = await fetch("/api/upstox/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: items.map(({ itemKey, kind, symbol }) => ({ itemKey, kind, symbol })) }),
      cache: "no-store",
    });
    const body = await res.json();
    if (!res.ok || typeof body?.error === "string") return { error: body?.error ?? `Request failed with status ${res.status}` };
    if (!body?.quotes || typeof body.quotes !== "object") return { error: "Watchlist response was missing the expected data." };
    return body;
  } catch {
    return { error: "network_error" };
  }
}

/** Stocks, indices and commodities matching what's typed in the Watchlist's Add popup. */
export async function searchInstruments(query: string, signal?: AbortSignal): Promise<InstrumentSearchResult> {
  try {
    const res = await fetch(`/api/upstox/instrument-search?${new URLSearchParams({ q: query })}`, { cache: "no-store", signal });
    const body = await res.json();
    if (!res.ok || typeof body?.error === "string") return { error: body?.error ?? `Request failed with status ${res.status}` };
    if (!body?.results) return { error: "Search response was missing the expected data." };
    return body;
  } catch (e) {
    return { error: e instanceof DOMException && e.name === "AbortError" ? "aborted" : "network_error" };
  }
}

const MARGIN_BATCH_SIZE = 20; // Upstox's own per-request limit

export type MarginFetchResult =
  | {
      margins: UpstoxMarginLine[];
      /** Upstox's basket-level `final_margin` (hedge benefit applied), summed across chunks — null if any chunk omitted it. */
      finalMargin: number | null;
    }
  | { error: string };

/**
 * Fetches margin for every instrument, chunking into batches of 20 (Upstox's
 * limit) and concatenating the results back in the same order as `instruments`
 * so the caller can zip `margins[i]` back to `instruments[i]` by index. Fails
 * the whole call on the first failing chunk — a partial total would be
 * misleading rather than merely incomplete.
 */
export async function fetchMargin(instruments: UpstoxMarginInstrumentRequest[]): Promise<MarginFetchResult> {
  const margins: UpstoxMarginLine[] = [];
  let finalMargin: number | null = 0;

  for (let i = 0; i < instruments.length; i += MARGIN_BATCH_SIZE) {
    const batch = instruments.slice(i, i + MARGIN_BATCH_SIZE);
    let res: Response;
    try {
      res = await fetch("/api/upstox/margin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruments: batch }),
        cache: "no-store",
      });
    } catch {
      return { error: "Couldn't reach the margin endpoint." };
    }
    const body = await res.json();
    if (!res.ok || isUpstoxMarginError(body)) {
      return isUpstoxMarginError(body) ? body : { error: `Request failed with status ${res.status}` };
    }
    if (!Array.isArray(body?.data?.margins)) {
      // Defensive fallback — same reasoning as fetchOptionChain: don't let a
      // malformed success response throw and leave the caller's loading
      // state stuck.
      return { error: "Margin response was missing the expected data." };
    }
    margins.push(...body.data.margins);
    const chunkFinal = body.data.final_margin;
    finalMargin = finalMargin !== null && typeof chunkFinal === "number" ? finalMargin + chunkFinal : null;
  }

  return { margins, finalMargin };
}

export type ExpiriesFetchResult = { expiries: string[] } | { error: string };

/** The expiry dates (yyyy-mm-dd, soonest first) Upstox lists for an index — feeds the option-chain picker's expiry dropdown. */
export async function fetchExpiries(instrument: Instrument): Promise<ExpiriesFetchResult> {
  try {
    const res = await fetch(`/api/upstox/expiries?${new URLSearchParams({ instrument })}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok || typeof body?.error === "string") return { error: body?.error ?? `Request failed with status ${res.status}` };
    if (!Array.isArray(body?.expiries)) return { error: "Expiry response was missing the expected data." };
    return { expiries: body.expiries };
  } catch {
    return { error: "network_error" };
  }
}

/** The account's open (and squared-off-today) index and MCX crude oil / gold / natural gas option positions — feeds Live Portfolio's sync. */
export async function fetchPositions(): Promise<UpstoxPositionsResult> {
  try {
    const res = await fetch("/api/upstox/positions", { cache: "no-store" });
    const body = await res.json();
    if (!res.ok || typeof body?.error === "string") return { error: body?.error ?? `Request failed with status ${res.status}` };
    if (!Array.isArray(body?.positions)) return { error: "Positions response was missing the expected data." };
    return body;
  } catch {
    return { error: "network_error" };
  }
}

/** Every closed round trip in the financial year starting April `fy` — feeds Trade Entries' "Sync Upstox". */
export async function fetchPnlReport(fy: number): Promise<UpstoxPnlReportResult> {
  try {
    const res = await fetch(`/api/upstox/pnl-report?${new URLSearchParams({ fy: String(fy) })}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok || typeof body?.error === "string") return { error: body?.error ?? `Request failed with status ${res.status}` };
    if (!Array.isArray(body?.trades)) return { error: "P&L report response was missing the expected data." };
    return body;
  } catch {
    return { error: "network_error" };
  }
}

/** Upstox's own trade summary (P&L, charges, ROI, win rate) for one segment's trades closed between two yyyy-mm-dd dates — feeds Reports. */
export async function fetchPnlSummary(segment: UpstoxPnlSegment, from: string, to: string): Promise<UpstoxPnlSummaryResult> {
  try {
    const res = await fetch(`/api/upstox/pnl-summary?${new URLSearchParams({ segment, from, to })}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok || typeof body?.error === "string") return { error: body?.error ?? `Request failed with status ${res.status}` };
    if (typeof body?.grossPnl !== "number") return { error: "Summary response was missing the expected data." };
    return body;
  } catch {
    return { error: "network_error" };
  }
}
