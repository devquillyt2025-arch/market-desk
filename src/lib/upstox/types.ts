/**
 * Shape of Upstox's `GET /v2/option/chain` response — the fields below were
 * checked against a real live response and match. Upstox's actual payload
 * carries a few more fields than are modeled here (e.g. bid/ask price and
 * qty, prev_oi, pop) that this app doesn't currently use;
 * they're simply left untyped rather than omitted for any correctness
 * reason. Every field is still read defensively (optional chaining, never
 * assumed present) — if Upstox ever changes a field name, `findLeg` in
 * calculatePortfolio.ts degrades to "no data for this row" rather than
 * throwing.
 */

import type { Instrument, TradeEntryOptionType, TradeEntrySide } from "@/lib/types";
import type { WatchQuote, WatchSearchResult } from "@/lib/watchlist";

export type UpstoxOptionGreeks = {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  /** Implied volatility in percent (e.g. 13.4) — `normalizeIv` in calculateRisk.ts handles either scale. */
  iv?: number;
};

export type UpstoxMarketData = {
  ltp?: number;
  /** The previous session's close — the baseline for "today's" move. */
  close_price?: number;
  oi?: number;
  volume?: number;
};

export type UpstoxOptionLeg = {
  instrument_key?: string;
  market_data?: UpstoxMarketData;
  option_greeks?: UpstoxOptionGreeks;
};

export type UpstoxOptionChainStrike = {
  expiry?: string;
  strike_price?: number;
  underlying_key?: string;
  underlying_spot_price?: number;
  call_options?: UpstoxOptionLeg;
  put_options?: UpstoxOptionLeg;
};

export type UpstoxOptionChainSuccess = {
  status: "success";
  data: UpstoxOptionChainStrike[];
};

export type UpstoxOptionChainError = {
  error: string;
  detail?: string;
};

export type UpstoxOptionChainResult = UpstoxOptionChainSuccess | UpstoxOptionChainError;

export function isUpstoxOptionChainError(
  result: UpstoxOptionChainResult,
): result is UpstoxOptionChainError {
  return "error" in result;
}

/**
 * What this app's own /api/upstox/future-quote route returns for one index future — reduced from Upstox's
 * `GET /v2/market-quote/quotes`. Live Portfolio prices a futures position from this, since a future has no row
 * in an option chain.
 */
export type UpstoxFutureQuoteSuccess = {
  instrumentKey: string;
  ltp: number;
  /** The previous session's close - the baseline for today's move. Null when Upstox's quote doesn't allow working it out. */
  prevClose: number | null;
  oi: number | null;
  volume: number | null;
};
export type UpstoxFutureQuoteError = { error: string; detail?: string };
export type UpstoxFutureQuoteResult = UpstoxFutureQuoteSuccess | UpstoxFutureQuoteError;

export function isUpstoxFutureQuoteError(result: UpstoxFutureQuoteResult): result is UpstoxFutureQuoteError {
  return "error" in result;
}

/**
 * Shape of Upstox's `POST /v2/charges/margin` request/response — the actual
 * SPAN + exposure margin blocked for a position, not just the premium value.
 * A sold option's margin is many times its premium; a bought option's is
 * roughly just the premium (`net_buy_premium`) — this is why Live
 * Portfolio's "Total Invested" tile calls this instead of `price * qty`.
 */
export type UpstoxMarginInstrumentRequest = {
  instrument_key: string;
  quantity: number;
  transaction_type: "BUY" | "SELL";
  /** "D" (carry-forward/NRML) — Live Portfolio positions are held, not intraday-squared. */
  product: "D" | "I" | "CO" | "MTF";
  price?: number;
};

export type UpstoxMarginLine = {
  span_margin?: number;
  exposure_margin?: number;
  equity_margin?: number;
  net_buy_premium?: number;
  additional_margin?: number;
  total_margin?: number;
  tender_margin?: number;
};

export type UpstoxMarginSuccess = {
  status: "success";
  data: {
    margins: UpstoxMarginLine[];
    required_margin: number;
    final_margin: number;
  };
};

/**
 * What this app's own /api/upstox/heatmap route returns — already reduced
 * from Upstox's `GET /v3/market-quote/ltp` (`last_price` + `cp`, the
 * previous close) and, for ranges longer than a day, its daily history, so
 * unlike the types above it isn't Upstox's own shape.
 */
export type HeatmapQuote = {
  /** NSE trading symbol, matching HeatmapStock.symbol. */
  symbol: string;
  price: number;
  /** Percent move over the requested range — null when there's nothing to compare against (e.g. not listed that far back). */
  changePct: number | null;
};

/** One of the three headline indices, measured over the same range as the tiles. */
export type IndexQuote = {
  instrument: Instrument;
  /** The index level. */
  price: number;
  /** Points moved over the range; null whenever `changePct` is. */
  change: number | null;
  changePct: number | null;
};

export type UpstoxHeatmapSuccess = { quotes: HeatmapQuote[]; indices: IndexQuote[] };
export type UpstoxHeatmapError = { error: string; detail?: string };
export type UpstoxHeatmapResult = UpstoxHeatmapSuccess | UpstoxHeatmapError;

export function isUpstoxHeatmapError(result: UpstoxHeatmapResult): result is UpstoxHeatmapError {
  return "error" in result;
}

/**
 * What this app's own /api/upstox/volatility route returns: how much one index has been moving, measured
 * from its daily closes over a few look-backs. Not Upstox's own shape - it is computed here from their history.
 */
export type UpstoxVolatilitySuccess = {
  instrument: Instrument;
  /** The date (yyyy-mm-dd) of the latest close used. */
  asOf: string;
  /** That close, i.e. the index level the figures are measured up to. */
  lastClose: number;
  /**
   * One entry per look-back that has enough history: `daily` (close to close) and `annual` are fractions
   * (0.008 = 0.8%); `intraday` is the same for the move from a session's open to its close, null when the
   * history has too few opens to measure it.
   */
  windows: { days: number; daily: number; annual: number; intraday: number | null }[];
};
export type UpstoxVolatilityError = { error: string };
export type UpstoxVolatilityResult = UpstoxVolatilitySuccess | UpstoxVolatilityError;

export function isUpstoxVolatilityError(result: UpstoxVolatilityResult): result is UpstoxVolatilityError {
  return "error" in result;
}

/** What /api/upstox/watchlist returns: a quote per instrument on the list, keyed by its `itemKey`; `missing` are the ones Upstox has no price for. */
export type UpstoxWatchlistSuccess = { quotes: Record<string, WatchQuote>; missing: string[] };
export type UpstoxWatchlistError = { error: string };
export type UpstoxWatchlistResult = UpstoxWatchlistSuccess | UpstoxWatchlistError;

export function isUpstoxWatchlistError(result: UpstoxWatchlistResult): result is UpstoxWatchlistError {
  return "error" in result;
}

/** What /api/upstox/instrument-search returns, grouped the way the Add popup shows it. */
export type InstrumentSearchSuccess = { results: { indices: WatchSearchResult[]; commodities: WatchSearchResult[]; stocks: WatchSearchResult[] } };
export type InstrumentSearchResult = InstrumentSearchSuccess | { error: string };

export type UpstoxMarginError = { error: string; detail?: string };
export type UpstoxMarginResult = UpstoxMarginSuccess | UpstoxMarginError;

export function isUpstoxMarginError(result: UpstoxMarginResult): result is UpstoxMarginError {
  return "error" in result;
}

/**
 * One open (or squared-off-today) index or commodity option position, or index future, as this app's own
 * /api/upstox/positions route returns it — reduced from Upstox's
 * `GET /v2/portfolio/short-term-positions` and already matched to its
 * contract, so unlike Upstox's own shape it carries strike/CE-PE/expiry
 * rather than an opaque instrument token. Both products (NRML and intraday)
 * of one contract are merged into a single position.
 */
export type UpstoxPosition = {
  instrumentKey: string;
  instrument: Instrument;
  /** Null for a future - which has no strike and no CE/PE, only the expiry of its contract month. */
  strike: number | null;
  optionType: TradeEntryOptionType | null;
  /** yyyy-mm-dd. */
  expiry: string;
  /** Units in a lot. Quantities below are in units too - MCX positions are reduced to that (Upstox counts them in lots). */
  lotSize: number;
  /** Signed: positive long, negative short, 0 once squared off today. */
  quantity: number;
  /** Signed quantity carried in from the previous session. */
  overnightQuantity: number;
  /** Average price of the open quantity — null once flat. */
  averagePrice: number | null;
  /** Everything bought / sold in this position, carried-in quantity included — what Upstox's own positions screen averages. */
  buyQuantity: number;
  buyValue: number;
  sellQuantity: number;
  sellValue: number;
  dayBuyQuantity: number;
  dayBuyValue: number;
  daySellQuantity: number;
  daySellValue: number;
  lastPrice: number | null;
  /** The previous session's close — what a carried position's day P&L is measured from. */
  closePrice: number | null;
  /** When the still-open quantity was first traded (yyyy-mm-dd) — null when it opened today or the trade history couldn't say. */
  openedOn: string | null;
};

export type UpstoxPositionsSuccess = {
  positions: UpstoxPosition[];
  /** Positions in anything other than Nifty / Bank Nifty / Sensex options and futures or MCX crude oil / gold / natural gas options (stocks, other indices, other commodities' futures) — left out. */
  otherCount: number;
};
export type UpstoxPositionsError = { error: string; detail?: string };
export type UpstoxPositionsResult = UpstoxPositionsSuccess | UpstoxPositionsError;

export function isUpstoxPositionsError(result: UpstoxPositionsResult): result is UpstoxPositionsError {
  return "error" in result;
}

/**
 * One closed round trip from Upstox's trade-wise P&L report
 * (`GET /v2/trade/profit-loss/data`), as /api/upstox/pnl-report returns it.
 * Upstox lists a row per matched fill (a 3-lot exit is three rows); rows of
 * one contract opened and closed on the same pair of dates are merged into
 * one trade here, the way the Trade Entries journal records them.
 */
export type UpstoxClosedTrade = {
  /** Stable within a report: instrument | expiry | strike | type | buy date | sell date. */
  key: string;
  instrument: Instrument;
  /** Null for a futures trade. */
  strike: number | null;
  optionType: TradeEntryOptionType | null;
  /** Null only for a future whose expiry neither the report (which doesn't name one) nor the trade history could supply. */
  expiry: string | null;
  side: TradeEntrySide;
  /** The earlier of the buy and sell dates. */
  entryDate: string;
  closingDate: string;
  quantity: number;
  lots: number;
  buyPrice: number;
  sellPrice: number;
  /** Sell amount minus buy amount, before charges — exact, whatever the lot size was at the time. */
  pnl: number;
};

export type UpstoxPnlReportSuccess = {
  /** yyyy-mm-dd bounds of the financial year the report covers. */
  from: string;
  to: string;
  trades: UpstoxClosedTrade[];
  /** Round trips in anything other than the three indices and MCX crude oil / gold / natural gas, left out — with their names for the summary. */
  otherCount: number;
  otherNames: string[];
  /**
   * Sell minus buy over every row of the F&O and MCX reports, the left-out
   * underlyings included — the same scope as `charges`, so the two can be
   * netted against each other. `trades` alone would leave the stock options'
   * P&L out while their charges stayed in.
   */
  grossPnl: number;
  /** Upstox's own charges (brokerage, STT, GST, stamp duty, …) for the year — null if they couldn't be fetched. */
  charges: UpstoxChargesBreakdown | null;
};
export type UpstoxPnlReportError = { error: string; detail?: string };
export type UpstoxPnlReportResult = UpstoxPnlReportSuccess | UpstoxPnlReportError;

export function isUpstoxPnlReportError(result: UpstoxPnlReportResult): result is UpstoxPnlReportError {
  return "error" in result;
}

/** The P&L report segments Reports offers, in Upstox's own codes. COM is MCX commodities. */
export const UPSTOX_PNL_SEGMENTS = ["FO", "COM", "EQ"] as const;
export type UpstoxPnlSegment = (typeof UPSTOX_PNL_SEGMENTS)[number];

export const UPSTOX_PNL_SEGMENT_LABELS: Record<UpstoxPnlSegment, string> = {
  FO: "F&O",
  COM: "MCX",
  EQ: "Equity",
};

/**
 * The segments whose trades the journal records - index options and futures, and MCX crude oil / gold / natural gas. Trade Entries'
 * sync reads the report of each; equity trades have no place in a derivatives journal.
 */
export const JOURNAL_PNL_SEGMENTS = ["FO", "COM"] as const satisfies readonly UpstoxPnlSegment[];

/**
 * What Reports can be pointed at: one report segment, or "ALL" - F&O and MCX added together, the derivatives a trader of
 * this app follows. Equity is its own segment, off by default.
 */
export const UPSTOX_SUMMARY_SCOPES = ["ALL", ...UPSTOX_PNL_SEGMENTS] as const;
export type UpstoxSummaryScope = (typeof UPSTOX_SUMMARY_SCOPES)[number];

export const UPSTOX_SUMMARY_SCOPE_LABELS: Record<UpstoxSummaryScope, string> = { ALL: "F&O + MCX", ...UPSTOX_PNL_SEGMENT_LABELS };

/** The report segments a scope covers. */
export function segmentsOfScope(scope: UpstoxSummaryScope): readonly UpstoxPnlSegment[] {
  return scope === "ALL" ? JOURNAL_PNL_SEGMENTS : [scope];
}

/** Upstox's own charges for a period, as /api/upstox/pnl-report and pnl-charges return them. */
export type UpstoxChargesBreakdown = {
  total: number;
  brokerage: number;
  gst: number;
  stt: number;
  stampDuty: number;
  /** Exchange transaction charges plus SEBI turnover fees — Upstox's API reports them as one figure. */
  transactionAndSebi: number;
  clearing: number;
  ipft: number;
  demat: number;
};

/**
 * One row of Upstox's trade-wise P&L report, read as a trade (see lib/upstox/reportTrades.ts). snake_case so that it has the
 * shape of a journal entry and the Reports maths reads both. Money is as reported; `pnl` is sell minus buy, before charges.
 */
export type UpstoxReportTrade = {
  id: string;
  segment: UpstoxPnlSegment;
  /** The underlying - "NIFTY", "FINNIFTY", a stock's name - not an instrument the journal necessarily tracks. */
  instrument: string;
  /** "NIFTY 25400 PE", "NIFTY FUT", or an equity's name. */
  label: string;
  strike_price: number | null;
  option_type: TradeEntryOptionType | null;
  expiry_date: string | null;
  /** yyyy-mm-dd - the earlier of the buy and sell dates. */
  entry_date: string;
  /** yyyy-mm-dd - the later of the two, the day Upstox files the trade under. */
  closing_date: string;
  /** Null when bought and sold the same day: the report doesn't say which came first. */
  side: TradeEntrySide | null;
  /** As the report counts it: units for the indices and equity, lots for MCX. */
  quantity: number;
  buy_price: number;
  sell_price: number;
  buy_amount: number;
  sell_amount: number;
  pnl: number;
  status: "squared_off";
  /** Only orders trades of the same day. */
  created_at: string;
};

/** Every row of the last three financial years' reports, all segments - what /api/upstox/pnl-trades returns. */
export type UpstoxPnlTradesSuccess = {
  /** yyyy-mm-dd - the first day covered (the start of the earliest financial year read). */
  from: string;
  trades: UpstoxReportTrade[];
  /** ms since epoch. */
  fetchedAt: number;
};
export type UpstoxPnlTradesError = { error: string; detail?: string };
export type UpstoxPnlTradesResult = UpstoxPnlTradesSuccess | UpstoxPnlTradesError;

export function isUpstoxPnlTradesError(result: UpstoxPnlTradesResult): result is UpstoxPnlTradesError {
  return "error" in result;
}

/** Upstox's charges for one scope and date range, by the date each trade closed - what /api/upstox/pnl-charges returns. */
export type UpstoxPnlCharges = {
  scope: UpstoxSummaryScope;
  from: string;
  to: string;
  charges: UpstoxChargesBreakdown;
};
export type UpstoxPnlChargesError = { error: string; detail?: string };
export type UpstoxPnlChargesResult = UpstoxPnlCharges | UpstoxPnlChargesError;

export function isUpstoxPnlChargesError(result: UpstoxPnlChargesResult): result is UpstoxPnlChargesError {
  return "error" in result;
}
