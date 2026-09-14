/**
 * Shape of Upstox's `GET /v2/option/chain` response — the fields below were
 * checked against a real live response and match. Upstox's actual payload
 * carries a few more fields than are modeled here (e.g. bid/ask price and
 * qty, close_price, prev_oi, pop) that this app doesn't currently use;
 * they're simply left untyped rather than omitted for any correctness
 * reason. Every field is still read defensively (optional chaining, never
 * assumed present) — if Upstox ever changes a field name, `findLeg` in
 * calculatePortfolio.ts degrades to "no data for this row" rather than
 * throwing.
 */

export type UpstoxOptionGreeks = {
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  iv?: number;
};

export type UpstoxMarketData = {
  ltp?: number;
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
