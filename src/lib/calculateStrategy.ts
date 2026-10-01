/**
 * Pure math behind the Analysis tab's strategy builder. No React, no
 * fetching — takes a set of option legs (side, strike, expiry, lots, entry
 * price) plus the underlying's spot and produces the payoff curves, Greeks
 * and headline numbers.
 *
 * Model, stated plainly: Black-Scholes with a zero rate (matching
 * calculateRisk.ts) and one flat volatility per leg. Each leg uses the
 * chain's own IV for its strike; where that's missing it is solved from the
 * price entered, then falls back to a flat 15%. The entered price is only the
 * cost basis for P&L. The "On Expiry" curve is taken at the *earliest* leg
 * expiry (later-dated legs are still valued by Black-Scholes at that moment,
 * as a calendar spread needs); the "On Target Date" curve is the same
 * portfolio valued at any chosen earlier moment. POP uses the zero-drift
 * lognormal at the earliest expiry and excludes brokerage — a market-implied
 * estimate, not a forecast.
 */

import { impliedVolFromPrice, normCdf, normalizeIv } from "@/lib/calculateRisk";
import type { Instrument } from "@/lib/types";

const MS_PER_DAY = 86_400_000;
const YEAR_MS = 365 * MS_PER_DAY;
const IST_OFFSET_MS = 5.5 * 3_600_000;
const FALLBACK_IV = 0.15;
const EXTREMES_STEPS = 1200;
const POP_STEPS = 240;
const POP_HALF_WIDTH_Z = 6;
const MIN_SD_PCT = 0.02;

export type LegSide = "buy" | "sell";
export type LegType = "CE" | "PE";

export type StrategyLeg = {
  id: string;
  enabled: boolean;
  side: LegSide;
  type: LegType;
  strike: number;
  /** ISO yyyy-mm-dd. */
  expiry: string;
  lots: number;
  /** Entry price per unit (₹). */
  price: number;
  /** Implied vol (percent, as Upstox reports it) for this strike — the fallback when the entered price can't be inverted. */
  chainIv: number | null;
};

export type PricedLeg = StrategyLeg & {
  sign: 1 | -1;
  qty: number;
  sigma: number;
  closeMs: number;
};

export type Greeks = { delta: number; gamma: number; theta: number; vega: number };

export type StrategyMetrics = {
  /** ₹, null = unlimited. */
  maxProfit: number | null;
  maxLoss: number | null;
  breakevens: number[];
  /** 0–1, null when it can't be computed. */
  pop: number | null;
  /** ₹, positive = net credit received, negative = net debit paid. */
  netPremium: number;
  expiryMs: number;
  /** One-sigma move (fraction of spot) from now to the earliest expiry. */
  sdPct: number;
};

// --- Dates ----------------------------------------------------------------

export function expiryCloseMs(iso: string): number {
  return Date.parse(`${iso}T15:30:00+05:30`);
}

export function istDateString(ms: number): string {
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_PER_DAY);
}

export function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/**
 * The next `count` weekly expiry dates, soonest first: Sensex expires on
 * Thursdays, the NSE indices on Tuesdays. On expiry day itself, once the 15:30
 * close has passed, that day no longer counts. A stand-in for the real list
 * from Upstox (Bank Nifty, for one, only lists monthlies).
 */
export function upcomingWeeklyExpiries(todayIso: string, instrument: Instrument, nowMs: number, count = 8): string[] {
  const target = instrument === "SENSEX" ? 4 : 2;
  const dow = new Date(`${todayIso}T00:00:00Z`).getUTCDay();
  const gap = (target - dow + 7) % 7;
  const first = addDays(todayIso, gap === 0 && nowMs >= expiryCloseMs(todayIso) ? 7 : gap);
  return Array.from({ length: count }, (_, i) => addDays(first, i * 7));
}

// --- Black-Scholes --------------------------------------------------------

const pdf = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI);

type BsResult = Greeks & { price: number };

/** Zero-rate Black-Scholes. Theta is per calendar day, vega per 1 vol-point. */
function blackScholes(spot: number, strike: number, t: number, sigma: number, isCall: boolean): BsResult {
  const intrinsic = isCall ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  if (!(t > 0) || !(sigma > 0) || !(spot > 0)) {
    const itm = isCall ? spot > strike : spot < strike;
    return { price: intrinsic, delta: itm ? (isCall ? 1 : -1) : 0, gamma: 0, theta: 0, vega: 0 };
  }
  const sd = sigma * Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (sd * sd) / 2) / sd;
  const d2 = d1 - sd;
  const price = isCall ? spot * normCdf(d1) - strike * normCdf(d2) : strike * normCdf(-d2) - spot * normCdf(-d1);
  return {
    price,
    delta: isCall ? normCdf(d1) : normCdf(d1) - 1,
    gamma: pdf(d1) / (spot * sd),
    theta: (-(spot * pdf(d1) * sigma) / (2 * Math.sqrt(t))) / 365,
    vega: (spot * pdf(d1) * Math.sqrt(t)) / 100,
  };
}

// --- Legs -----------------------------------------------------------------

/** Enabled legs with a quantity, sign and the vol used to value them. */
export function priceLegs(legs: StrategyLeg[], spot: number, nowMs: number, lotSize: number): PricedLeg[] {
  return legs
    .filter((l) => l.enabled && l.lots > 0 && l.strike > 0 && l.price >= 0)
    .map((l) => {
      const closeMs = expiryCloseMs(l.expiry);
      const t = Math.max(closeMs - nowMs, 0) / YEAR_MS;
      const chain = l.chainIv != null && l.chainIv > 0 ? normalizeIv(l.chainIv) : null;
      // The market's vol values the option today; the entered price is only the cost basis. Solving vol
      // from the entered price would make an old position look like it was just opened at today's spot.
      const solved = chain === null ? impliedVolFromPrice(spot, l.strike, t, l.price, l.type === "CE") : null;
      return {
        ...l,
        sign: l.side === "buy" ? 1 : -1,
        qty: l.lots * lotSize,
        sigma: chain ?? solved ?? FALLBACK_IV,
        closeMs,
      };
    });
}

function legValue(leg: PricedLeg, spot: number, atMs: number): BsResult {
  return blackScholes(spot, leg.strike, (leg.closeMs - atMs) / YEAR_MS, leg.sigma, leg.type === "CE");
}

/** ₹ P&L of the whole strategy if the underlying is at `spot` at time `atMs`. */
export function strategyPnl(legs: PricedLeg[], spot: number, atMs: number): number {
  let total = 0;
  for (const leg of legs) total += leg.sign * (legValue(leg, spot, atMs).price - leg.price) * leg.qty;
  return total;
}

/** Net Greeks (position-signed, ×quantity) at a spot and moment. */
export function strategyGreeks(legs: PricedLeg[], spot: number, atMs: number): Greeks {
  const sum: Greeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of legs) {
    const g = legValue(leg, spot, atMs);
    const k = leg.sign * leg.qty;
    sum.delta += g.delta * k;
    sum.gamma += g.gamma * k;
    sum.theta += g.theta * k;
    sum.vega += g.vega * k;
  }
  return sum;
}

export function legGreeks(leg: PricedLeg, spot: number, atMs: number): Greeks {
  const g = legValue(leg, spot, atMs);
  const k = leg.sign * leg.qty;
  return { delta: g.delta * k, gamma: g.gamma * k, theta: g.theta * k, vega: g.vega * k };
}

export function earliestExpiryMs(legs: PricedLeg[]): number | null {
  return legs.length ? Math.min(...legs.map((l) => l.closeMs)) : null;
}

// --- Headline numbers -----------------------------------------------------

/** Best/worst P&L at the earliest expiry, break-evens, POP and net premium. Null for an empty strategy. */
export function analyzeStrategy(legs: PricedLeg[], spot: number, nowMs: number): StrategyMetrics | null {
  const expiryMs = earliestExpiryMs(legs);
  if (expiryMs === null || !(spot > 0)) return null;

  const netPremium = legs.reduce((acc, l) => acc - l.sign * l.price * l.qty, 0);

  // P&L is piecewise-smooth with kinks at strikes, so a dense grid that also
  // includes every strike finds both extremes; the net call slope past the
  // top says whether either side is unbounded (puts are bounded below by 0).
  const hi = spot * 3;
  const grid: number[] = [];
  for (let i = 0; i <= EXTREMES_STEPS; i++) grid.push((hi * i) / EXTREMES_STEPS);
  for (const l of legs) grid.push(l.strike);
  grid.sort((a, b) => a - b);
  const values = grid.map((s) => strategyPnl(legs, s, expiryMs));

  const callSlope = legs.reduce((acc, l) => acc + (l.type === "CE" ? l.sign * l.qty : 0), 0);
  const maxProfit = callSlope > 0 ? null : Math.max(...values, 0);
  const maxLoss = callSlope < 0 ? null : Math.max(-Math.min(...values), 0);

  const breakevens: number[] = [];
  for (let i = 1; i < grid.length; i++) {
    const a = values[i - 1];
    const b = values[i];
    if ((a < 0 && b > 0) || (a > 0 && b < 0)) {
      breakevens.push(grid[i - 1] + ((grid[i] - grid[i - 1]) * (0 - a)) / (b - a));
    }
  }
  const uniqueBreakevens = breakevens.filter((v, i) => i === 0 || Math.abs(v - breakevens[i - 1]) > spot * 1e-4);

  // POP: lognormal at the earliest expiry, vol taken from the leg nearest
  // the money among those that still have time value.
  const T = Math.max(expiryMs - nowMs, 0) / YEAR_MS;
  const live = legs.filter((l) => l.closeMs > nowMs);
  const ref = live.length ? live.reduce((best, l) => (Math.abs(l.strike - spot) < Math.abs(best.strike - spot) ? l : best)) : null;
  const sd = ref ? ref.sigma * Math.sqrt(T) : 0;
  let pop: number | null = null;
  if (sd > 0) {
    let w = 0;
    let win = 0;
    for (let i = 0; i <= POP_STEPS; i++) {
      const z = -POP_HALF_WIDTH_Z + (2 * POP_HALF_WIDTH_Z * i) / POP_STEPS;
      const weight = Math.exp((-z * z) / 2);
      w += weight;
      if (strategyPnl(legs, spot * Math.exp(-(sd * sd) / 2 + sd * z), expiryMs) > 0) win += weight;
    }
    pop = win / w;
  } else {
    pop = strategyPnl(legs, spot, expiryMs) > 0 ? 1 : 0;
  }

  return {
    maxProfit,
    maxLoss,
    breakevens: uniqueBreakevens,
    pop,
    netPremium,
    expiryMs,
    sdPct: Math.max(sd, 0),
  };
}

// --- Chart helpers --------------------------------------------------------

/** Spot range worth drawing: wide enough for the strikes and a couple of standard deviations either side. */
export function chartDomain(legs: PricedLeg[], spot: number, sdPct: number): [number, number] {
  const half = spot * Math.max(sdPct, MIN_SD_PCT) * 2.5;
  const strikes = legs.map((l) => l.strike);
  const pad = spot * 0.02;
  const lo = Math.min(spot - half, ...strikes.map((k) => k - pad));
  const hi = Math.max(spot + half, ...strikes.map((k) => k + pad));
  return [Math.max(lo, spot * 0.2), hi];
}

export type CurvePoint = { spot: number; expiry: number; target: number };

export function sampleCurves(
  legs: PricedLeg[],
  domain: [number, number],
  expiryMs: number,
  targetMs: number,
  steps = 160,
): CurvePoint[] {
  const points: CurvePoint[] = [];
  const [lo, hi] = domain;
  // Strikes are added as samples so the expiry curve's kinks are drawn sharp.
  const xs = new Set<number>();
  for (let i = 0; i <= steps; i++) xs.add(lo + ((hi - lo) * i) / steps);
  for (const l of legs) if (l.strike > lo && l.strike < hi) xs.add(l.strike);
  for (const x of [...xs].sort((a, b) => a - b)) {
    points.push({ spot: x, expiry: strategyPnl(legs, x, expiryMs), target: strategyPnl(legs, x, targetMs) });
  }
  return points;
}

/** The moment `dayIndex` days from today: now for 0, the expiry close for the last day, 15:30 IST otherwise. */
export function targetMomentMs(dayIndex: number, totalDays: number, nowMs: number, expiryMs: number): number {
  if (dayIndex <= 0) return nowMs;
  if (dayIndex >= totalDays) return expiryMs;
  return expiryCloseMs(addDays(istDateString(nowMs), dayIndex));
}
