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

export type UpstoxMarginError = { error: string; detail?: string };
export type UpstoxMarginResult = UpstoxMarginSuccess | UpstoxMarginError;

export function isUpstoxMarginError(result: UpstoxMarginResult): result is UpstoxMarginError {
  return "error" in result;
}

/**
 * One open (or squared-off-today) index option position, as this app's own
 * /api/upstox/positions route returns it — reduced from Upstox's
 * `GET /v2/portfolio/short-term-positions` and already matched to its
 * contract, so unlike Upstox's own shape it carries strike/CE-PE/expiry
 * rather than an opaque instrument token. Both products (NRML and intraday)
 * of one contract are merged into a single position.
 */
export type UpstoxPosition = {
  instrumentKey: string;
  instrument: Instrument;
  strike: number;
  optionType: TradeEntryOptionType;
  /** yyyy-mm-dd. */
  expiry: string;
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
  /** Positions in anything other than Nifty / Bank Nifty / Sensex options (stocks, futures, other indices) — left out. */
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
  expiry: string;
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
  /** Round trips in anything other than the three indices, left out — with their names for the summary. */
  otherCount: number;
  otherNames: string[];
  /**
   * Sell minus buy over every row of the report, the left-out underlyings
   * included — the same scope as `charges`, so the two can be netted against
   * each other. `trades` alone would leave the stock options' P&L out while
   * their charges stayed in.
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

/** The P&L report segments Reports offers, in Upstox's own codes. */
export const UPSTOX_PNL_SEGMENTS = ["FO", "EQ"] as const;
export type UpstoxPnlSegment = (typeof UPSTOX_PNL_SEGMENTS)[number];

export const UPSTOX_PNL_SEGMENT_LABELS: Record<UpstoxPnlSegment, string> = {
  FO: "F&O",
  EQ: "Equity",
};

/** Upstox's own charges for a period, as /api/upstox/pnl-report and pnl-summary return them. */
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
 * Upstox's "Trade summary" for one segment and date range, as
 * /api/upstox/pnl-summary returns it — totals over every row of that
 * segment's P&L report (for F&O, stock options included, the same as Upstox's
 * own screen). Counted per row like Upstox does, so a 3-lot exit is three
 * trades.
 */
export type UpstoxPnlSummary = {
  segment: UpstoxPnlSegment;
  /** yyyy-mm-dd — the range Upstox was asked for, by the date each trade closed. */
  from: string;
  to: string;
  tradeCount: number;
  winningCount: number;
  grossPnl: number;
  /** Sum of the winning rows' P&L. */
  winningPnl: number;
  /** Sum of the losing rows' P&L — negative. */
  losingPnl: number;
  /** Total bought — the base of Upstox's ROI %. */
  buyValue: number;
  charges: UpstoxChargesBreakdown;
};
export type UpstoxPnlSummaryError = { error: string; detail?: string };
export type UpstoxPnlSummaryResult = UpstoxPnlSummary | UpstoxPnlSummaryError;

export function isUpstoxPnlSummaryError(result: UpstoxPnlSummaryResult): result is UpstoxPnlSummaryError {
  return "error" in result;
}
