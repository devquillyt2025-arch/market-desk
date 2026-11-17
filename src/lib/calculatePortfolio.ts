/**
 * Pure matching + math for the Live Portfolio tab. No React, no fetching —
 * takes already-fetched option-chain responses (keyed by group), index-future
 * quotes and already-fetched open trade entries, and produces one display row
 * per entry. Reuses tradeEntriesStore's calculateEntryPnl and
 * calculateBrokerage.ts as-is rather than reimplementing either.
 */

import { calculateBrokerage, optionsSegmentFor } from "@/lib/calculateBrokerage";
import { round2 } from "@/lib/calculateTrade";
import { atmIvOfRows, spotOfRows } from "@/lib/strategyFutures";
import { calculateEntryPnl } from "@/lib/tradeEntriesStore";
import { DEFAULT_LOT_SIZES, type TradeEntry, type TradeEntryOptionType } from "@/lib/types";
import {
  isUpstoxFutureQuoteError,
  isUpstoxOptionChainError,
  type UpstoxFutureQuoteResult,
  type UpstoxOptionChainResult,
  type UpstoxOptionLeg,
  type UpstoxPosition,
} from "@/lib/upstox/types";

/** `(instrument, expiry_date)` pair identifying one option-chain fetch — several open positions can share one. */
export function portfolioGroupKey(instrument: string, expiryDate: string): string {
  return `${instrument}|${expiryDate}`;
}

/** `(instrument, expiry_date)` pair identifying one future's quote — kept apart from the option groups, which can share that very pair (a monthly option and the future expire together). */
export function futureGroupKey(instrument: string, expiryDate: string): string {
  return `FUT|${instrument}|${expiryDate}`;
}

type TrackableEntry = TradeEntry & {
  strike_price: number;
  option_type: TradeEntryOptionType;
  expiry_date: string;
};

/**
 * An index future: no strike, no CE/PE, just the expiry of its contract month. That is how the journal already
 * records the futures of Upstox's P&L report, and what Live Portfolio's sync writes for a futures position - so
 * no new column is needed. (The entry form refuses a strike or CE/PE without the rest, so a half-filled option
 * never looks like this.)
 */
type FutureEntry = TradeEntry & {
  strike_price: null;
  option_type: null;
  expiry_date: string;
};

export function isFutureEntry(entry: TradeEntry): entry is FutureEntry {
  return entry.strike_price == null && entry.option_type == null && entry.expiry_date != null;
}

/** An entry whose live price can be fetched: an option with its strike, CE/PE and expiry, or a future with its expiry. */
export function isTrackedEntry(entry: TradeEntry): entry is TrackableEntry | FutureEntry {
  return isTrackableEntry(entry) || isFutureEntry(entry);
}

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
  /** The contract's previous-session close, as Upstox reports it — what today's move is measured from. */
  prevClose: number | null;
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
  /** True when the figures here are the last ones seen before live pricing dropped (token expired / offline), not current. */
  stale: boolean;
  /** When a stale row's prices were fetched — null for a current row. */
  asOf: number | null;
};

type GreeksAndOi = Pick<
  PortfolioRow,
  "prevClose" | "delta" | "gamma" | "theta" | "vega" | "oi" | "iv" | "volume" | "underlyingSpot" | "nearbyIv"
>;

/** Everything a priced row needs from the market, kept between polls (and page loads) so an outage can still show it. */
export type LegSnapshot = GreeksAndOi & {
  /** When these figures were fetched, in ms since the epoch. */
  at: number;
  ltp: number;
  instrumentKey: string | null;
};

/** Last good snapshot per contract, keyed by legSnapshotKey. */
export type LegSnapshots = Record<string, LegSnapshot>;

/**
 * One contract — the same strike can sit in several open positions, and they all share one last price. A
 * future's key ends in FUT in place of its strike and CE/PE (positionContractKey in upstoxSync.ts writes the same).
 */
export function legSnapshotKey(entry: TrackableEntry | FutureEntry): string {
  return isFutureEntry(entry)
    ? `${entry.instrument}|${entry.expiry_date}|FUT`
    : `${entry.instrument}|${entry.expiry_date}|${entry.strike_price}|${entry.option_type}`;
}

/** Null unless the row holds a current (not already stale) live price. */
export function toLegSnapshot(row: PortfolioRow, at: number): { key: string; snapshot: LegSnapshot } | null {
  if (row.status !== "ok" || row.stale || row.liveLtp == null || !isTrackedEntry(row.entry)) return null;
  return {
    key: legSnapshotKey(row.entry),
    snapshot: {
      at,
      ltp: row.liveLtp,
      instrumentKey: row.instrumentKey,
      prevClose: row.prevClose,
      delta: row.delta,
      gamma: row.gamma,
      theta: row.theta,
      vega: row.vega,
      oi: row.oi,
      iv: row.iv,
      volume: row.volume,
      underlyingSpot: row.underlyingSpot,
      nearbyIv: row.nearbyIv,
    },
  };
}

/** Failures that say nothing about the market itself — worth showing the last known price through. */
function isOutage(error: string): boolean {
  return error === "token_expired" || error === "network_error";
}

/** What the edit popup shows for an open, live-priced position — the same numbers the table row shows. */
export type LivePositionInfo = {
  /** When these figures are from, if they're the last ones seen rather than current — null while live. */
  asOf: number | null;
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
    asOf: row.stale ? row.asOf : null,
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

/** yyyy-mm-dd of a timestamp in the device's own timezone — matches how entry_date is entered. */
function localISODate(ms: number): string {
  const d = new Date(ms);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * What a position has made or lost since today's open: the move from the
 * previous close to the live price — or from the entry price if it was opened
 * today, since the move before that never belonged to this position. Same sign
 * convention as livePnl (and likewise before brokerage). Null when there's
 * nothing sound to measure: no live price, no previous close reported, or a
 * last-known price from an earlier day, which would pass off an old session's
 * move as today's.
 */
export function calculateTodayPnl(row: PortfolioRow, today: string): number | null {
  if (row.status !== "ok" || row.liveLtp == null) return null;
  if (row.stale && (row.asOf == null || localISODate(row.asOf) !== today)) return null;

  const base = row.entry.entry_date === today ? row.entryPrice : row.prevClose;
  if (base == null) return null;

  const { buyPrice, sellPrice } =
    row.entry.side === "sell"
      ? { buyPrice: row.liveLtp, sellPrice: base }
      : { buyPrice: base, sellPrice: row.liveLtp };
  return calculateEntryPnl({ instrument: row.entry.instrument, lots: row.entry.lots, buyPrice, sellPrice });
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
  return spotOfRows(chain.data);
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

/**
 * The at-the-money implied volatility of a chain, in percent as Upstox reports it: the strike nearest `spot` that has
 * one, averaged over its call and put when both do. A future has no volatility of its own, so the risk model borrows
 * the one the options of its own expiry trade at.
 */
function atmIv(chain: UpstoxOptionChainResult, spot: number | null): number | null {
  if (isUpstoxOptionChainError(chain)) return null;
  return atmIvOfRows(chain.data, spot);
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
  prevClose: null,
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
  stale: false,
  asOf: null,
} as const;

/** A row with a live price — either fresh from a chain or the last snapshot standing in for one. */
function pricedRow(
  entry: TrackableEntry | FutureEntry,
  entryPrice: number,
  liveLtp: number,
  instrumentKey: string | null,
  greeksAndOi: GreeksAndOi,
  freshness: { stale: boolean; asOf: number | null },
): PortfolioRow {
  const { buyPrice, sellPrice } = syntheticPrices(entry, liveLtp);
  const livePnl = calculateEntryPnl({ instrument: entry.instrument, lots: entry.lots, buyPrice, sellPrice });
  const qty = entry.lots * DEFAULT_LOT_SIZES[entry.instrument];
  const segment = isFutureEntry(entry) ? "FUTURES" : optionsSegmentFor(entry.instrument);
  const brokerageIfClosed = calculateBrokerage(segment, [{ buyPrice, sellPrice }], qty).totalCharges;

  return {
    entry,
    entryPrice,
    status: "ok",
    instrumentKey,
    liveLtp,
    livePnl,
    brokerageIfClosed,
    ...greeksAndOi,
    ...freshness,
  };
}

/** The latest quote per future, keyed by futureGroupKey. */
export type FutureQuotes = Record<string, UpstoxFutureQuoteResult | undefined>;

/**
 * A future has no row in an option chain: its price comes from its own quote, and it has no Greeks and no IV of its
 * own. If the option chain of its expiry is loaded, that supplies the index level (`underlyingSpot`) and the at-the-money
 * volatility (`nearbyIv`) the risk and what-if models need - a future is the index plus a gap (the basis), and those two
 * numbers are what let them be measured against it. Without that chain the row is still a plain price-and-P&L line.
 */
function computeFutureRow(
  entry: FutureEntry,
  entryPrice: number,
  futureQuotes: FutureQuotes | undefined,
  lastKnown: LegSnapshots | undefined,
  chainsByGroup: Record<string, UpstoxOptionChainResult | undefined>,
): PortfolioRow {
  const quote = futureQuotes?.[futureGroupKey(entry.instrument, entry.expiry_date)];
  const chain = chainsByGroup[portfolioGroupKey(entry.instrument, entry.expiry_date)];
  const spot = chain && !isUpstoxOptionChainError(chain) ? anySpot(chain) : null;
  const iv = chain ? atmIv(chain, spot) : null;
  if (!quote) return { entry, entryPrice, status: "loading", ...EMPTY_LIVE_FIELDS };

  if (isUpstoxFutureQuoteError(quote)) {
    const snapshot = isOutage(quote.error) ? lastKnown?.[legSnapshotKey(entry)] : undefined;
    if (snapshot) {
      const { at, ltp, instrumentKey, ...greeksAndOi } = snapshot;
      return pricedRow(entry, entryPrice, ltp, instrumentKey, greeksAndOi, { stale: true, asOf: at });
    }
    return { entry, entryPrice, status: "error", errorMessage: quote.error, ...EMPTY_LIVE_FIELDS };
  }

  return pricedRow(
    entry,
    entryPrice,
    quote.ltp,
    quote.instrumentKey,
    {
      prevClose: quote.prevClose,
      delta: null,
      gamma: null,
      theta: null,
      vega: null,
      oi: quote.oi,
      iv: null,
      volume: quote.volume,
      underlyingSpot: spot,
      nearbyIv: iv,
    },
    { stale: false, asOf: null },
  );
}

/**
 * `lastKnown` is the fallback for an outage (token expired, no connection):
 * a contract whose poll failed keeps the last price it was seen at, flagged
 * `stale`, instead of turning into an error row with nothing to show. Any
 * other failure still surfaces as an error — that one says something is wrong
 * with the request, not that the market is out of reach.
 */
export function computePortfolioRow(
  entry: TradeEntry,
  chainsByGroup: Record<string, UpstoxOptionChainResult | undefined>,
  lastKnown?: LegSnapshots,
  futureQuotes?: FutureQuotes,
): PortfolioRow {
  const entryPrice = entry.side === "sell" ? entry.sell_price : entry.buy_price;

  if (isFutureEntry(entry)) return computeFutureRow(entry, entryPrice, futureQuotes, lastKnown, chainsByGroup);

  if (!isTrackableEntry(entry)) {
    return { entry, entryPrice, status: "untracked", ...EMPTY_LIVE_FIELDS };
  }

  const chain = chainsByGroup[portfolioGroupKey(entry.instrument, entry.expiry_date)];
  if (!chain) {
    return { entry, entryPrice, status: "loading", ...EMPTY_LIVE_FIELDS };
  }
  if (isUpstoxOptionChainError(chain)) {
    const snapshot = isOutage(chain.error) ? lastKnown?.[legSnapshotKey(entry)] : undefined;
    if (snapshot) {
      const { at, ltp, instrumentKey, ...greeksAndOi } = snapshot;
      return pricedRow(entry, entryPrice, ltp, instrumentKey, greeksAndOi, { stale: true, asOf: at });
    }
    return { entry, entryPrice, status: "error", errorMessage: chain.error, ...EMPTY_LIVE_FIELDS };
  }

  const strikeRow = findStrikeRow(chain, entry);
  const leg = strikeRow ? legOf(strikeRow, entry) : null;
  const liveLtp = leg?.market_data?.ltp ?? null;
  const closePrice = leg?.market_data?.close_price;
  const greeksAndOi = {
    prevClose: closePrice != null && closePrice > 0 ? closePrice : null,
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
      stale: false,
      asOf: null,
    };
  }

  return pricedRow(entry, entryPrice, liveLtp, leg?.instrument_key ?? null, greeksAndOi, { stale: false, asOf: null });
}

/** One position squared off today, worked out the way the Closed Today table shows it. */
export type ClosedPositionSummary = {
  position: UpstoxPosition;
  /** Average price of everything bought / sold today — null when nothing was. */
  buyAvg: number | null;
  sellAvg: number | null;
  /** Realised P&L before charges: sell turnover less buy turnover. */
  pnl: number;
  /** Estimated round-trip charges — null while either average is unknown. */
  charges: number | null;
};

function averagePrice(value: number, quantity: number): number | null {
  return quantity > 0 ? round2(value / quantity) : null;
}

export function summariseClosedPosition(position: UpstoxPosition): ClosedPositionSummary {
  const buyAvg = averagePrice(position.buyValue, position.buyQuantity);
  const sellAvg = averagePrice(position.sellValue, position.sellQuantity);
  const charges =
    buyAvg != null && sellAvg != null
      ? calculateBrokerage(
          position.optionType === null ? "FUTURES" : optionsSegmentFor(position.instrument),
          [{ buyPrice: buyAvg, sellPrice: sellAvg }],
          position.buyQuantity,
        ).totalCharges
      : null;
  return { position, buyAvg, sellAvg, pnl: round2(position.sellValue - position.buyValue), charges };
}
