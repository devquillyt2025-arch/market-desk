/**
 * Realized volatility from a run of closing prices - how much a market has actually been moving, day
 * to day. Pure and independent of where the closes came from. The RRR planner uses it to judge whether
 * a stop and a target are sized sensibly for the market they are placed in.
 *
 * Volatility here is the standard deviation of daily log returns: 0.8% means a typical day moves the
 * price by about 0.8% either way. Annualizing multiplies by the square root of the trading days in a year.
 */

/** Sessions in an Indian market year, give or take - what an annual figure is scaled by. */
export const TRADING_DAYS = 252;

/** The look-backs on offer: about a month, a quarter and a year of sessions. */
export const VOLATILITY_WINDOWS = [20, 60, 250] as const;

/** Fewest daily returns a figure may rest on; fewer than this says nothing useful. */
const MIN_RETURNS = 5;

export type Volatility = {
  /** Sessions the figure is measured over. */
  days: number;
  /** Standard deviation of one day's log return, as a fraction: 0.008 is 0.8%. */
  daily: number;
  /** The same, scaled to a year, as a fraction: 0.127 is 12.7%. */
  annual: number;
};

/** ln(today ÷ yesterday) for each pair of consecutive closes; pairs with a missing or non-positive price are skipped. */
export function logReturns(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1];
    const next = closes[i];
    if (prev > 0 && next > 0 && Number.isFinite(prev) && Number.isFinite(next)) out.push(Math.log(next / prev));
  }
  return out;
}

/** Volatility over the most recent `days` sessions, oldest-first closes in; null when there isn't that much history to measure. */
export function realizedVolatility(closes: number[], days: number): Volatility | null {
  const returns = logReturns(closes);
  if (days < MIN_RETURNS || returns.length < days) return null;
  const recent = returns.slice(-days);
  const mean = recent.reduce((a, r) => a + r, 0) / days;
  const variance = recent.reduce((a, r) => a + (r - mean) ** 2, 0) / (days - 1);
  const daily = Math.sqrt(variance);
  return { days, daily, annual: daily * Math.sqrt(TRADING_DAYS) };
}

/** One completed session's prices: what an intraday trade lives through is the move from the open to the close. */
export type Session = { open: number | null; close: number };

/**
 * Volatility of a session from open to close - how far the market moves inside a day, without the gap
 * between yesterday's close and today's open that an intraday trade never holds through. It is
 * the standard deviation of ln(close ÷ open) over the most recent `days` sessions, as a fraction of a
 * session's move. Null when too few of them have an open to measure.
 */
export function intradayVolatility(sessions: Session[], days: number): number | null {
  if (days < MIN_RETURNS) return null;
  const moves = sessions
    .slice(-days)
    .flatMap((s) => (s.open !== null && s.open > 0 && s.close > 0 && Number.isFinite(s.open) && Number.isFinite(s.close) ? [Math.log(s.close / s.open)] : []));
  if (moves.length < MIN_RETURNS) return null;
  const mean = moves.reduce((a, m) => a + m, 0) / moves.length;
  const variance = moves.reduce((a, m) => a + (m - mean) ** 2, 0) / (moves.length - 1);
  return Math.sqrt(variance);
}

/** An annual volatility typed as a percentage (12.7) as the fraction of a day's move it implies (0.008). */
export function dailyFromAnnualPct(annualPct: number): number {
  return annualPct / 100 / Math.sqrt(TRADING_DAYS);
}
