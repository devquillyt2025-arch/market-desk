/**
 * How far an index future trades above the index, and how much of that is expected to go in a day. Pure - no React, no network.
 *
 * A future is priced above the index by the cost of carrying it to expiry (interest, less dividends), and that premium - the
 * "basis" - is worth nothing on the day the future expires: it shrinks to zero. The fair premium is roughly proportional to the
 * time left, so the model here is a straight line: today's premium, spread evenly over the calendar days to expiry. That gives the
 * expected shrink per day, and so what a held future gains (short) or pays (long) each day the index itself doesn't move.
 *
 * It is a drift, not a forecast. The premium also moves with interest rates, dividends and sentiment, so the real one wobbles
 * around this line; and it says nothing about which way the index goes - that moves a future by far more than the carry.
 * (The Risk tab holds the premium where it is, and the Analysis page lets it close linearly - this is the same line the latter uses.)
 */

import { isFutureEntry, type PortfolioRow } from "@/lib/calculatePortfolio";
import { futureBasis } from "@/lib/calculateRisk";
import { expiryCloseMs } from "@/lib/calculateStrategy";
import { DEFAULT_LOT_SIZES, isCommodityInstrument, type Instrument } from "@/lib/types";

const MS_PER_DAY = 86_400_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;

export type FutureCarry = {
  /** One per instrument and expiry: several rows of the same contract are one position here. */
  key: string;
  instrument: Instrument;
  /** The contract's expiry date, YYYY-MM-DD. */
  expiry: string;
  expiryMs: number;
  /** Contracts held net: positive long, negative short, zero when a long and a short cancel. */
  netLots: number;
  /** The same in units (lots x the lot size). */
  netQty: number;
  future: number;
  spot: number;
  /** The future's price less the index: positive is a premium, negative a discount. */
  basis: number;
  /** The basis as a percentage of the index. */
  basisPct: number;
  /** Calendar days from the moment of the prices to the expiry's close (15:30 IST). */
  daysLeft: number;
  /** The basis annualised (basisPct x 365 / daysLeft): what the market is charging a year for carry. Null in the last day, where it means nothing. */
  annualisedPct: number | null;
  /** The prices are the last ones seen before live pricing dropped, not current. */
  stale: boolean;
  /** When stale prices were fetched (ms since epoch), else null. */
  asOf: number | null;
};

export type FutureCarryUnavailable = {
  key: string;
  instrument: Instrument;
  expiry: string;
  /** `no_price`: the future's own price hasn't arrived. `no_index`: it has, but the option chain of its expiry (the index level) hasn't. */
  reason: "no_price" | "no_index";
};

export function isFutureCarry(item: FutureCarry | FutureCarryUnavailable): item is FutureCarry {
  return "basis" in item;
}

/**
 * The premium that goes in `days` days: today's, spread evenly over the days left, and all of it in the last day. The same sign as
 * the basis - positive means a premium shrinking, negative a discount narrowing.
 */
export function shrinkOver(carry: Pick<FutureCarry, "basis" | "daysLeft">, days: number): number {
  if (!(carry.daysLeft > 0)) return carry.basis;
  return carry.basis * Math.min(1, days / carry.daysLeft);
}

/**
 * What the position makes (or loses) over `days` days if the index doesn't move: the future moves against the index by `shrinkOver`,
 * so a long pays the premium shrinking and a short collects it. In rupees, for the net units held.
 */
export function carryPnl(carry: Pick<FutureCarry, "basis" | "daysLeft" | "netQty">, days: number): number {
  return -carry.netQty * shrinkOver(carry, days);
}

/**
 * The future's expected price `days` on, if the index stays where it is: its price less the premium that went. (The premium is the
 * only thing that moves it in that case.)
 */
export function expectedFuture(carry: Pick<FutureCarry, "future" | "basis" | "daysLeft">, days: number): number {
  return carry.future - shrinkOver(carry, days);
}

/**
 * Carry builds up by calendar day, weekends included, so Friday's close to Monday's is three days of it. `when` says which side of the
 * weekend the moment is on: a Monday has had it since Friday's close, anything from Friday on will have it by Monday's. Null in midweek.
 */
export function weekendCarry(nowMs: number): { days: number; when: "since" | "until" } | null {
  const weekday = new Date(nowMs + IST_OFFSET_MS).getUTCDay(); // 0 Sunday .. 6 Saturday, in India
  if (weekday === 1) return { days: 3, when: "since" };
  if (weekday === 5 || weekday === 6 || weekday === 0) return { days: 3, when: "until" };
  return null;
}

/**
 * The index futures in the portfolio, one per contract, each with its premium over the index and the days to run - or the reason
 * one can't be worked out yet. `nowMs` is the moment of the prices (the last poll), not the clock. A future past its expiry is left out,
 * and so is a commodity's: its options are written on the future itself, so there is no index for it to trade above.
 */
export function buildFutureCarries(rows: readonly PortfolioRow[], nowMs: number): (FutureCarry | FutureCarryUnavailable)[] {
  const groups = new Map<string, PortfolioRow[]>();
  for (const row of rows) {
    if (!isFutureEntry(row.entry) || isCommodityInstrument(row.entry.instrument)) continue;
    const key = `${row.entry.instrument}|${row.entry.expiry_date}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  const out: (FutureCarry | FutureCarryUnavailable)[] = [];
  for (const [key, group] of groups) {
    const { instrument, expiry_date: expiry } = group[0].entry;
    if (expiry === null) continue;
    const expiryMs = expiryCloseMs(expiry, instrument);
    if (!(expiryMs > nowMs)) continue;

    const priced = group.find((row) => row.status === "ok" && row.liveLtp !== null && futureBasis(row) !== null);
    if (!priced) {
      out.push({ key, instrument, expiry, reason: group.some((row) => row.status === "ok" && row.liveLtp !== null) ? "no_index" : "no_price" });
      continue;
    }

    const future = priced.liveLtp as number;
    const spot = priced.underlyingSpot as number;
    const basis = future - spot;
    const daysLeft = (expiryMs - nowMs) / MS_PER_DAY;
    const basisPct = (basis / spot) * 100;
    const netLots = group.reduce((lots, row) => lots + (row.entry.side === "sell" ? -row.entry.lots : row.entry.lots), 0);
    out.push({
      key,
      instrument,
      expiry,
      expiryMs,
      netLots,
      netQty: netLots * DEFAULT_LOT_SIZES[instrument],
      future,
      spot,
      basis,
      basisPct,
      daysLeft,
      annualisedPct: daysLeft >= 1 ? (basisPct * 365) / daysLeft : null,
      stale: priced.stale,
      asOf: priced.asOf,
    });
  }
  return out.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.instrument.localeCompare(b.instrument));
}
