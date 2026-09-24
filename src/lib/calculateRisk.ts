/**
 * Pure risk/probability analysis for the Live Portfolio tab. No React, no
 * fetching — takes the already-priced rows from useLivePricing and produces
 * everything the Risk & Probability panel shows: per-position odds, the
 * portfolio's worst/best case at expiry, Greek exposure, and a ranked list
 * of warning signs.
 *
 * Model, stated plainly so the numbers aren't over-trusted: the underlying
 * is lognormal with zero drift and one flat volatility per position (its own
 * Upstox IV). Every open position is driven by the *same* standard-normal
 * shock, i.e. Nifty/Bank Nifty/Sensex are assumed perfectly correlated —
 * conservative for cross-index hedges, fair for a single-index book. Payoffs
 * are at expiry and exclude brokerage. It's a market-implied estimate, not a
 * forecast.
 */

import { needsExpiryOnly, type PortfolioRow } from "@/lib/calculatePortfolio";
import { describeEntryContract } from "@/lib/tradeEntriesStore";
import { DEFAULT_LOT_SIZES, type Instrument } from "@/lib/types";

// --- Thresholds -----------------------------------------------------------
// Heuristics, not market law — tuned to be noisy enough to matter and quiet
// enough to trust. Kept in one place so they're easy to retune.
const SHORT_TESTED_PITM = 0.3; // short strike: ≥30% implied chance to finish ITM
const SHORT_PREMIUM_WARN = 1.5; // short premium ≥1.5× what was collected
const SHORT_PREMIUM_CRITICAL = 2; // ...≥2× is the classic stop-loss line
const LONG_PREMIUM_LOST_WARN = 0.5; // long premium down ≥50%
const LONG_LOW_POP = 0.25; // long option with <25% chance of profit
const PORTFOLIO_LOW_POP = 0.3;
const LOSS_VS_MARGIN_WARN = 0.1; // unrealized loss ≥10% of blocked margin
const LOSS_VS_MARGIN_CRITICAL = 0.25;
const SKEWED_RISK_REWARD = 3; // risking ≥3× the max profit
const DIRECTIONAL_VS_MARGIN = 0.05; // 1% index move swings ≥5% of margin
const THIN_OI = 10_000;
const GAUGE_MIN_SD = 0.015; // never draw a range narrower than ±1.5% — expiry-day 1σ is a hair's width
const GAUGE_ROOT_STEPS = 400;
const GAUGE_CURVE_STEPS = 120;
const GRID_HALF_WIDTH_Z = 6;
const GRID_STEPS = 240;
const MS_PER_DAY = 86_400_000;
const IST_OFFSET_MS = 5.5 * 3_600_000;

export type RiskSeverity = "critical" | "warning" | "info";

export type RiskWarning = {
  id: string;
  severity: RiskSeverity;
  title: string;
  detail: string;
};

export type PositionRisk = {
  row: PortfolioRow;
  contract: string;
  /** A long option sitting beyond a same-type short in the same expiry — it's there to cap loss, so decay/low-odds warnings don't apply to it. */
  isHedge: boolean;
  /** Calendar days to expiry in IST — 0 is expiry day, negative means the date has passed. */
  dte: number;
  /** Market-implied chance this leg, held alone to expiry, ends in profit. */
  pop: number;
  /** Market-implied chance the underlying finishes beyond this strike (ITM). */
  probItm: number;
  /** Signed % the spot sits inside the strike — positive is in the money, negative is out of it. */
  itmPct: number;
  breakeven: number;
  /** % the underlying has to travel from spot to reach breakeven — signed, negative is down. */
  breakevenMovePct: number;
  /** Market-implied 1σ move to expiry as a % of spot. */
  expectedMovePct: number;
  /** null = unlimited (only ever a naked short call). */
  maxLoss: number | null;
  maxProfit: number | null;
  /** ₹/day time decay on the position — negative costs you (long), positive pays you (short). */
  thetaPerDay: number | null;
  /** Worst severity among the warnings that name this position, if any. */
  flag: RiskSeverity | null;
};

/** One underlying+expiry's range bar: where spot sits against its profit/loss zones and breakevens at expiry. */
export type RangeGauge = {
  instrument: Instrument;
  expiry: string;
  dte: number;
  spot: number;
  /** Visible price window. */
  min: number;
  max: number;
  /** Prices where the group's combined payoff crosses zero, inside the window. */
  breakevens: number[];
  /** Contiguous segments covering [min, max], each wholly profit or wholly loss at expiry. */
  zones: { from: number; to: number; profit: boolean }[];
  /** Market-implied 1σ expected range to expiry. */
  sigmaLow: number;
  sigmaHigh: number;
  /** ₹ P&L at expiry if the underlying finished exactly at today's spot. */
  pnlAtSpot: number;
  /**
   * The group's expiry payoff sampled across [min, max], strikes and
   * breakevens included — the payoff is piecewise linear with kinks only at
   * strikes, so linear interpolation between these points is exact. Lets the
   * range bar answer "what's my P&L if it settles at X?" without the legs.
   */
  curve: { price: number; pnl: number }[];
};

export type RiskVerdict = "high" | "elevated" | "comfortable";

export type RiskAnalysis = {
  positions: PositionRisk[];
  gauges: RangeGauge[];
  analysedCount: number;
  openCount: number;
  nearestDte: number | null;
  nearestExpiry: string | null;
  /** Portfolio chance of ending in profit at expiry (single-shock model). */
  pop: number;
  expectedPnl: number;
  /** Worst case at expiry, ₹ (positive magnitude). null = unlimited. */
  maxLoss: number | null;
  maxProfit: number | null;
  /** max profit ÷ max loss; null when either side is unlimited or there's no loss to divide by. */
  rewardToRisk: number | null;
  /** Share of the worst case the unrealized loss has already consumed (0–100+), null when unbounded or not losing. */
  drawdownUsedPct: number | null;
  netThetaPerDay: number;
  /** Approx ₹ change in P&L for a 1% move in the underlying, from summed delta. */
  pnlPer1PctMove: number;
  verdict: RiskVerdict;
  warnings: RiskWarning[];
};

// --- Math -----------------------------------------------------------------

/** Standard normal CDF, Abramowitz & Stegun 7.1.26 (|error| < 1.5e-7). */
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989423 * Math.exp((-x * x) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
}

/** Upstox reports IV in percent (13.4); accept a decimal (0.134) too. */
function normalizeIv(iv: number): number {
  return iv > 3 ? iv / 100 : iv;
}

/** P(S_T > x) for a zero-drift lognormal underlying. */
function probAbove(spot: number, x: number, sigma: number, t: number): number {
  if (x <= 0) return 1;
  const sd = sigma * Math.sqrt(t);
  if (sd <= 0) return spot > x ? 1 : 0;
  return normCdf(-(Math.log(x / spot) + (sd * sd) / 2) / sd);
}

function istDateString(now: Date): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / MS_PER_DAY);
}

/** Years left until the 15:30 IST close on expiry day, floored at 0. */
function yearsToExpiry(expiryIso: string, now: Date): number {
  const close = Date.parse(`${expiryIso}T15:30:00+05:30`);
  return Math.max(close - now.getTime(), 0) / (365 * MS_PER_DAY);
}

// --- Per-leg model --------------------------------------------------------

type Leg = {
  row: PortfolioRow;
  entryId: string;
  isShort: boolean;
  isCall: boolean;
  strike: number;
  premium: number;
  qty: number;
  spot: number;
  sigma: number;
  t: number;
  dte: number;
  expiry: string;
  groupKey: string;
};

function toLeg(row: PortfolioRow, now: Date, today: string): Leg | null {
  const { entry } = row;
  if (
    row.status !== "ok" ||
    entry.strike_price == null ||
    entry.option_type == null ||
    entry.expiry_date == null ||
    row.underlyingSpot == null ||
    row.iv == null
  ) {
    return null;
  }
  const sigma = normalizeIv(row.iv);
  if (!(sigma > 0) || !(row.underlyingSpot > 0)) return null;
  return {
    row,
    entryId: entry.id,
    isShort: entry.side === "sell",
    isCall: entry.option_type === "CE",
    strike: entry.strike_price,
    premium: row.entryPrice,
    qty: entry.lots * DEFAULT_LOT_SIZES[entry.instrument],
    spot: row.underlyingSpot,
    sigma,
    t: yearsToExpiry(entry.expiry_date, now),
    dte: daysBetween(today, entry.expiry_date),
    expiry: entry.expiry_date,
    groupKey: `${entry.instrument}|${entry.expiry_date}`,
  };
}

/** ₹ payoff of one leg if the underlying settles at `s`. */
function legPayoff(leg: Leg, s: number): number {
  const intrinsic = leg.isCall ? Math.max(s - leg.strike, 0) : Math.max(leg.strike - s, 0);
  return (leg.isShort ? leg.premium - intrinsic : intrinsic - leg.premium) * leg.qty;
}

/**
 * Best/worst payoff of a set of legs sharing one underlying + expiry. The
 * payoff is piecewise linear with kinks only at strikes, so evaluating at 0
 * and every strike finds both extremes; the slope past the top strike (net
 * long/short calls) says whether either side is unbounded.
 */
function groupExtremes(legs: Leg[]): { maxLoss: number | null; maxProfit: number | null } {
  const callSlope = legs.reduce((acc, l) => acc + (l.isCall ? (l.isShort ? -1 : 1) * l.qty : 0), 0);
  const points = [0, ...legs.map((l) => l.strike)];
  const values = points.map((s) => legs.reduce((acc, l) => acc + legPayoff(l, s), 0));
  return {
    maxLoss: callSlope < 0 ? null : Math.max(-Math.min(...values), 0),
    maxProfit: callSlope > 0 ? null : Math.max(...values),
  };
}

/** Single-shock lognormal grid over every leg: portfolio POP and expected P&L. */
function simulate(legs: Leg[]): { pop: number; expectedPnl: number } {
  let wSum = 0;
  let pop = 0;
  let expected = 0;
  for (let i = 0; i <= GRID_STEPS; i++) {
    const z = -GRID_HALF_WIDTH_Z + (2 * GRID_HALF_WIDTH_Z * i) / GRID_STEPS;
    const w = Math.exp((-z * z) / 2);
    let pnl = 0;
    for (const leg of legs) {
      const sd = leg.sigma * Math.sqrt(leg.t);
      pnl += legPayoff(leg, leg.spot * Math.exp(-(sd * sd) / 2 + sd * z));
    }
    wSum += w;
    expected += w * pnl;
    if (pnl > 0) pop += w;
  }
  return { pop: pop / wSum, expectedPnl: expected / wSum };
}

/** Range bar for one instrument+expiry group — its combined expiry payoff along the price axis. */
function buildGauge(group: Leg[]): RangeGauge {
  const { spot, t } = group[0];
  const sigma = group.reduce((acc, l) => acc + l.sigma, 0) / group.length;
  const payoff = (s: number) => group.reduce((acc, l) => acc + legPayoff(l, s), 0);
  const sigmaPct = sigma * Math.sqrt(t);
  const sd = Math.max(sigmaPct, GAUGE_MIN_SD);

  // Payoff is piecewise linear with kinks only at strikes, so a zero crossing
  // between two adjacent sample points (strikes included) interpolates exactly.
  const domainLo = spot * 0.7;
  const domainHi = spot * 1.3;
  const samples = new Set<number>([domainLo, domainHi]);
  for (let i = 1; i < GAUGE_ROOT_STEPS; i++) samples.add(domainLo + ((domainHi - domainLo) * i) / GAUGE_ROOT_STEPS);
  for (const l of group) if (l.strike > domainLo && l.strike < domainHi) samples.add(l.strike);
  const xs = [...samples].sort((a, b) => a - b);
  const roots: number[] = [];
  for (let i = 1; i < xs.length; i++) {
    const fa = payoff(xs[i - 1]);
    const fb = payoff(xs[i]);
    if ((fa < 0 && fb > 0) || (fa > 0 && fb < 0)) {
      roots.push(xs[i - 1] + ((xs[i] - xs[i - 1]) * Math.abs(fa)) / (Math.abs(fa) + Math.abs(fb)));
    }
  }

  // Window: ±2 sd around spot, stretched to fit any breakeven within 3.5 sd.
  // Farther ones aren't drawn — the end zone simply runs off the edge.
  const near = roots.filter((r) => r >= spot * (1 - 3.5 * sd) && r <= spot * (1 + 3.5 * sd));
  const pad = 0.3 * sd * spot;
  const min = Math.min(spot * (1 - 2 * sd), ...near.map((r) => r - pad));
  const max = Math.max(spot * (1 + 2 * sd), ...near.map((r) => r + pad));
  const breakevens = roots.filter((r) => r > min && r < max);

  const bounds = [min, ...breakevens, max];
  const zones = bounds.slice(0, -1).map((from, i) => {
    const to = bounds[i + 1];
    return { from, to, profit: payoff((from + to) / 2) > 0 };
  });

  const curveXs = new Set<number>([min, max, ...breakevens]);
  for (let i = 1; i < GAUGE_CURVE_STEPS; i++) curveXs.add(min + ((max - min) * i) / GAUGE_CURVE_STEPS);
  for (const l of group) if (l.strike > min && l.strike < max) curveXs.add(l.strike);
  const curve = [...curveXs].sort((a, b) => a - b).map((price) => ({ price, pnl: payoff(price) }));

  return {
    instrument: group[0].row.entry.instrument,
    expiry: group[0].expiry,
    dte: group[0].dte,
    spot,
    min,
    max,
    breakevens,
    zones,
    sigmaLow: spot * (1 - sigmaPct),
    sigmaHigh: spot * (1 + sigmaPct),
    pnlAtSpot: payoff(spot),
    curve,
  };
}

function buildPositionRisk(leg: Leg, isHedge: boolean): PositionRisk {
  const be = leg.isCall ? leg.strike + leg.premium : leg.strike - leg.premium;
  // A call breaks even at strike+premium, a put at strike−premium. The leg
  // profits *above* breakeven for a long call or a short put, *below* it for
  // a short call or a long put.
  const probAboveBe = probAbove(leg.spot, be, leg.sigma, leg.t);
  const profitsAbove = leg.isCall !== leg.isShort; // long call, short put
  const pop = profitsAbove ? probAboveBe : 1 - probAboveBe;
  const probAboveStrike = probAbove(leg.spot, leg.strike, leg.sigma, leg.t);
  const probItm = leg.isCall ? probAboveStrike : 1 - probAboveStrike;
  const itmPct = ((leg.isCall ? leg.spot - leg.strike : leg.strike - leg.spot) / leg.spot) * 100;

  const q = leg.qty;
  const premiumTotal = leg.premium * q;
  const maxLoss = leg.isShort ? (leg.isCall ? null : Math.max((leg.strike - leg.premium) * q, 0)) : premiumTotal;
  const maxProfit = leg.isShort ? premiumTotal : leg.isCall ? null : Math.max((leg.strike - leg.premium) * q, 0);

  const rawTheta = leg.row.theta;
  return {
    row: leg.row,
    contract: describeEntryContract(leg.row.entry),
    isHedge,
    dte: leg.dte,
    pop,
    probItm,
    itmPct,
    breakeven: be,
    breakevenMovePct: ((be - leg.spot) / leg.spot) * 100,
    expectedMovePct: leg.sigma * Math.sqrt(leg.t) * 100,
    maxLoss,
    maxProfit,
    thetaPerDay: rawTheta == null ? null : (leg.isShort ? -1 : 1) * rawTheta * q,
    flag: null,
  };
}

// --- Warnings -------------------------------------------------------------

/** Plain-English reason a row can't be part of the analysis — mirrors the checks in toLeg. */
function whyNotAnalysed(row: PortfolioRow): string {
  switch (row.status) {
    case "untracked":
      return needsExpiryOnly(row.entry) ? "no expiry date set" : "no strike / CE-PE set";
    case "loading":
      return "still loading";
    case "error":
      return row.errorMessage === "token_expired"
        ? "Upstox token expired"
        : row.errorMessage === "network_error"
          ? "no connection"
          : "Upstox returned an error";
    case "no_match":
      return `strike not found in the ${row.entry.expiry_date} chain — check the expiry`;
    case "ok":
      if (row.underlyingSpot == null || !(row.underlyingSpot > 0)) return "Upstox sent no underlying spot price";
      return "Upstox sent no implied volatility for this strike";
  }
}

const SEVERITY_RANK: Record<RiskSeverity, number> = { critical: 0, warning: 1, info: 2 };

function nameList(names: string[]): string {
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3} more`;
}

const pct = (v: number, d = 0) => (v > 0 && v < 0.01 && d === 0 ? "<1%" : `${(v * 100).toFixed(d)}%`);

export function analyzeRisk(
  rows: PortfolioRow[],
  opts: { now: Date; totalMargin: number | null; unrealizedPnl: number },
): RiskAnalysis | null {
  const { now, totalMargin, unrealizedPnl } = opts;
  const today = istDateString(now);
  const legs = rows.map((row) => toLeg(row, now, today)).filter((l): l is Leg => l !== null);
  if (legs.length === 0) return null;

  const hedgeIds = new Set(
    legs
      .filter(
        (l) =>
          !l.isShort &&
          legs.some(
            (s) =>
              s.isShort &&
              s.groupKey === l.groupKey &&
              s.isCall === l.isCall &&
              (l.isCall ? l.strike > s.strike : l.strike < s.strike),
          ),
      )
      .map((l) => l.entryId),
  );
  const positions = legs.map((l) => buildPositionRisk(l, hedgeIds.has(l.entryId)));
  const positionByEntry = new Map(positions.map((p) => [p.row.entry.id, p]));

  // Worst/best case: each instrument+expiry is self-contained at its own
  // expiry; summing groups is the conservative "everything goes wrong" total.
  const groups = new Map<string, Leg[]>();
  for (const leg of legs) groups.set(leg.groupKey, [...(groups.get(leg.groupKey) ?? []), leg]);
  let maxLoss: number | null = 0;
  let maxProfit: number | null = 0;
  for (const g of groups.values()) {
    const ext = groupExtremes(g);
    maxLoss = maxLoss === null || ext.maxLoss === null ? null : maxLoss + ext.maxLoss;
    maxProfit = maxProfit === null || ext.maxProfit === null ? null : maxProfit + ext.maxProfit;
  }

  const gauges = [...groups.values()]
    .map(buildGauge)
    .sort((a, b) => (a.expiry === b.expiry ? a.instrument.localeCompare(b.instrument) : a.expiry < b.expiry ? -1 : 1));

  const { pop, expectedPnl } = simulate(legs);
  const netThetaPerDay = positions.reduce((acc, p) => acc + (p.thetaPerDay ?? 0), 0);
  const pnlPer1PctMove = legs.reduce((acc, l) => {
    const delta = l.row.delta ?? 0;
    return acc + (l.isShort ? -1 : 1) * delta * l.qty * l.spot * 0.01;
  }, 0);

  const rewardToRisk = maxLoss !== null && maxProfit !== null && maxLoss > 0 ? maxProfit / maxLoss : null;
  const drawdownUsedPct =
    maxLoss !== null && maxLoss > 0 && unrealizedPnl < 0 ? (-unrealizedPnl / maxLoss) * 100 : null;

  // --- warning rules ---
  const warnings: RiskWarning[] = [];
  const flagged = new Map<string, RiskSeverity>();
  const push = (w: RiskWarning, entryIds: string[] = []) => {
    warnings.push(w);
    for (const id of entryIds) {
      const cur = flagged.get(id);
      if (!cur || SEVERITY_RANK[w.severity] < SEVERITY_RANK[cur]) flagged.set(id, w.severity);
    }
  };
  const pick = (test: (p: PositionRisk, l: Leg) => boolean) =>
    legs.filter((l) => test(positionByEntry.get(l.entryId)!, l));
  const names = (ls: Leg[]) => nameList(ls.map((l) => positionByEntry.get(l.entryId)!.contract));
  const ids = (ls: Leg[]) => ls.map((l) => l.entryId);

  // Held past expiry — checked on every open row, live-matched or not.
  const expired = rows.filter((r) => r.entry.expiry_date != null && r.entry.expiry_date < today);
  if (expired.length > 0) {
    push(
      {
        id: "expired-held",
        severity: "critical",
        title: "Expired contracts still marked Hold",
        detail: `${nameList(expired.map((r) => describeEntryContract(r.entry)))} passed expiry. Mark them squared off (or fix the expiry date) so P&L and live totals stay honest.`,
      },
      expired.map((r) => r.entry.id),
    );
  }

  const unlimitedGroups = [...groups.values()].filter((g) => groupExtremes(g).maxLoss === null);
  if (unlimitedGroups.length > 0) {
    const shortCalls = unlimitedGroups.flatMap((g) => g.filter((l) => l.isShort && l.isCall));
    push(
      {
        id: "unlimited-loss",
        severity: "critical",
        title: "Unlimited loss on the upside",
        detail: `Net short calls with no long call above them (${names(shortCalls)}). A gap up has no ceiling on the loss — consider buying a farther call as a hedge.`,
      },
      ids(shortCalls),
    );
  }

  const shortItm = pick((p, l) => l.isShort && p.itmPct > 0 && l.dte >= 0);
  if (shortItm.length > 0) {
    push(
      {
        id: "short-itm",
        severity: "critical",
        title: "Short strikes are in the money",
        detail: `${names(shortItm)} — the underlying has already crossed the strike, so every extra point is a full-rupee loss.`,
      },
      ids(shortItm),
    );
  }

  const shortTested = pick((p, l) => l.isShort && p.itmPct <= 0 && p.probItm >= SHORT_TESTED_PITM && l.dte >= 0);
  if (shortTested.length > 0) {
    const worst = shortTested.map((l) => positionByEntry.get(l.entryId)!).sort((a, b) => b.probItm - a.probItm)[0];
    push(
      {
        id: "short-tested",
        severity: "warning",
        title: "Short strikes are being tested",
        detail: `${names(shortTested)} — up to ${pct(worst.probItm)} implied chance of finishing in the money; the strike is only ${Math.abs(worst.itmPct).toFixed(1)}% away against a ${worst.expectedMovePct.toFixed(1)}% expected move.`,
      },
      ids(shortTested),
    );
  }

  const premiumRatio = (l: Leg) => (l.row.liveLtp != null && l.premium > 0 ? l.row.liveLtp / l.premium : 0);
  const shortBlown = pick((_, l) => l.isShort && premiumRatio(l) >= SHORT_PREMIUM_CRITICAL);
  if (shortBlown.length > 0) {
    push(
      {
        id: "short-premium-doubled",
        severity: "critical",
        title: "Sold premium has doubled",
        detail: `${names(shortBlown)} now cost ${SHORT_PREMIUM_CRITICAL}× or more of what you collected — the usual stop-loss line has been crossed.`,
      },
      ids(shortBlown),
    );
  }
  const shortRising = pick((_, l) => l.isShort && premiumRatio(l) >= SHORT_PREMIUM_WARN && premiumRatio(l) < SHORT_PREMIUM_CRITICAL);
  if (shortRising.length > 0) {
    push(
      {
        id: "short-premium-rising",
        severity: "warning",
        title: "Sold premium is expanding",
        detail: `${names(shortRising)} trade at ${SHORT_PREMIUM_WARN}× or more of the entry premium — the trade is moving against you.`,
      },
      ids(shortRising),
    );
  }

  const shortExpiryDay = pick((_, l) => l.isShort && l.dte === 0);
  if (shortExpiryDay.length > 0) {
    push(
      {
        id: "short-expiry-day",
        severity: "critical",
        title: "Short positions expire today",
        detail: `${names(shortExpiryDay)} — gamma is at its peak on expiry day, so small index moves swing these premiums sharply.`,
      },
      ids(shortExpiryDay),
    );
  }
  const shortExpirySoon = pick((_, l) => l.isShort && l.dte >= 1 && l.dte <= 2);
  if (shortExpirySoon.length > 0) {
    push(
      {
        id: "short-expiry-soon",
        severity: "warning",
        title: "Short positions expire within 2 days",
        detail: `${names(shortExpirySoon)} — gamma risk builds quickly into expiry; decide now whether to hold or square off.`,
      },
      ids(shortExpirySoon),
    );
  }

  const longDecaying = pick((p, l) => !l.isShort && !p.isHedge && l.dte >= 0 && l.dte <= 2 && p.itmPct < 0);
  if (longDecaying.length > 0) {
    push(
      {
        id: "long-decay",
        severity: "warning",
        title: "Bought options are decaying fast",
        detail: `${names(longDecaying)} are out of the money with ${longDecaying.every((l) => l.dte === 0) ? "hours" : "days"} left — they'll bleed value quickly unless the underlying moves your way.`,
      },
      ids(longDecaying),
    );
  }

  const longLowPop = pick((p, l) => !l.isShort && !p.isHedge && l.dte >= 0 && p.pop < LONG_LOW_POP);
  if (longLowPop.length > 0) {
    const worst = longLowPop.map((l) => positionByEntry.get(l.entryId)!).sort((a, b) => a.pop - b.pop)[0];
    push(
      {
        id: "long-low-pop",
        severity: "warning",
        title: "Long options need a big move",
        detail: `${names(longLowPop)} — as low as ${pct(worst.pop)} chance of profit at expiry; breakeven needs a ${Math.abs(worst.breakevenMovePct).toFixed(1)}% move vs a ${worst.expectedMovePct.toFixed(1)}% expected one.`,
      },
      ids(longLowPop),
    );
  }

  const longBleeding = pick((p, l) => !l.isShort && !p.isHedge && l.premium > 0 && l.row.liveLtp != null && l.row.liveLtp <= l.premium * (1 - LONG_PREMIUM_LOST_WARN));
  if (longBleeding.length > 0) {
    push(
      {
        id: "long-bleeding",
        severity: "warning",
        title: "Bought premium is more than half gone",
        detail: `${names(longBleeding)} trade at half or less of what you paid.`,
      },
      ids(longBleeding),
    );
  }

  if (totalMargin != null && totalMargin > 0 && unrealizedPnl < 0) {
    const ratio = -unrealizedPnl / totalMargin;
    if (ratio >= LOSS_VS_MARGIN_WARN) {
      push({
        id: "loss-vs-margin",
        severity: ratio >= LOSS_VS_MARGIN_CRITICAL ? "critical" : "warning",
        title: "Unrealized loss is eating into margin",
        detail: `Open positions are down ${pct(ratio)} of the margin blocked against them.`,
      });
    }
  }

  if (maxLoss !== null && maxProfit !== null && maxProfit > 0 && maxLoss / maxProfit >= SKEWED_RISK_REWARD) {
    push({
      id: "skewed-risk-reward",
      severity: "warning",
      title: "Risking far more than you can make",
      detail: `Worst case is ${(maxLoss / maxProfit).toFixed(1)}× the best case — this only pays if the market stays quiet.`,
    });
  }

  // A lone position's odds are already covered by its own warnings above.
  if (legs.length > 1 && pop < PORTFOLIO_LOW_POP) {
    push({
      id: "low-pop",
      severity: "warning",
      title: "Odds are against the book",
      detail: `Only a ${pct(pop)} market-implied chance the portfolio ends in profit at expiry.`,
    });
  }

  if (totalMargin != null && totalMargin > 0 && Math.abs(pnlPer1PctMove) / totalMargin >= DIRECTIONAL_VS_MARGIN) {
    push({
      id: "directional",
      severity: "warning",
      title: pnlPer1PctMove > 0 ? "Heavily long the market" : "Heavily short the market",
      detail: `A 1% ${pnlPer1PctMove > 0 ? "fall" : "rise"} in the index costs about ₹${Math.round(Math.abs(pnlPer1PctMove)).toLocaleString("en-IN")} (${pct(Math.abs(pnlPer1PctMove) / totalMargin, 1)} of margin).`,
    });
  }

  const thin = pick((_, l) => l.row.oi != null && l.row.oi < THIN_OI);
  if (thin.length > 0) {
    push(
      {
        id: "thin-oi",
        severity: "info",
        title: "Thin open interest",
        detail: `${names(thin)} — low OI can mean wide spreads and slippage when you exit.`,
      },
      ids(thin),
    );
  }

  const unanalysed = rows.filter((r) => !legs.some((l) => l.entryId === r.entry.id));
  if (unanalysed.length > 0) {
    push({
      id: "excluded",
      severity: "info",
      title: `${unanalysed.length} position${unanalysed.length === 1 ? "" : "s"} not analysed`,
      detail: `Left out of every figure above — ${nameList(unanalysed.map((r) => `${describeEntryContract(r.entry)}: ${whyNotAnalysed(r)}`))}.`,
    });
  }

  warnings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
  for (const p of positions) p.flag = flagged.get(p.row.entry.id) ?? null;

  const nearest = legs.reduce((a, b) => (b.expiry < a.expiry ? b : a));
  const verdict: RiskVerdict = warnings.some((w) => w.severity === "critical")
    ? "high"
    : warnings.some((w) => w.severity === "warning")
      ? "elevated"
      : "comfortable";

  return {
    positions,
    gauges,
    analysedCount: legs.length,
    openCount: rows.length,
    nearestDte: nearest.dte,
    nearestExpiry: nearest.expiry,
    pop,
    expectedPnl,
    maxLoss,
    maxProfit,
    rewardToRisk,
    drawdownUsedPct,
    netThetaPerDay,
    pnlPer1PctMove,
    verdict,
    warnings,
  };
}
