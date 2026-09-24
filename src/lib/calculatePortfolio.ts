/**
 * Pure matching + math for the Live Portfolio tab. No React, no fetching —
 * takes already-fetched option-chain responses (keyed by group) and
 * already-fetched open trade entries, and produces one display row per
 * entry. Reuses tradeEntriesStore's calculateEntryPnl and
 * calculateBrokerage.ts as-is rather than reimplementing either.
 */

import { calculateBrokerage } from "@/lib/calculateBrokerage";
import { calculateEntryPnl } from "@/lib/tradeEntriesStore";
import { DEFAULT_LOT_SIZES, type TradeEntry, type TradeEntryOptionType } from "@/lib/types";
import { isUpstoxOptionChainError, type UpstoxOptionChainResult, type UpstoxOptionLeg } from "@/lib/upstox/types";

/** `(instrument, expiry_date)` pair identifying one option-chain fetch — several open positions can share one. */
export function portfolioGroupKey(instrument: string, expiryDate: string): string {
  return `${instrument}|${expiryDate}`;
}

type TrackableEntry = TradeEntry & {
  strike_price: number;
  option_type: TradeEntryOptionType;
  expiry_date: string;
};

/** Entries this tab can track live: open, with strike/CE-PE/expiry all set (see TradeEntryModal's "all or nothing" rule). */
export function isTrackableEntry(entry: TradeEntry): entry is TrackableEntry {
  return entry.strike_price != null && entry.option_type != null && entry.expiry_date != null;
}

/**
 * True for a row that's one field away from trackable — strike + CE/PE are
 * already set, only expiry_date is missing (saved before that column
 * existed, or skipped). These get an inline "set expiry" picker instead of
 * a plain badge, since fixing them doesn't need the full edit form.
 */
export function needsExpiryOnly(entry: TradeEntry): boolean {
  return entry.strike_price != null && entry.option_type != null && entry.expiry_date == null;
}

export type PortfolioRowStatus =
  /** No expiry_date/strike/option_type — shown with a "no expiry set" badge, never fetched. */
  | "untracked"
  /** Trackable, but its group hasn't come back from a poll yet. */
  | "loading"
  /** The poll for its group failed (network error or Upstox error, including token_expired). */
  | "error"
  /** The group's chain loaded, but this exact strike/side wasn't in it. */
  | "no_match"
  /** Live LTP found and applied. */
  | "ok";

export type PortfolioRow = {
  entry: TradeEntry;
  /** Whichever of buy_price/sell_price this entry's own `side` actually executed. */
  entryPrice: number;
  status: PortfolioRowStatus;
  errorMessage?: string;
  /** This exact contract's Upstox instrument_key — only known once its leg is found in a loaded chain (status "ok"). Needed to look up real margin. */
  instrumentKey: string | null;
  liveLtp: number | null;
  livePnl: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  oi: number | null;
  /** Raw Upstox implied volatility for this leg (percent) — feeds the Risk & Probability panel. */
  iv: number | null;
  volume: number | null;
  /** Underlying's spot price at the time of the poll — off the matched strike row, or any other row in the same chain if that one omits it. */
  underlyingSpot: number | null;
  /** IV of the closest strike (same CE/PE side) that does report one — a last-resort stand-in when this leg's own IV is missing/0. */
  nearbyIv: number | null;
  /** Total round-trip brokerage (the entry order already placed + a hypothetical exit at liveLtp right now). */
  brokerageIfClosed: number | null;
};

/** What the edit popup shows for an open, live-priced position — the same numbers the table row shows. */
export type LivePositionInfo = {
  ltp: number | null;
  pnl: number | null;
  brokerageIfClosed: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  oi: number | null;
};

/** undefined when the row has no live data (untracked/loading/error/no_match) — the popup then just omits the live block. */
export function toLivePositionInfo(row: PortfolioRow | undefined): LivePositionInfo | undefined {
  if (!row || row.status !== "ok") return undefined;
  return {
    ltp: row.liveLtp,
    pnl: row.livePnl,
    brokerageIfClosed: row.brokerageIfClosed,
    delta: row.delta,
    gamma: row.gamma,
    theta: row.theta,
    vega: row.vega,
    oi: row.oi,
  };
}

function findStrikeRow(chain: UpstoxOptionChainResult, entry: TrackableEntry) {
  if (isUpstoxOptionChainError(chain)) return null;
  return (
    chain.data.find((row) => row.strike_price != null && Number(row.strike_price) === entry.strike_price) ?? null
  );
}

/** Every strike row in a chain carries the same underlying spot, so any one that has it will do. */
function anySpot(chain: UpstoxOptionChainResult): number | null {
  if (isUpstoxOptionChainError(chain)) return null;
  return chain.data.find((row) => row.underlying_spot_price != null)?.underlying_spot_price ?? null;
}

function nearestReportedIv(chain: UpstoxOptionChainResult, entry: TrackableEntry): number | null {
  if (isUpstoxOptionChainError(chain)) return null;
  let best: { distance: number; iv: number } | null = null;
  for (const row of chain.data) {
    const strike = Number(row.strike_price);
    const iv = (entry.option_type === "CE" ? row.call_options : row.put_options)?.option_greeks?.iv;
    if (!Number.isFinite(strike) || iv == null || !(iv > 0)) continue;
    const distance = Math.abs(strike - entry.strike_price);
    if (best === null || distance < best.distance) best = { distance, iv };
  }
  return best?.iv ?? null;
}

function legOf(strikeRow: NonNullable<ReturnType<typeof findStrikeRow>>, entry: TrackableEntry): UpstoxOptionLeg | null {
  return (entry.option_type === "CE" ? strikeRow.call_options : strikeRow.put_options) ?? null;
}

/**
 * Substitutes the live LTP for whichever side of the trade hasn't happened
 * yet, then hands the result to calculateEntryPnl unchanged — same sign
 * convention as the rest of the app, not reimplemented here. A sell-to-open
 * entry's buy leg is the hypothetical buy-back (liveLtp); a buy-to-open
 * entry's sell leg is the hypothetical sell-to-close (liveLtp).
 */
export function syntheticPrices(entry: TradeEntry, liveLtp: number): { buyPrice: number; sellPrice: number } {
  return entry.side === "sell"
    ? { buyPrice: liveLtp, sellPrice: entry.sell_price }
    : { buyPrice: entry.buy_price, sellPrice: liveLtp };
}

const EMPTY_LIVE_FIELDS = {
  instrumentKey: null,
  liveLtp: null,
  livePnl: null,
  delta: null,
  gamma: null,
  theta: null,
  vega: null,
  oi: null,
  iv: null,
  volume: null,
  underlyingSpot: null,
  nearbyIv: null,
  brokerageIfClosed: null,
} as const;

export function computePortfolioRow(
  entry: TradeEntry,
  chainsByGroup: Record<string, UpstoxOptionChainResult | undefined>,
): PortfolioRow {
  const entryPrice = entry.side === "sell" ? entry.sell_price : entry.buy_price;

  if (!isTrackableEntry(entry)) {
    return { entry, entryPrice, status: "untracked", ...EMPTY_LIVE_FIELDS };
  }

  const chain = chainsByGroup[portfolioGroupKey(entry.instrument, entry.expiry_date)];
  if (!chain) {
    return { entry, entryPrice, status: "loading", ...EMPTY_LIVE_FIELDS };
  }
  if (isUpstoxOptionChainError(chain)) {
    return { entry, entryPrice, status: "error", errorMessage: chain.error, ...EMPTY_LIVE_FIELDS };
  }

  const strikeRow = findStrikeRow(chain, entry);
  const leg = strikeRow ? legOf(strikeRow, entry) : null;
  const liveLtp = leg?.market_data?.ltp ?? null;
  const greeksAndOi = {
    delta: leg?.option_greeks?.delta ?? null,
    gamma: leg?.option_greeks?.gamma ?? null,
    theta: leg?.option_greeks?.theta ?? null,
    vega: leg?.option_greeks?.vega ?? null,
    oi: leg?.market_data?.oi ?? null,
    iv: leg?.option_greeks?.iv ?? null,
    volume: leg?.market_data?.volume ?? null,
    underlyingSpot: strikeRow?.underlying_spot_price ?? anySpot(chain),
    nearbyIv: nearestReportedIv(chain, entry),
  };

  if (liveLtp == null) {
    return {
      entry,
      entryPrice,
      status: "no_match",
      instrumentKey: null,
      liveLtp: null,
      livePnl: null,
      brokerageIfClosed: null,
      ...greeksAndOi,
    };
  }

  const { buyPrice, sellPrice } = syntheticPrices(entry, liveLtp);
  const livePnl = calculateEntryPnl({ instrument: entry.instrument, lots: entry.lots, buyPrice, sellPrice });
  const qty = entry.lots * DEFAULT_LOT_SIZES[entry.instrument];
  const brokerageIfClosed = calculateBrokerage("OPTIONS", [{ buyPrice, sellPrice }], qty).totalCharges;

  return {
    entry,
    entryPrice,
    status: "ok",
    instrumentKey: leg?.instrument_key ?? null,
    liveLtp,
    livePnl,
    brokerageIfClosed,
    ...greeksAndOi,
  };
}
