/**
 * Pure math behind Live Portfolio's Averaging Simulator. No React, no
 * fetching, no storage — read-only: it only ever answers "what if I bought N
 * more lots at this price?" and never places anything.
 *
 * Nothing here re-derives option maths. Every P&L, Greek, break-even and POP
 * figure comes from calculateStrategy.ts — the engine behind the Analysis tab
 * — fed the same legs Analysis would receive: the existing position as one leg
 * at its average price, and the simulated purchase as a second leg at the
 * simulated price. That is what keeps the drawer and "Open in Analysis" on
 * identical numbers. What lives here is only what that engine doesn't offer:
 * the blended average, the spot move that zeroes the P&L, the lots table, the
 * ladder and the warnings.
 *
 * Model, as in calculateStrategy: zero-rate Black-Scholes with the strike's
 * own IV, P&L before brokerage. Theta is ₹ per calendar day. "Tomorrow" is
 * 15:30 IST the next calendar day, the same moment the Analysis date slider
 * uses.
 */

import type { RiskWarning } from "@/lib/calculateRisk";
import {
  analyzeStrategy,
  chartDomain,
  daysBetween,
  expiryCloseMs,
  istDateString,
  priceLegs,
  strategyGreeks,
  strategyPnl,
  targetMomentMs,
  type LegType,
  type PricedLeg,
  type StrategyLeg,
} from "@/lib/calculateStrategy";
import type { PortfolioRow } from "@/lib/calculatePortfolio";
import type { SavedAnalysis } from "@/lib/savedAnalysis";
import type { DraftLeg } from "@/lib/strategyTransfer";
import { DEFAULT_LOT_SIZES, type Instrument } from "@/lib/types";

// --- Tunables -----------------------------------------------------------------

/** Warn when one more lot lowers the average by less than this fraction (0.5%). */
export const MARGINAL_IMPROVEMENT = 0.005;
/** Expiry this many calendar days away or closer is theta-heavy. */
export const THETA_HEAVY_DTE = 5;
/** Default share of funds the premium paid may reach before warning; editable in the drawer. */
export const DEFAULT_RISK_LIMIT_PCT = 25;
/** NSE/BSE option tick — a locked price is "moved" once the live price differs by at least one tick. */
export const PRICE_TICK = 0.05;
/** Rows shown in the lots table at most. */
export const MAX_TABLE_LOTS = 200;
/** Flag when the model's value for the option differs from its LTP by more than this fraction. */
export const MODEL_GAP_WARN = 0.05;
/** Rows shown when no funds are entered, so there is no affordable maximum to stop at. */
export const UNSET_FUNDS_TABLE_LOTS = 10;

/** Index points between ladder rows — Nifty ±300 in 50s; the wider indices scale with their strike spacing. */
export const LADDER_STEP: Record<Instrument, number> = { NIFTY: 50, BANKNIFTY: 100, SENSEX: 100 };
const LADDER_HALF_STEPS = 6;

const BRACKET_LOW = 0.2;
const BRACKET_HIGH = 3;
const ROOT_ITERATIONS = 100;
const ROOT_TOLERANCE = 1e-6;
const IST_OFFSET_MS = 5.5 * 3_600_000;

// --- Types ----------------------------------------------------------------------

export type AveragingPosition = {
  instrument: Instrument;
  type: LegType;
  strike: number;
  /** ISO yyyy-mm-dd. */
  expiry: string;
  /** Lots already held. */
  lots: number;
  lotSize: number;
  /** Average price already paid per unit (₹). */
  avgPrice: number;
  /** The strike's implied vol in percent, as Upstox reports it — null when missing. */
  iv: number | null;
  /** The broker's per-unit Greeks for this contract — used only as a labelled fallback when `iv` is missing. */
  brokerGreeks: { delta: number | null; gamma: number | null; theta: number | null } | null;
};

export type AveragingMarket = {
  spot: number;
  /** Live premium of the contract. */
  ltp: number;
  /** The moment the figures are from — time-to-expiry is measured from here. */
  nowMs: number;
  /** True when these are last-known prices (feed down) rather than a current poll. */
  stale: boolean;
};

export type AveragingPlan = {
  extraLots: number;
  /** Simulated purchase price per unit (₹). */
  buyPrice: number;
  /** Available funds in ₹ — null when not entered yet. */
  funds: number | null;
  /** Percent of funds the premium paid may reach before warning. */
  riskLimitPct: number;
};

export type ScenarioKey = "today" | "tomorrow" | "expiry";
export type Scenario = { key: ScenarioKey; label: string; atMs: number };

/** Where a set of Greeks came from. `broker` and `estimated` are the labelled fallbacks for a missing IV. */
export type GreeksSource = "engine" | "broker" | "estimated";

export type PositionSnapshot = {
  lots: number;
  qty: number;
  avgPrice: number;
  /** Total premium paid (₹). */
  capitalAtRisk: number;
  /** Worst P&L at expiry as a positive ₹ magnitude; null would mean unlimited (never, for a long option). */
  maxLoss: number | null;
  /** The premium the option must trade at to break even — the average price (brokerage excluded, as in Analysis). */
  breakevenPremium: number;
  /** Underlying level at expiry where P&L crosses zero. */
  breakevenLevel: number | null;
  pop: number | null;
  /** Net position Greeks: delta in underlying units, theta ₹/day. */
  delta: number;
  gamma: number;
  theta: number;
  greeksSource: GreeksSource;
};

export type ScenarioResult = {
  key: ScenarioKey;
  label: string;
  atMs: number;
  /** ₹ per unit of time value lost between now and then if the underlying doesn't move. */
  thetaDrag: number;
  /** ₹ per unit the premium must gain, from the underlying alone, to reach the average by then: average − (LTP − thetaDrag). Negative = already above. */
  premiumRise: number;
  /** premiumRise as a percent of today's LTP; null with no LTP. */
  premiumRisePct: number | null;
  /** Exact index points from spot to the level where P&L is zero then (negative = down). Null when there is no root or nothing is held. */
  move: number | null;
  /** The index level at that move. */
  level: number | null;
  /** True when the position would already be in profit then with the underlying unchanged — `move` is then a cushion. */
  inProfit: boolean;
  /**
   * Delta-gamma estimate of `move` from today's Greeks — a rough cross-check, not the headline. It
   * works on the model's own price gap (not the LTP gap), so it tests the curvature approximation
   * against the exact solve rather than the model-versus-market difference.
   */
  deltaGammaMove: number | null;
};

export type LotsRow = {
  /** Lots added. */
  lots: number;
  extraCost: number;
  newAvg: number;
  /** How much this lot lowered the average versus the row above, in percent (≤ 0 means it raised it). */
  improvementPct: number;
  premiumRise: number;
  premiumRisePct: number | null;
  /** Index points to break even if checked right now. */
  moveToday: number | null;
  /** Total premium paid — what is lost if the premium goes to zero. */
  lossIfZero: number;
};

export type LotsTable = {
  rows: LotsRow[];
  /** The first row whose extra lot lowers the average by less than MARGINAL_IMPROVEMENT; null if none does. */
  marginalLots: number | null;
  /** The last lot count where every lot still earns its keep (just before `marginalLots`); null when even the first lot is marginal or none is. */
  sweetSpot: number | null;
};

export type LadderRow = {
  /** Index points from spot. */
  offset: number;
  level: number;
  before: Record<ScenarioKey, number | null>;
  after: Record<ScenarioKey, number | null>;
};

export type AveragingResult = {
  /** The lots actually simulated — the plan's, sanitised (whole, ≥ 0, and 0 without a usable price). */
  extraLots: number;
  buyPrice: number | null;
  extraQty: number;
  extraCost: number;
  maxAffordableLots: number;
  dte: number;
  ivMissing: boolean;
  /** The model's value of the option minus its LTP (₹/unit); null with nothing held. Analysis carries the same gap. */
  modelGap: number | null;
  before: PositionSnapshot;
  after: PositionSnapshot;
  scenarios: { before: ScenarioResult[]; after: ScenarioResult[] };
  /** Percent the average falls by (positive = lower); null with no lots added. */
  avgImprovementPct: number | null;
  /** Percent the last added lot alone lowered the average by; null with no lots added. */
  lastLotImprovementPct: number | null;
  warnings: RiskWarning[];
};

// --- Basics ---------------------------------------------------------------------

/** Quantity-weighted average of the held quantity and a new purchase. Falls back to the held average when nothing is added. */
export function newAveragePrice(existingQty: number, existingAvg: number, addQty: number, addPrice: number): number {
  if (!(addQty > 0) || !Number.isFinite(addPrice)) return existingAvg;
  if (!(existingQty > 0)) return addPrice;
  return (existingQty * existingAvg + addQty * addPrice) / (existingQty + addQty);
}

/** Whole lots the funds cover at a price. 0 when funds, price or lot size aren't usable. */
export function maxAffordableLots(funds: number | null, lotSize: number, buyPrice: number | null): number {
  if (funds === null || !(funds > 0) || buyPrice === null || !(buyPrice > 0) || !(lotSize > 0)) return 0;
  // The epsilon keeps an exact fit (₹6,500 for one ₹100 × 65 lot) from rounding down to 0.
  return Math.floor(funds / (lotSize * buyPrice) + 1e-9);
}

/** ₹ and % the premium has to climb from `ltp` to reach `target`. Negative = already above it. */
export function premiumRiseNeeded(target: number, ltp: number): { rupees: number; pct: number | null } {
  return { rupees: target - ltp, pct: ltp > 0 ? ((target - ltp) / ltp) * 100 : null };
}

/** Whether a locked price has drifted from the live one by at least a tick. */
export function priceMoved(locked: number, live: number): boolean {
  return Math.abs(locked - live) >= PRICE_TICK - 1e-9;
}

/** The leg the position already is, and the one the simulation adds — exactly as Analysis would receive them. */
export function buildLegs(
  position: AveragingPosition,
  extraLots: number,
  buyPrice: number,
): { before: StrategyLeg[]; after: StrategyLeg[] } {
  const base = {
    enabled: true,
    side: "buy" as const,
    type: position.type,
    strike: position.strike,
    expiry: position.expiry,
    chainIv: position.iv,
  };
  const existing: StrategyLeg = { ...base, id: "existing", lots: position.lots, price: position.avgPrice };
  const averaging: StrategyLeg = { ...base, id: "averaging", lots: extraLots, price: buyPrice };
  return { before: [existing], after: [existing, averaging] };
}

/** ₹ P&L of a set of legs with the underlying at `atSpot` at time `atMs` — the Analysis payoff, priced from `spot` and `nowMs`. */
export function pnlAt(
  legs: StrategyLeg[],
  lotSize: number,
  spot: number,
  nowMs: number,
  atSpot: number,
  atMs: number,
): number {
  return strategyPnl(priceLegs(legs, spot, nowMs, lotSize), atSpot, atMs);
}

/** Option value per unit at a spot and moment, read off the first priced leg (all legs are one contract). */
function unitValue(priced: PricedLeg[], spot: number, atMs: number): number {
  const leg = priced[0];
  return strategyPnl([leg], spot, atMs) / (leg.sign * leg.qty) + leg.price;
}

// --- Scenarios ------------------------------------------------------------------

/**
 * Today (right now), Tomorrow (15:30 IST next day) and Expiry (the 15:30 close).
 * Tomorrow is left out when the contract expires today, and folded into Expiry
 * when it expires tomorrow — there it is the same moment.
 */
export function buildScenarios(expiry: string, nowMs: number): Scenario[] {
  const expiryMs = expiryCloseMs(expiry);
  const totalDays = Math.max(daysBetween(istDateString(nowMs), istDateString(expiryMs)), 0);
  const out: Scenario[] = [{ key: "today", label: "Today", atMs: nowMs }];
  if (totalDays >= 2) {
    out.push({ key: "tomorrow", label: "Tomorrow", atMs: targetMomentMs(1, totalDays, nowMs, expiryMs) });
  }
  if (expiryMs > nowMs) out.push({ key: "expiry", label: "Expiry", atMs: expiryMs });
  return out;
}

/**
 * The underlying level at which the position's P&L is zero at `atMs`, found by
 * bisection on the engine's own payoff — so it is theta-adjusted and agrees
 * with the Analysis payoff table by construction. The P&L of one long option is
 * monotone in the underlying, so the bracket [0.2×, 3×] spot holds one crossing.
 * Null when nothing is held or the payoff never crosses zero in that range.
 */
export function breakevenSpot(priced: PricedLeg[], spot: number, atMs: number): number | null {
  if (priced.length === 0 || !(spot > 0)) return null;
  const f = (s: number) => strategyPnl(priced, s, atMs);
  let lo = spot * BRACKET_LOW;
  let hi = spot * BRACKET_HIGH;
  let flo = f(lo);
  const fhi = f(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if ((flo < 0) === (fhi < 0)) return null;
  for (let i = 0; i < ROOT_ITERATIONS && hi - lo > ROOT_TOLERANCE; i++) {
    const mid = (lo + hi) / 2;
    const fm = f(mid);
    if (fm === 0) return mid;
    if ((fm < 0) === (flo < 0)) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Index move that closes a premium gap of `premiumRise` (₹/unit), from a
 * second-order expansion: ½γx² + δx = premiumRise. Takes the root nearest zero
 * on the side delta points to. Null when delta is ~0 or the gap lies beyond
 * what the quadratic can reach.
 */
export function deltaGammaMove(delta: number, gamma: number, premiumRise: number): number | null {
  if (![delta, gamma, premiumRise].every(Number.isFinite) || Math.abs(delta) < 1e-9) return null;
  if (Math.abs(gamma) < 1e-12) return premiumRise / delta;
  const disc = delta * delta + 2 * gamma * premiumRise;
  if (disc < 0) return null;
  return (-delta + Math.sign(delta) * Math.sqrt(disc)) / gamma;
}

type PerUnitGreeks = { delta: number; gamma: number; theta: number; source: GreeksSource };

/** Greeks per unit for the contract. A missing IV swaps in the broker's, labelled; with those missing too, the engine's fallback-vol estimate. */
function perUnitGreeks(position: AveragingPosition, market: AveragingMarket, ivMissing: boolean): PerUnitGreeks {
  const broker = position.brokerGreeks;
  if (ivMissing && broker && broker.delta !== null && broker.gamma !== null && broker.theta !== null) {
    return { delta: broker.delta, gamma: broker.gamma, theta: broker.theta, source: "broker" };
  }
  const { before } = buildLegs(position, 0, 0);
  const priced = priceLegs([{ ...before[0], lots: 1 }], market.spot, market.nowMs, position.lotSize);
  const g = strategyGreeks(priced, market.spot, market.nowMs);
  const q = position.lotSize;
  return { delta: g.delta / q, gamma: g.gamma / q, theta: g.theta / q, source: ivMissing ? "estimated" : "engine" };
}

function snapshotOf(
  position: AveragingPosition,
  market: AveragingMarket,
  priced: PricedLeg[],
  lots: number,
  avgPrice: number,
  unit: PerUnitGreeks,
): PositionSnapshot {
  const qty = lots * position.lotSize;
  const metrics = analyzeStrategy(priced, market.spot, market.nowMs);
  // The broker's Greeks are per unit; the engine's, summed over legs, already carry the quantity.
  const net =
    unit.source === "broker"
      ? { delta: unit.delta * qty, gamma: unit.gamma * qty, theta: unit.theta * qty }
      : strategyGreeks(priced, market.spot, market.nowMs);
  return {
    lots,
    qty,
    avgPrice,
    capitalAtRisk: qty * avgPrice,
    maxLoss: metrics ? metrics.maxLoss : 0,
    breakevenPremium: avgPrice,
    breakevenLevel: metrics?.breakevens[0] ?? null,
    pop: metrics?.pop ?? null,
    delta: net.delta,
    gamma: net.gamma,
    theta: net.theta,
    greeksSource: unit.source,
  };
}

function scenarioResult(
  scenario: Scenario,
  priced: PricedLeg[],
  avgPrice: number,
  market: AveragingMarket,
  unit: PerUnitGreeks,
): ScenarioResult {
  const { spot, ltp, nowMs } = market;
  const held = priced.length > 0;
  const thetaDrag = held ? Math.max(unitValue(priced, spot, nowMs) - unitValue(priced, spot, scenario.atMs), 0) : 0;
  const premiumRise = avgPrice - Math.max(ltp - thetaDrag, 0);
  const modelRise = held ? avgPrice - unitValue(priced, spot, scenario.atMs) : 0;
  const level = held ? breakevenSpot(priced, spot, scenario.atMs) : null;
  return {
    key: scenario.key,
    label: scenario.label,
    atMs: scenario.atMs,
    thetaDrag,
    premiumRise,
    premiumRisePct: ltp > 0 ? (premiumRise / ltp) * 100 : null,
    move: level === null ? null : level - spot,
    level,
    inProfit: held && strategyPnl(priced, spot, scenario.atMs) > 0,
    deltaGammaMove: held ? deltaGammaMove(unit.delta, unit.gamma, modelRise) : null,
  };
}

// --- The simulation -------------------------------------------------------------

export function simulateAveraging(
  position: AveragingPosition,
  market: AveragingMarket,
  plan: AveragingPlan,
): AveragingResult {
  const usablePrice = Number.isFinite(plan.buyPrice) && plan.buyPrice > 0 ? plan.buyPrice : null;
  const requestedLots = Number.isFinite(plan.extraLots) ? Math.max(Math.floor(plan.extraLots), 0) : 0;
  const extraLots = usablePrice === null ? 0 : requestedLots;
  const buyPrice = usablePrice;

  const ivMissing = !(position.iv !== null && position.iv > 0);
  const unit = perUnitGreeks(position, market, ivMissing);

  const existingQty = position.lots * position.lotSize;
  const extraQty = extraLots * position.lotSize;
  const extraCost = buyPrice === null ? 0 : extraQty * buyPrice;
  const newAvg = buyPrice === null ? position.avgPrice : newAveragePrice(existingQty, position.avgPrice, extraQty, buyPrice);

  const legs = buildLegs(position, extraLots, buyPrice ?? NaN);
  const pricedBefore = priceLegs(legs.before, market.spot, market.nowMs, position.lotSize);
  const pricedAfter = priceLegs(legs.after, market.spot, market.nowMs, position.lotSize);

  const before = snapshotOf(position, market, pricedBefore, position.lots, position.avgPrice, unit);
  const after = snapshotOf(position, market, pricedAfter, position.lots + extraLots, newAvg, unit);

  const scenarios = buildScenarios(position.expiry, market.nowMs);
  const heldPriced = pricedBefore.length ? pricedBefore : pricedAfter;
  const modelGap = heldPriced.length ? unitValue(heldPriced, market.spot, market.nowMs) - market.ltp : null;
  const dte = daysBetween(istDateString(market.nowMs), position.expiry);

  const avgImprovementPct =
    extraLots > 0 && position.avgPrice > 0 ? ((position.avgPrice - newAvg) / position.avgPrice) * 100 : null;
  const avgBeforeLastLot =
    buyPrice === null ? position.avgPrice : newAveragePrice(existingQty, position.avgPrice, extraQty - position.lotSize, buyPrice);
  const lastLotImprovementPct =
    extraLots > 0 && avgBeforeLastLot > 0 ? ((avgBeforeLastLot - newAvg) / avgBeforeLastLot) * 100 : null;

  const result: AveragingResult = {
    extraLots,
    buyPrice,
    extraQty,
    extraCost,
    maxAffordableLots: maxAffordableLots(plan.funds, position.lotSize, buyPrice),
    dte,
    ivMissing,
    modelGap,
    before,
    after,
    scenarios: {
      before: scenarios.map((s) => scenarioResult(s, pricedBefore, position.avgPrice, market, unit)),
      after: scenarios.map((s) => scenarioResult(s, pricedAfter, newAvg, market, unit)),
    },
    avgImprovementPct,
    lastLotImprovementPct,
    warnings: [],
  };
  result.warnings = buildWarnings(position, market, plan, result, requestedLots);
  return result;
}

// --- Lots table -----------------------------------------------------------------

/** One row per lot count from 1 to `maxLots`, at the given buy price, measured as of now. */
export function buildLotsTable(
  position: AveragingPosition,
  market: AveragingMarket,
  buyPrice: number | null,
  maxLots: number,
): LotsTable {
  if (buyPrice === null || !(buyPrice > 0) || !(maxLots >= 1)) return { rows: [], marginalLots: null, sweetSpot: null };

  const existingQty = position.lots * position.lotSize;
  const count = Math.min(Math.floor(maxLots), MAX_TABLE_LOTS);
  const rows: LotsRow[] = [];
  let marginalLots: number | null = null;
  let previousAvg = position.avgPrice;

  for (let lots = 1; lots <= count; lots++) {
    const addQty = lots * position.lotSize;
    const newAvg = newAveragePrice(existingQty, position.avgPrice, addQty, buyPrice);
    const improvement = previousAvg > 0 ? (previousAvg - newAvg) / previousAvg : 0;
    if (marginalLots === null && improvement < MARGINAL_IMPROVEMENT) marginalLots = lots;

    const priced = priceLegs(buildLegs(position, lots, buyPrice).after, market.spot, market.nowMs, position.lotSize);
    const level = breakevenSpot(priced, market.spot, market.nowMs);
    const rise = premiumRiseNeeded(newAvg, market.ltp);
    rows.push({
      lots,
      extraCost: addQty * buyPrice,
      newAvg,
      improvementPct: improvement * 100,
      premiumRise: rise.rupees,
      premiumRisePct: rise.pct,
      moveToday: level === null ? null : level - market.spot,
      lossIfZero: existingQty * position.avgPrice + addQty * buyPrice,
    });
    previousAvg = newAvg;
  }
  return { rows, marginalLots, sweetSpot: marginalLots !== null && marginalLots > 1 ? marginalLots - 1 : null };
}

// --- Payoff curve ---------------------------------------------------------------

export type PayoffCurve = {
  scenario: Scenario;
  /** Sorted by level; the strike and both break-evens are included so the kinks are sharp. */
  points: { level: number; before: number | null; after: number | null }[];
  breakevenBefore: number | null;
  breakevenAfter: number | null;
};

const CURVE_STEPS = 80;
const CURVE_PAD = 0.01;

/**
 * Before-versus-after P&L across the underlying at one moment — the data
 * behind the chart. The x-range is the Analysis chart's own (strikes plus a
 * couple of standard deviations), widened to hold both break-evens. Null when
 * there is nothing to draw. An unavailable scenario falls back to Today.
 */
export function buildPayoffCurve(
  position: AveragingPosition,
  market: AveragingMarket,
  extraLots: number,
  buyPrice: number | null,
  scenarioKey: ScenarioKey,
): PayoffCurve | null {
  const legs = buildLegs(position, extraLots, buyPrice ?? NaN);
  const pricedBefore = priceLegs(legs.before, market.spot, market.nowMs, position.lotSize);
  const pricedAfter = priceLegs(legs.after, market.spot, market.nowMs, position.lotSize);
  const reference = pricedAfter.length ? pricedAfter : pricedBefore;
  if (reference.length === 0) return null;

  const scenarios = buildScenarios(position.expiry, market.nowMs);
  const scenario = scenarios.find((x) => x.key === scenarioKey) ?? scenarios[0];

  const breakevenBefore = breakevenSpot(pricedBefore, market.spot, scenario.atMs);
  const breakevenAfter = breakevenSpot(pricedAfter, market.spot, scenario.atMs);

  const sdPct = analyzeStrategy(reference, market.spot, market.nowMs)?.sdPct ?? 0;
  let [lo, hi] = chartDomain(reference, market.spot, sdPct);
  const pad = market.spot * CURVE_PAD;
  for (const be of [breakevenBefore, breakevenAfter]) {
    if (be === null) continue;
    lo = Math.min(lo, be - pad);
    hi = Math.max(hi, be + pad);
  }

  const xs = new Set<number>();
  for (let i = 0; i <= CURVE_STEPS; i++) xs.add(lo + ((hi - lo) * i) / CURVE_STEPS);
  xs.add(position.strike);
  for (const be of [breakevenBefore, breakevenAfter]) if (be !== null) xs.add(be);

  const points = [...xs]
    .sort((a, b) => a - b)
    .map((level) => ({
      level,
      before: pricedBefore.length ? strategyPnl(pricedBefore, level, scenario.atMs) : null,
      after: pricedAfter.length ? strategyPnl(pricedAfter, level, scenario.atMs) : null,
    }));
  return { scenario, points, breakevenBefore, breakevenAfter };
}

// --- Verdict --------------------------------------------------------------------

export type VerdictTone = "good" | "caution" | "bad" | "neutral";

export type Verdict = {
  tone: VerdictTone;
  /** Short status for a pill. */
  label: string;
  /** One plain-language sentence saying what this purchase does. */
  headline: string;
  /** Percent the average moved (negative = lowered); null with nothing added. */
  avgChangePct: number | null;
  /** Index points the expiry break-even moved toward the current price (positive = closer, better); null when unknown. */
  breakevenCloserPts: number | null;
};

/** The one-sentence read of a simulation, plus how it should be coloured. */
export function summarizeAveraging(position: AveragingPosition, result: AveragingResult, funds: number | null): Verdict {
  const { before, after } = result;
  const avgChangePct = result.avgImprovementPct === null ? null : -result.avgImprovementPct;
  const breakevenCloserPts =
    before.breakevenLevel === null || after.breakevenLevel === null
      ? null
      : position.type === "CE"
        ? before.breakevenLevel - after.breakevenLevel
        : after.breakevenLevel - before.breakevenLevel;
  const base = { avgChangePct, breakevenCloserPts };
  const has = (id: string) => result.warnings.some((w) => w.id === id);
  const lots = (n: number) => `${n} lot${n === 1 ? "" : "s"}`;

  if (result.buyPrice === null) {
    return { ...base, tone: "neutral", label: "Enter a price", headline: "Enter a buy price above zero to run the numbers." };
  }
  if (result.extraLots === 0) {
    return { ...base, tone: "neutral", label: "Pick lots", headline: "Choose how many lots to add and see exactly what changes." };
  }
  const price = `₹${result.buyPrice.toFixed(2)}`;

  if (funds !== null && funds > 0 && result.extraCost > funds) {
    return {
      ...base,
      tone: "bad",
      label: "Over budget",
      headline: `${lots(result.extraLots)} at ${price} costs ${inr(result.extraCost)} — ${inr(result.extraCost - funds)} more than your available funds.`,
    };
  }
  if (result.buyPrice > position.avgPrice) {
    return {
      ...base,
      tone: "bad",
      label: "Raises your average",
      headline: `Buying at ${price}, above your ${position.avgPrice.toFixed(2)} average, lifts your average by ${Math.abs(avgChangePct ?? 0).toFixed(1)}% — that isn't averaging down.`,
    };
  }
  if (result.buyPrice === position.avgPrice) {
    return {
      ...base,
      tone: "caution",
      label: "Average unchanged",
      headline: `Buying at ${price}, exactly your average, leaves it where it is and only adds ${inr(result.extraCost)} of premium at risk.`,
    };
  }

  const closer = breakevenCloserPts !== null && breakevenCloserPts >= 0.5 ? ` and moves break-even ${Math.round(breakevenCloserPts)} pts closer` : "";
  const headline = `Adding ${lots(result.extraLots)} at ${price} lowers your average ${Math.abs(avgChangePct ?? 0).toFixed(1)}% (${position.avgPrice.toFixed(2)} → ${after.avgPrice.toFixed(2)})${closer}, for ${inr(result.extraCost)} more premium at risk.`;
  if (has("marginal-improvement")) return { ...base, tone: "caution", label: "Diminishing returns", headline };
  if (has("capital-at-risk")) return { ...base, tone: "caution", label: "Heavy on funds", headline };
  return { ...base, tone: "good", label: "Lowers your average", headline };
}

// --- P&L ladder -----------------------------------------------------------------

/** Before-versus-after P&L across the underlying, ±6 steps around spot, for every scenario. */
export function buildLadder(
  position: AveragingPosition,
  market: AveragingMarket,
  extraLots: number,
  buyPrice: number | null,
): LadderRow[] {
  const step = LADDER_STEP[position.instrument];
  const legs = buildLegs(position, extraLots, buyPrice ?? NaN);
  const pricedBefore = priceLegs(legs.before, market.spot, market.nowMs, position.lotSize);
  const pricedAfter = priceLegs(legs.after, market.spot, market.nowMs, position.lotSize);
  const scenarios = buildScenarios(position.expiry, market.nowMs);

  const rows: LadderRow[] = [];
  for (let i = -LADDER_HALF_STEPS; i <= LADDER_HALF_STEPS; i++) {
    const offset = i * step;
    const level = market.spot + offset;
    const at = (priced: PricedLeg[]) => {
      const out = {} as Record<ScenarioKey, number | null>;
      for (const s of scenarios) out[s.key] = priced.length ? strategyPnl(priced, level, s.atMs) : null;
      return out;
    };
    rows.push({ offset, level, before: at(pricedBefore), after: at(pricedAfter) });
  }
  return rows;
}

// --- Warnings -------------------------------------------------------------------

function inr(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function buildWarnings(
  position: AveragingPosition,
  market: AveragingMarket,
  plan: AveragingPlan,
  result: AveragingResult,
  requestedLots: number,
): RiskWarning[] {
  const out: RiskWarning[] = [];
  const funds = plan.funds !== null && plan.funds > 0 ? plan.funds : null;

  if (result.buyPrice === null) {
    out.push({ id: "no-price", severity: "warning", title: "No buy price", detail: "Enter a price above zero to simulate." });
  } else if (requestedLots === 0) {
    out.push({ id: "no-lots", severity: "info", title: "No lots added", detail: "Add at least 1 lot to see the effect." });
  }

  if (funds === null) {
    out.push({
      id: "funds-unset",
      severity: "info",
      title: "Funds not set",
      detail: "Enter your available funds to check affordability and the capital-at-risk limit.",
    });
  } else {
    if (result.extraCost > funds) {
      out.push({
        id: "exceeds-funds",
        severity: "critical",
        title: "More than your available funds",
        detail: `${requestedLots} lot${requestedLots === 1 ? "" : "s"} costs ${inr(result.extraCost)}; you have ${inr(funds)} — at most ${result.maxAffordableLots} lot${result.maxAffordableLots === 1 ? "" : "s"}.`,
      });
    }
    const riskPct = (result.after.capitalAtRisk / funds) * 100;
    if (riskPct > plan.riskLimitPct) {
      out.push({
        id: "capital-at-risk",
        severity: "warning",
        title: `Capital at risk is ${riskPct.toFixed(0)}% of funds`,
        detail: `${inr(result.after.capitalAtRisk)} of premium paid against your ${plan.riskLimitPct}% limit (${inr(funds)} funds).`,
      });
    }
  }

  if (result.dte <= THETA_HEAVY_DTE) {
    out.push({
      id: "theta-heavy",
      severity: "warning",
      title: result.dte <= 0 ? "Expires today" : `Expires in ${result.dte} day${result.dte === 1 ? "" : "s"} — theta-heavy`,
      detail: `Time decay is costing about ${inr(Math.abs(result.after.theta))} a day on this position and speeds up towards expiry.`,
    });
  }

  if (result.buyPrice !== null && result.buyPrice > position.avgPrice) {
    out.push({
      id: "price-above-avg",
      severity: "warning",
      title: "Not averaging down",
      detail: `The buy price ${result.buyPrice.toFixed(2)} is above your average ${position.avgPrice.toFixed(2)} — adding raises your average instead of lowering it.`,
    });
  } else if (result.lastLotImprovementPct !== null && result.lastLotImprovementPct < MARGINAL_IMPROVEMENT * 100) {
    out.push({
      id: "marginal-improvement",
      severity: "warning",
      title: "The last lot barely helps",
      detail: `It lowers your average by only ${result.lastLotImprovementPct.toFixed(2)}% (under ${(MARGINAL_IMPROVEMENT * 100).toFixed(1)}%) for ${inr(position.lotSize * (result.buyPrice ?? 0))} more premium at risk.`,
    });
  }

  if (result.ivMissing) {
    out.push({
      id: "iv-missing",
      severity: "info",
      title: "IV unavailable for this strike",
      detail:
        result.after.greeksSource === "broker"
          ? "Greeks shown are the broker's; payoff, break-even and POP use a fallback volatility."
          : "Greeks, payoff, break-even and POP use an estimated volatility.",
    });
  }

  if (result.modelGap !== null && market.ltp > 0 && Math.abs(result.modelGap) / market.ltp > MODEL_GAP_WARN) {
    out.push({
      id: "model-gap",
      severity: "info",
      title: "Model price differs from LTP",
      detail: `The model values this option at ₹${(market.ltp + result.modelGap).toFixed(2)} against an LTP of ₹${market.ltp.toFixed(2)} (zero-rate Black-Scholes at Upstox's IV). P&L, break-even moves and the ladder use the model, exactly as Analysis does, so they can sit slightly off your live P&L.`,
    });
  }

  if (market.stale || !isMarketOpen(market.nowMs)) {
    out.push({
      id: "market-closed",
      severity: "info",
      title: market.stale ? "Live prices paused" : "Market closed",
      detail: "Figures use the last traded prices and won't move until the market reopens.",
    });
  }

  return out;
}

// --- Market hours ---------------------------------------------------------------

/** Mon–Fri 09:15–15:30 IST. Exchange holidays aren't known here, so a holiday reads as open. */
export function isMarketOpen(nowMs: number): boolean {
  const ist = new Date(nowMs + IST_OFFSET_MS);
  const day = ist.getUTCDay();
  const minutes = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  return day >= 1 && day <= 5 && minutes >= 9 * 60 + 15 && minutes < 15 * 60 + 30;
}

// --- From a Live Portfolio row ---------------------------------------------------

/**
 * The simulator's inputs for a row, or null when it can't be simulated: it
 * must be a long option with a live price, a spot, and an expiry still ahead.
 */
export function simulationInputs(
  row: PortfolioRow,
  nowMs: number,
): { position: AveragingPosition; market: Omit<AveragingMarket, "nowMs" | "stale"> } | null {
  const { entry } = row;
  if (entry.side !== "buy" || entry.status !== "hold") return null;
  if (entry.strike_price == null || entry.option_type == null || entry.expiry_date == null) return null;
  if (row.status !== "ok" || row.liveLtp == null || !(row.liveLtp > 0)) return null;
  if (row.underlyingSpot == null || !(row.underlyingSpot > 0)) return null;
  if (!(expiryCloseMs(entry.expiry_date) > nowMs) || !(row.entryPrice > 0) || !(entry.lots > 0)) return null;

  return {
    position: {
      instrument: entry.instrument,
      type: entry.option_type,
      strike: entry.strike_price,
      expiry: entry.expiry_date,
      lots: entry.lots,
      lotSize: DEFAULT_LOT_SIZES[entry.instrument],
      avgPrice: row.entryPrice,
      iv: row.iv,
      brokerGreeks: { delta: row.delta, gamma: row.gamma, theta: row.theta },
    },
    market: { spot: row.underlyingSpot, ltp: row.liveLtp },
  };
}

// --- Hand-off to Analysis -------------------------------------------------------

/** The strategy "Open in Analysis" saves: the position and the simulated purchase, as two legs of one contract. */
export function toAnalysisStrategy(position: AveragingPosition, extraLots: number, buyPrice: number): SavedAnalysis {
  const leg = (id: string, lots: number, price: number): DraftLeg => ({
    id,
    enabled: true,
    side: "buy",
    type: position.type,
    strike: position.strike,
    expiry: position.expiry,
    lots,
    price: String(price),
  });
  return {
    instrument: position.instrument,
    legs: [leg("averaging-existing", position.lots, position.avgPrice), leg("averaging-added", extraLots, buyPrice)],
    spotOverride: "",
  };
}
