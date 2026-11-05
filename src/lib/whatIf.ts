/**
 * Pure maths behind Live Portfolio's What-if lab. No React, no fetching, read-only: it never places
 * anything. It answers "if I did THIS to my book, what happens to my odds and my risk?" for every
 * sensible THIS at once, then ranks them for what the person wants (safer / better odds / more
 * profit / a balance).
 *
 * Nothing here invents option maths. The book is priced by the Risk & Probability model in
 * calculateRisk.ts (zero-drift lognormal, one flat vol per leg, every position driven by the same
 * shock, payoffs at expiry before brokerage), so the "now" column matches that tab to the rupee. A
 * candidate move changes the legs, the same grid is run again, and the two are compared. New trades
 * are priced from the live option chain Live Portfolio already polls (real LTP, IV, Greeks, open
 * interest), so "sell 2 calls" is a real strike at a real price, not a guess.
 *
 * What a move does to the legs:
 *  - exiting lots books their P&L today (at the live price) and removes them from the book;
 *  - adding lots, or opening a new option or spread, adds legs entered at the live price;
 *  - the estimated brokerage/charges of the orders involved are deducted from what is booked.
 * Everything else is held to expiry, which is what the Risk tab assumes too.
 */

import { calculateBrokerage } from "@/lib/calculateBrokerage";
import type { PortfolioRow } from "@/lib/calculatePortfolio";
import {
  impliedVolFromPrice,
  legPayoff,
  normalizeIv,
  normCdf,
  payoffRange,
  simulate,
  toLeg,
  yearsToExpiry,
  type Distribution,
  type ModelLeg,
} from "@/lib/calculateRisk";
import { daysBetween, istDateString } from "@/lib/calculateStrategy";
import { LADDER_STEP, type PayoffCurve } from "@/lib/averaging";
import { formatINR } from "@/lib/format";
import { DEFAULT_LOT_SIZES, INSTRUMENT_LABELS, type Instrument } from "@/lib/types";
import { isUpstoxOptionChainError, type UpstoxMarginInstrumentRequest, type UpstoxOptionChainResult } from "@/lib/upstox/types";

// --- Tunables -----------------------------------------------------------------

/** Options quoted under this (₹) have no real market to trade in, so they are never suggested. */
export const MIN_PREMIUM = 1;
/** Open interest under this makes an option thin — wide spreads and slippage on the way in and out. */
export const THIN_OI = 10_000;
/** Strikes either side of the money considered for new trades. */
const STRIKES_EACH_SIDE = 8;
/** Spread widths tried, in strikes. */
const SPREAD_WIDTHS = [1, 2, 4];
/** A move must beat standing still by at least this (score units) to be recommended. */
const MIN_SCORE = 0.004;
/**
 * The most extra bad case (as a share of the book's scale) a move may add and still be recommended for
 * any goal but "Cut my loss". Without a limit, buying more of anything wins on upside alone.
 */
export const RISK_BUDGET = 0.25;
/** A worst case this many times the 1-in-100 bad case is theoretical rather than something to plan around. */
const REMOTE_WORST = 6;
/** Most moves worth showing across all families at once, and per kind of move. */
export const TOP_TOTAL = 8;
const PER_BUCKET = 2;

// --- Types ----------------------------------------------------------------------

export type OptionType = "CE" | "PE";
export type Side = "buy" | "sell";

export type ChainQuote = {
  strike: number;
  type: OptionType;
  ltp: number;
  /** Implied vol in percent as Upstox reports it; null when missing. */
  iv: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  oi: number | null;
  volume: number | null;
  instrumentKey: string | null;
};

/** One instrument + expiry: its live spot and every quoted strike. */
export type Underlying = {
  /** `NIFTY|2026-11-10` — the same key Live Portfolio polls by. */
  key: string;
  instrument: Instrument;
  expiry: string;
  spot: number;
  lotSize: number;
  dte: number;
  years: number;
  /** Quoted strikes, ascending. */
  strikes: number[];
  /** The strike nearest spot. */
  atm: number;
  quotes: ChainQuote[];
  byContract: Map<string, ChainQuote>;
};

export type BookLeg = ModelLeg & {
  /** The entry id for a held position; `new-N` for a leg a move would open. */
  id: string;
  held: boolean;
  /** "Nifty 24000 CE". */
  label: string;
  instrument: Instrument;
  expiry: string;
  type: OptionType;
  lots: number;
  lotSize: number;
  /** The live price — what exiting (or adding to) this leg costs right now. */
  ltp: number;
  instrumentKey: string | null;
  ivEstimated: boolean;
  thin: boolean;
  /** Per-unit broker Greeks; null when missing. */
  delta: number | null;
  theta: number | null;
};

export type Book = {
  legs: BookLeg[];
  /** Open positions left out of every figure — same rule as the Risk tab. */
  skipped: number;
  /** Gross premium in play (₹) — the book's natural yardstick for "how big is a gain or a loss". */
  premiumCapital: number;
};

export type Change =
  | { kind: "reduce"; legId: string; lots: number; /** Defaults to the live price. */ price?: number }
  | { kind: "open"; groupKey: string; side: Side; type: OptionType; strike: number; lots: number; /** Defaults to the live price. */ price?: number };

export type Family = "reduce" | "add" | "sell" | "buy" | "spread" | "book";

export const FAMILY_LABELS: Record<Family, string> = {
  reduce: "Exit lots",
  add: "Add lots",
  sell: "Sell options",
  buy: "Buy options",
  spread: "Spreads",
  book: "Whole book",
};

export type WhatIfAction = {
  id: string;
  family: Family;
  /** Groups near-identical variants so the list can show a spread of ideas, not one idea five times. */
  bucket: string;
  /** "Sell 2 of 4 lots". */
  headline: string;
  /** "Nifty 24000 CE · at ₹112.50". */
  detail: string;
  changes: Change[];
};

export type Applied = {
  /** The book after the move. */
  legs: BookLeg[];
  /** P&L locked in today by the move, after charges — rides along with whatever the legs do. */
  pnlOffset: number;
  /** The same, split by instrument + expiry, so a chart of one group can include only its own. */
  offsetByGroup: Record<string, number>;
  /** Gross cash flow: positive = money in (a credit), negative = money out (a debit), before charges. */
  cash: number;
  /** Estimated brokerage, taxes and fees on the orders involved. */
  charges: number;
  /** P&L booked today by exiting lots, before charges. */
  booked: number;
  problems: string[];
};

export type Outcome = Distribution & {
  /** Worst case at expiry as a positive ₹ magnitude; null = unlimited. */
  maxLoss: number | null;
  /** Best case at expiry; null = unlimited. */
  maxProfit: number | null;
  /** P&L at expiry if the index finishes exactly where it is now. */
  pnlFlat: number;
  /** ₹ per calendar day from time decay (negative costs you). */
  thetaPerDay: number;
  /** ₹ change for a 1% move in the index, from summed delta. */
  pnlPer1Pct: number;
  /**
   * The worst case is a theoretical one: far beyond the 1-in-100 bad case, as when a sold put could in
   * principle lose its strike's whole value if the index went to zero. Worth showing, not worth leaning on.
   */
  worstIsRemote: boolean;
};

export type Goal = "balanced" | "safer" | "odds" | "upside";

export const GOALS: { id: Goal; label: string; blurb: string }[] = [
  { id: "balanced", label: "Best overall", blurb: "Better odds and a smaller bad case, weighed against the upside they cost. A loss counts double a gain." },
  { id: "safer", label: "Cut my loss", blurb: "Shrink the bad case and the worst case, even if it costs upside." },
  { id: "odds", label: "Raise my odds", blurb: "Lift the chance of ending in profit. High odds can hide a big loss — check the loss column." },
  { id: "upside", label: "Bigger upside", blurb: "Make the good outcomes bigger, while keeping the bad case in check." },
];

export type TagTone = "good" | "bad" | "warn" | "info";
export type Tag = { id: string; label: string; tone: TagTone };

export type Evaluated = {
  action: WhatIfAction;
  applied: Applied;
  outcome: Outcome;
  /** Debit paid to put the move on (₹, ≥ 0), charges included. */
  outlay: number;
  /** The move creates a loss that has no ceiling, where the book had one. */
  createsOpenEnded: boolean;
  /** Extra 1-in-20 bad case, as a share of the book's scale — see RISK_BUDGET. */
  addedRisk: number;
  unaffordable: boolean;
  thin: boolean;
  tags: Tag[];
  score: Record<Goal, number>;
};

// --- The option chain, as the lab sees it ----------------------------------------

const contractKey = (type: OptionType, strike: number) => `${type}|${strike}`;

export function underlyingLabel(u: Pick<Underlying, "instrument" | "expiry">): string {
  const date = new Date(`${u.expiry}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${INSTRUMENT_LABELS[u.instrument]} · ${date} expiry`;
}

/** Every polled chain that loaded, reduced to what the lab needs. Chains that errored, or whose expiry has passed, are left out. */
export function buildUnderlyings(chains: Record<string, UpstoxOptionChainResult | undefined>, nowMs: number): Underlying[] {
  const out: Underlying[] = [];
  const now = new Date(nowMs);
  const today = istDateString(nowMs);
  for (const [key, chain] of Object.entries(chains)) {
    if (!chain || isUpstoxOptionChainError(chain)) continue;
    const [instrument, expiry] = key.split("|");
    if (!expiry || !(instrument in DEFAULT_LOT_SIZES)) continue;
    const years = yearsToExpiry(expiry, now);
    if (!(years > 0)) continue;
    const spot = chain.data.find((r) => r.underlying_spot_price != null && r.underlying_spot_price > 0)?.underlying_spot_price;
    if (!spot) continue;

    const quotes: ChainQuote[] = [];
    for (const row of chain.data) {
      const strike = Number(row.strike_price);
      if (!Number.isFinite(strike) || strike <= 0) continue;
      for (const [type, leg] of [
        ["CE", row.call_options],
        ["PE", row.put_options],
      ] as const) {
        const ltp = leg?.market_data?.ltp;
        if (ltp == null || !(ltp > 0)) continue;
        quotes.push({
          strike,
          type,
          ltp,
          iv: leg?.option_greeks?.iv ?? null,
          delta: leg?.option_greeks?.delta ?? null,
          gamma: leg?.option_greeks?.gamma ?? null,
          theta: leg?.option_greeks?.theta ?? null,
          vega: leg?.option_greeks?.vega ?? null,
          oi: leg?.market_data?.oi ?? null,
          volume: leg?.market_data?.volume ?? null,
          instrumentKey: leg?.instrument_key ?? null,
        });
      }
    }
    if (quotes.length === 0) continue;
    quotes.sort((a, b) => a.strike - b.strike || a.type.localeCompare(b.type));
    const strikes = [...new Set(quotes.map((q) => q.strike))];
    const atm = strikes.reduce((best, s) => (Math.abs(s - spot) < Math.abs(best - spot) ? s : best), strikes[0]);
    out.push({
      key,
      instrument: instrument as Instrument,
      expiry,
      spot,
      lotSize: DEFAULT_LOT_SIZES[instrument as Instrument],
      dte: daysBetween(today, expiry),
      years,
      strikes,
      atm,
      quotes,
      byContract: new Map(quotes.map((q) => [contractKey(q.type, q.strike), q])),
    });
  }
  return out.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.instrument.localeCompare(b.instrument));
}

// --- The book ---------------------------------------------------------------------

const legLabel = (instrument: Instrument, strike: number, type: OptionType) => `${INSTRUMENT_LABELS[instrument]} ${strike} ${type}`;

/** The open positions the Risk tab can model, as legs. Anything it can't model is counted in `skipped`, not guessed at. */
export function buildBook(rows: PortfolioRow[], nowMs: number): Book {
  const now = new Date(nowMs);
  const today = istDateString(nowMs);
  const legs: BookLeg[] = [];
  let skipped = 0;
  for (const row of rows) {
    const model = toLeg(row, now, today);
    const entry = row.entry;
    if (!model || !(model.t > 0) || entry.strike_price == null || entry.option_type == null) {
      skipped += 1;
      continue;
    }
    legs.push({
      isShort: model.isShort,
      isCall: model.isCall,
      strike: model.strike,
      premium: model.premium,
      qty: model.qty,
      spot: model.spot,
      sigma: model.sigma,
      t: model.t,
      groupKey: model.groupKey,
      id: entry.id,
      held: true,
      label: legLabel(entry.instrument, entry.strike_price, entry.option_type),
      instrument: entry.instrument,
      expiry: model.expiry,
      type: entry.option_type,
      lots: entry.lots,
      lotSize: DEFAULT_LOT_SIZES[entry.instrument],
      ltp: row.liveLtp ?? row.entryPrice,
      instrumentKey: row.instrumentKey,
      ivEstimated: model.ivEstimated,
      thin: row.oi != null && row.oi < THIN_OI,
      delta: row.delta,
      theta: row.theta,
    });
  }
  return { legs, skipped, premiumCapital: legs.reduce((acc, l) => acc + l.premium * l.qty, 0) };
}

/** A leg a move would open, priced at `price` from the chain's quote; null when no vol can be found to model it. */
function openLeg(u: Underlying, q: ChainQuote, side: Side, lots: number, price: number, id: string): BookLeg | null {
  const isCall = q.type === "CE";
  const own = q.iv != null && q.iv > 0 ? normalizeIv(q.iv) : null;
  const sigma = own ?? impliedVolFromPrice(u.spot, q.strike, u.years, q.ltp, isCall);
  if (sigma === null || !(sigma > 0)) return null;
  return {
    isShort: side === "sell",
    isCall,
    strike: q.strike,
    premium: price,
    qty: lots * u.lotSize,
    spot: u.spot,
    sigma,
    t: u.years,
    groupKey: u.key,
    id,
    held: false,
    label: legLabel(u.instrument, q.strike, q.type),
    instrument: u.instrument,
    expiry: u.expiry,
    type: q.type,
    lots,
    lotSize: u.lotSize,
    ltp: q.ltp,
    instrumentKey: q.instrumentKey,
    ivEstimated: own === null,
    thin: q.oi != null && q.oi < THIN_OI,
    delta: q.delta,
    theta: q.theta,
  };
}

// --- Applying a move ----------------------------------------------------------------

function orderCharges(side: Side, price: number, qty: number): number {
  const leg = side === "sell" ? { sellPrice: price, buyPrice: 0 } : { buyPrice: price, sellPrice: 0 };
  return calculateBrokerage("OPTIONS", [leg], qty).totalCharges;
}

export function applyChanges(book: Book, unders: Underlying[], changes: Change[]): Applied {
  const remaining = new Map(book.legs.map((l) => [l.id, l.lots]));
  const offsetByGroup: Record<string, number> = {};
  const bump = (group: string, amount: number) => {
    offsetByGroup[group] = (offsetByGroup[group] ?? 0) + amount;
  };
  const created: BookLeg[] = [];
  const problems: string[] = [];
  let booked = 0;
  let cash = 0;
  let charges = 0;

  for (const c of changes) {
    if (c.kind !== "reduce") continue;
    const leg = book.legs.find((l) => l.id === c.legId);
    if (!leg) {
      problems.push("A position in this move isn't open any more.");
      continue;
    }
    const have = remaining.get(leg.id) ?? 0;
    const lots = Math.min(Math.max(Math.floor(c.lots), 0), have);
    if (lots <= 0) continue;
    remaining.set(leg.id, have - lots);
    const qty = lots * leg.lotSize;
    const price = c.price ?? leg.ltp;
    const pnl = (leg.isShort ? leg.premium - price : price - leg.premium) * qty;
    const fee = orderCharges(leg.isShort ? "buy" : "sell", price, qty);
    booked += pnl;
    cash += (leg.isShort ? -price : price) * qty;
    charges += fee;
    bump(leg.groupKey, pnl - fee);
  }

  for (const c of changes) {
    if (c.kind !== "open") continue;
    const u = unders.find((x) => x.key === c.groupKey);
    const q = u?.byContract.get(contractKey(c.type, c.strike));
    if (!u || !q) {
      problems.push(`${c.type} ${c.strike} has no live quote right now.`);
      continue;
    }
    const lots = Math.max(Math.floor(c.lots), 0);
    if (lots <= 0) continue;
    const price = c.price ?? q.ltp;
    const leg = openLeg(u, q, c.side, lots, price, `new-${created.length}`);
    if (!leg) {
      problems.push(`${legLabel(u.instrument, c.strike, c.type)} can't be modelled — no implied volatility to work from.`);
      continue;
    }
    created.push(leg);
    const fee = orderCharges(c.side, price, leg.qty);
    cash += (c.side === "sell" ? price : -price) * leg.qty;
    charges += fee;
    bump(u.key, -fee);
  }

  const kept = book.legs.flatMap((l) => {
    const lots = remaining.get(l.id) ?? 0;
    return lots > 0 ? [{ ...l, lots, qty: lots * l.lotSize }] : [];
  });
  return {
    legs: [...kept, ...created],
    pnlOffset: booked - charges,
    offsetByGroup,
    cash,
    charges,
    booked,
    problems,
  };
}

// --- Evaluating a book --------------------------------------------------------------

export function evaluate(legs: BookLeg[], pnlOffset = 0): Outcome {
  const dist = simulate(legs, pnlOffset);
  const groups = new Map<string, BookLeg[]>();
  for (const l of legs) groups.set(l.groupKey, [...(groups.get(l.groupKey) ?? []), l]);
  let lo = 0;
  let hi = 0;
  let lossUnlimited = false;
  let profitUnlimited = false;
  for (const g of groups.values()) {
    const r = payoffRange(g);
    lo += r.min;
    hi += r.max;
    lossUnlimited ||= r.lossUnlimited;
    profitUnlimited ||= r.profitUnlimited;
  }
  let thetaPerDay = 0;
  let pnlPer1Pct = 0;
  let pnlFlat = pnlOffset;
  for (const l of legs) {
    const sign = l.isShort ? -1 : 1;
    thetaPerDay += sign * (l.theta ?? 0) * l.qty;
    pnlPer1Pct += sign * (l.delta ?? 0) * l.qty * l.spot * 0.01;
    pnlFlat += legPayoff(l, l.spot);
  }
  const maxLoss = lossUnlimited ? null : Math.max(-(lo + pnlOffset), 0);
  return {
    ...dist,
    maxLoss,
    maxProfit: profitUnlimited ? null : hi + pnlOffset,
    pnlFlat,
    thetaPerDay,
    pnlPer1Pct,
    worstIsRemote: maxLoss !== null && maxLoss > REMOTE_WORST * Math.max(-dist.p1, 1),
  };
}

// --- Scoring --------------------------------------------------------------------------

/**
 * What each goal counts. In a fairly priced market no trade changes the expected profit - it only
 * reshapes the outcomes: more of them profitable, a smaller bad case, a bigger good case. So the
 * weights are on those shapes, and the expected-profit term is just a guard against paying for
 * nothing (brokerage, a poor price).
 *
 *  - `tail` / `deep`: the 1-in-20 and 1-in-100 bad cases. (Not the theoretical worst case, which for
 *    a sold put is the index going to zero and drowns every other number.)
 *  - `open`: whether the loss has a ceiling at all.
 *  - `up`: the 1-in-20 good case. Only "Bigger upside" is paid for adding to it; every other goal
 *    just charges for upside a move gives away - otherwise adding leverage would always look good.
 *
 * "Best overall" counts a saved rupee of bad case twice a given-up rupee of upside; a goal that names
 * one thing counts that thing and keeps the rest as tie-breakers.
 */
const WEIGHTS: Record<Goal, { pop: number; ev: number; tail: number; deep: number; open: number; up: number; creditUp: boolean }> = {
  balanced: { pop: 1, ev: 0.3, tail: 1, deep: 0.3, open: 0.5, up: 0.5, creditUp: false },
  safer: { pop: 0.25, ev: 0.1, tail: 1, deep: 1, open: 1, up: 0.05, creditUp: false },
  odds: { pop: 1, ev: 0.1, tail: 0.03, deep: 0.05, open: 0.3, up: 0.02, creditUp: false },
  upside: { pop: 0.1, ev: 0.1, tail: 0.2, deep: 0.1, open: 0.3, up: 1, creditUp: true },
};

/** The yardstick money is measured against: what's in play, or what the book can already lose, whichever is bigger. */
export function bookScale(book: Book, base: Outcome): number {
  return Math.max(1, book.premiumCapital, base.maxLoss ?? 0, Math.abs(base.p5));
}

/** Extra 1-in-20 bad case a move adds, as a share of the book's scale (0 when it adds none). */
export function addedRisk(base: Outcome, next: Outcome, scale: number): number {
  return Math.max(base.p5 - next.p5, 0) / scale;
}

/**
 * How much better (positive) or worse (negative) a book is than where it stands, for one goal.
 * Each measure is a change in a comparable unit - odds in fractions, money as a fraction of the
 * book's scale - and the goal sets how much each one counts.
 */
export function scoreFor(goal: Goal, base: Outcome, next: Outcome, scale: number, thin: boolean): number {
  const w = WEIGHTS[goal];
  const dUp = (next.p95 - base.p95) / scale;
  const openEnded = (o: Outcome) => (o.maxLoss === null ? 1 : 0);
  const s =
    w.pop * (next.pop - base.pop) +
    (w.ev * (next.expectedPnl - base.expectedPnl)) / scale +
    (w.tail * (next.p5 - base.p5)) / scale +
    (w.deep * (next.p1 - base.p1)) / scale +
    w.open * (openEnded(base) - openEnded(next)) +
    w.up * (w.creditUp ? dUp : Math.min(dUp, 0));
  return thin ? s - 0.02 : s;
}

// --- Generating moves -------------------------------------------------------------------

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const rupee2 = (n: number) => `₹${n.toFixed(2)}`;

/** Distinct whole numbers ≥ 1 and ≤ `cap`, ascending. */
function lotSteps(values: number[], cap: number): number[] {
  return [...new Set(values.map((v) => Math.min(Math.max(Math.round(v), 1), cap)))].sort((a, b) => a - b);
}

const SPREAD_NAME: Record<string, string> = {
  "CE|credit": "Bear call spread",
  "PE|credit": "Bull put spread",
  "CE|debit": "Bull call spread",
  "PE|debit": "Bear put spread",
};

/** Every move worth trying on this book. `focus` is the instrument+expiry new trades are offered in. */
export function generateActions(book: Book, unders: Underlying[], focusKey: string | null): WhatIfAction[] {
  const actions: WhatIfAction[] = [];
  const focus = unders.find((u) => u.key === focusKey) ?? unders[0] ?? null;

  // Held positions: exit part or all of one, or add to it.
  for (const leg of book.legs) {
    const n = leg.lots;
    const noun = leg.isShort ? "Buy back" : "Sell";
    for (const k of lotSteps([n * 0.25, n * 0.5, n * 0.75, n], n)) {
      actions.push({
        id: `reduce:${leg.id}:${k}`,
        family: "reduce",
        bucket: `reduce:${leg.id}`,
        headline: k === n ? `${noun} all ${plural(n, "lot")}` : `${noun} ${k} of ${plural(n, "lot")}`,
        detail: `${leg.label} · at ${rupee2(leg.ltp)}${k === n ? "" : ` · keep ${plural(n - k, "lot")}`}`,
        changes: [{ kind: "reduce", legId: leg.id, lots: k }],
      });
    }
    const u = unders.find((x) => x.key === leg.groupKey);
    const quote = u?.byContract.get(contractKey(leg.type, leg.strike));
    if (u && quote) {
      for (const k of lotSteps([1, n * 0.5, n], Math.max(n * 2, 1))) {
        actions.push({
          id: `add:${leg.id}:${k}`,
          family: "add",
          bucket: `add:${leg.id}`,
          headline: `${leg.isShort ? "Sell" : "Buy"} ${plural(k, "more lot")}`,
          detail: `${leg.label} · at ${rupee2(quote.ltp)} · ${n} → ${n + k} lots`,
          changes: [{ kind: "open", groupKey: u.key, side: leg.isShort ? "sell" : "buy", type: leg.type, strike: leg.strike, lots: k }],
        });
      }
    }
  }

  // The whole book at once.
  if (book.legs.length > 0) {
    const all = (lots: (l: BookLeg) => number): Change[] =>
      book.legs.map((l) => ({ kind: "reduce", legId: l.id, lots: lots(l) }) satisfies Change).filter((c) => c.lots > 0);
    const book_ = (id: string, headline: string, detail: string, changes: Change[]) => {
      if (changes.length > 0) actions.push({ id: `book:${id}`, family: "book", bucket: `book:${id}`, headline, detail, changes });
    };
    book_("flat", "Square off everything", `All ${plural(book.legs.length, "position")} at today's prices`, all((l) => l.lots));
    if (book.legs.some((l) => l.lots >= 2)) {
      book_("halve", "Halve every position", "Exit half the lots of each position", all((l) => Math.floor(l.lots / 2)));
    }
    const losing = (l: BookLeg) => (l.isShort ? l.premium - l.ltp : l.ltp - l.premium) < 0;
    const losers = book.legs.filter(losing);
    const winners = book.legs.filter((l) => !losing(l));
    if (losers.length > 0 && winners.length > 0) {
      book_("losers", "Cut the losing positions", `Exit ${plural(losers.length, "position")} that are down`, losers.map((l) => ({ kind: "reduce", legId: l.id, lots: l.lots })));
      book_("winners", "Take profits on the winners", `Exit ${plural(winners.length, "position")} that are up`, winners.map((l) => ({ kind: "reduce", legId: l.id, lots: l.lots })));
    }
  }

  // New trades in the focus underlying.
  if (focus) {
    const heldMax = Math.max(1, ...book.legs.filter((l) => l.groupKey === focus.key).map((l) => l.lots));
    const lotChoices = lotSteps([1, 2, 4, heldMax / 2, heldMax], 30);
    const spreadLots = lotSteps([1, 2, heldMax], 30);
    // Around the money, and around every strike already held - so a short strike can be protected with a wing beyond it.
    const centres = [focus.strikes.indexOf(focus.atm)];
    const held = book.legs.filter((l) => l.groupKey === focus.key);
    for (const l of held) {
      const at = focus.strikes.reduce((best, s, i) => (Math.abs(s - l.strike) < Math.abs(focus.strikes[best] - l.strike) ? i : best), 0);
      centres.push(at);
    }
    const window = new Set<number>();
    for (const c of centres) {
      for (let i = Math.max(c - STRIKES_EACH_SIDE, 0); i <= Math.min(c + STRIKES_EACH_SIDE, focus.strikes.length - 1); i++) window.add(i);
    }
    const indices = [...window].sort((a, b) => a - b);
    // A single order on a contract already held is just adding to it or exiting it - those have their own moves.
    const heldContracts = new Set(held.map((l) => contractKey(l.type, l.strike)));
    const quoteAt = (type: OptionType, idx: number) => {
      if (idx < 0 || idx >= focus.strikes.length) return undefined;
      const q = focus.byContract.get(contractKey(type, focus.strikes[idx]));
      return q && q.ltp >= MIN_PREMIUM ? q : undefined;
    };

    for (const type of ["CE", "PE"] as const) {
      for (const i of indices) {
        const q = quoteAt(type, i);
        if (!q || heldContracts.has(contractKey(type, q.strike))) continue;
        for (const side of ["sell", "buy"] as const) {
          for (const lots of lotChoices) {
            actions.push({
              id: `${side}:${type}:${q.strike}:${lots}`,
              family: side,
              bucket: `${side}:${type}`,
              headline: `${side === "sell" ? "Sell" : "Buy"} ${plural(lots, "lot")} of ${type === "CE" ? "calls" : "puts"}`,
              detail: `${legLabel(focus.instrument, q.strike, type)} · at ${rupee2(q.ltp)}`,
              changes: [{ kind: "open", groupKey: focus.key, side, type, strike: q.strike, lots }],
            });
          }
        }
      }

      // Vertical spreads. Calls: the far leg is a higher strike. Puts: lower.
      const dir = type === "CE" ? 1 : -1;
      for (const i of indices) {
        for (const width of SPREAD_WIDTHS) {
          const j = i + dir * width;
          const near = quoteAt(type, i);
          const far = quoteAt(type, j);
          if (!near || !far) continue;
          // A leg on a contract already held would just be exiting or adding to it; that's the single moves' job.
          if (heldContracts.has(contractKey(type, near.strike)) || heldContracts.has(contractKey(type, far.strike))) continue;
          for (const style of ["credit", "debit"] as const) {
            // Credit: sell the near strike, buy the far one as protection. Debit: the reverse.
            const sold = style === "credit" ? near : far;
            const bought = style === "credit" ? far : near;
            if (sold.ltp <= bought.ltp && style === "credit") continue; // a "credit" spread that doesn't pay isn't one
            if (bought.ltp <= sold.ltp && style === "debit") continue;
            for (const lots of spreadLots) {
              actions.push({
                id: `spread:${type}:${style}:${near.strike}:${far.strike}:${lots}`,
                family: "spread",
                bucket: `spread:${type}:${style}`,
                headline: `${SPREAD_NAME[`${type}|${style}`]} · ${plural(lots, "lot")}`,
                detail: `Sell ${sold.strike} / buy ${bought.strike} ${type} · net ${style === "credit" ? "credit" : "debit"} ${rupee2(Math.abs(sold.ltp - bought.ltp))}`,
                changes: [
                  { kind: "open", groupKey: focus.key, side: "sell", type, strike: sold.strike, lots },
                  { kind: "open", groupKey: focus.key, side: "buy", type, strike: bought.strike, lots },
                ],
              });
            }
          }
        }
      }
    }
  }
  return actions;
}

// --- Evaluating moves ------------------------------------------------------------------

function tagsFor(base: Outcome, outcome: Outcome, applied: Applied, createsOpenEnded: boolean, thin: boolean, unaffordable: boolean): Tag[] {
  const tags: Tag[] = [];
  if (createsOpenEnded) tags.push({ id: "open", label: "Open-ended risk", tone: "bad" });
  else if (outcome.maxLoss !== null && !outcome.worstIsRemote && applied.legs.some((l) => l.isShort)) tags.push({ id: "capped", label: "Risk is capped", tone: "good" });
  if (applied.booked > 0.5) tags.push({ id: "locks", label: `Locks in ${formatINR(applied.booked)}`, tone: "good" });
  else if (applied.booked < -0.5) tags.push({ id: "books", label: `Books ${formatINR(-applied.booked)} loss`, tone: "warn" });
  if (applied.cash > 0.5) tags.push({ id: "credit", label: `Brings in ${formatINR(applied.cash)}`, tone: "info" });
  else if (applied.cash < -0.5) tags.push({ id: "debit", label: `Costs ${formatINR(-applied.cash)}`, tone: "info" });
  if (outcome.pop > base.pop + 0.02 && outcome.avgWin !== null && outcome.avgLoss !== null && -outcome.avgLoss > 4 * outcome.avgWin) {
    tags.push({ id: "lopsided", label: "Small wins, large losses", tone: "warn" });
  }
  if (thin) tags.push({ id: "thin", label: "Thin liquidity", tone: "warn" });
  if (unaffordable) tags.push({ id: "funds", label: "Over your funds", tone: "bad" });
  if (base.maxLoss === null && outcome.maxLoss !== null) tags.push({ id: "cap", label: "Removes unlimited loss", tone: "good" });
  return tags;
}

export type LabInput = {
  book: Book;
  unders: Underlying[];
  focusKey: string | null;
  /** ₹ available, or null when not entered. Buys that cost more are marked and left out of recommendations. */
  funds: number | null;
};

export type LabResult = {
  base: Outcome;
  scale: number;
  moves: Evaluated[];
};

/** Evaluates one set of changes against the book. */
export function evaluateChanges(
  input: Pick<LabInput, "book" | "unders" | "funds">,
  base: Outcome,
  scale: number,
  action: WhatIfAction,
): Evaluated {
  const { book, unders, funds } = input;
  const applied = applyChanges(book, unders, action.changes);
  const outcome = evaluate(applied.legs, applied.pnlOffset);
  const outlay = Math.max(-applied.cash, 0) + applied.charges;
  const createsOpenEnded = outcome.maxLoss === null && base.maxLoss !== null;
  const unaffordable = funds !== null && funds > 0 && outlay > funds;
  // Thin liquidity matters for what a move would *open* — an add or a new trade; exiting a position you hold is unaffected by how it was found.
  const thin = applied.legs.some((l) => !l.held && l.thin);
  const score = {} as Record<Goal, number>;
  for (const g of GOALS) score[g.id] = scoreFor(g.id, base, outcome, scale, thin);
  return {
    action,
    applied,
    outcome,
    outlay,
    createsOpenEnded,
    addedRisk: addedRisk(base, outcome, scale),
    unaffordable,
    thin,
    tags: tagsFor(base, outcome, applied, createsOpenEnded, thin, unaffordable),
    score,
  };
}

/** Where the book stands and every move worth trying, evaluated. */
export function runLab(input: LabInput): LabResult {
  const base = evaluate(input.book.legs);
  const scale = bookScale(input.book, base);
  const seen = new Set<string>();
  const outcomes = new Set<string>();
  const moves: Evaluated[] = [];
  for (const action of generateActions(input.book, input.unders, input.focusKey)) {
    if (seen.has(action.id)) continue;
    seen.add(action.id);
    const ev = evaluateChanges(input, base, scale, action);
    if (ev.applied.problems.length > 0) continue;
    // "Sell all 4 lots" and "Square off everything" on a one-position book leave the same book: keep the first.
    const signature = `${Math.round(ev.applied.pnlOffset)}|${ev.applied.legs
      .map((l) => `${l.label}:${l.isShort ? "s" : "b"}:${l.lots}:${l.premium.toFixed(2)}`)
      .sort()
      .join(",")}`;
    if (outcomes.has(signature)) continue;
    outcomes.add(signature);
    moves.push(ev);
  }
  return { base, scale, moves };
}

export type RankOptions = {
  goal: Goal;
  family: Family | "all";
  allowOpenEnded: boolean;
  limit?: number;
};

/** The best moves for a goal: those that beat standing still, best first, with a spread of ideas when looking across families. */
export function rankMoves(moves: Evaluated[], { goal, family, allowOpenEnded, limit = TOP_TOTAL }: RankOptions): Evaluated[] {
  const eligible = moves
    .filter(
      (m) =>
        (family === "all" || m.action.family === family) &&
        !m.unaffordable &&
        (allowOpenEnded || !m.createsOpenEnded) &&
        (goal === "safer" || m.addedRisk <= RISK_BUDGET) &&
        m.score[goal] > MIN_SCORE,
    )
    .sort((a, b) => b.score[goal] - a.score[goal]);
  if (family !== "all") return eligible.slice(0, limit);
  const perBucket = new Map<string, number>();
  const picked: Evaluated[] = [];
  for (const m of eligible) {
    const used = perBucket.get(m.action.bucket) ?? 0;
    if (used >= PER_BUCKET) continue;
    perBucket.set(m.action.bucket, used + 1);
    picked.push(m);
    if (picked.length >= limit) break;
  }
  return picked;
}

// --- Saying it in words ----------------------------------------------------------------

export type Highlight = { tone: "good" | "bad" | "neutral"; text: string };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const money = (n: number) => `${n < 0 ? "−" : ""}${formatINR(Math.abs(n))}`;

/** The handful of things a move changes that are worth saying, most important first. */
export function highlights(ev: Evaluated, base: Outcome, scale: number): Highlight[] {
  const o = ev.outcome;
  const out: Highlight[] = [];
  const material = (d: number) => Math.abs(d) >= Math.max(50, scale * 0.004);

  const dPop = o.pop - base.pop;
  if (Math.abs(dPop) >= 0.005) {
    out.push({ tone: dPop > 0 ? "good" : "bad", text: `Chance of ending in profit ${dPop > 0 ? "rises" : "falls"} from ${pct(base.pop)} to ${pct(o.pop)}.` });
  }
  if (base.maxLoss === null && o.maxLoss !== null) {
    out.push({ tone: "good", text: `Caps your worst case at ${formatINR(o.maxLoss)} — it was unlimited.` });
  } else if (base.maxLoss !== null && o.maxLoss === null) {
    out.push({ tone: "bad", text: "Your loss would have no ceiling if the market runs against you." });
  } else if (base.maxLoss !== null && o.maxLoss !== null && material(o.maxLoss - base.maxLoss)) {
    const better = o.maxLoss < base.maxLoss;
    out.push({ tone: better ? "good" : "bad", text: `Worst case at expiry ${better ? "shrinks" : "grows"} from ${formatINR(base.maxLoss)} to ${formatINR(o.maxLoss)}.` });
  }
  if (material(o.p5 - base.p5)) {
    out.push({
      tone: o.p5 > base.p5 ? "good" : "bad",
      text: `The 1-in-20 bad case ${o.p5 > base.p5 ? "improves" : "worsens"} from ${money(base.p5)} to ${money(o.p5)}.`,
    });
  }
  if (material(o.expectedPnl - base.expectedPnl)) {
    out.push({
      tone: o.expectedPnl > base.expectedPnl ? "good" : "bad",
      text: `Expected P&L ${o.expectedPnl > base.expectedPnl ? "rises" : "falls"} from ${money(base.expectedPnl)} to ${money(o.expectedPnl)}.`,
    });
  }
  if (material(o.p95 - base.p95)) {
    out.push({
      tone: o.p95 > base.p95 ? "good" : "neutral",
      text: `The 1-in-20 best case ${o.p95 > base.p95 ? "grows" : "shrinks"} from ${money(base.p95)} to ${money(o.p95)}${o.p95 < base.p95 ? " - that's the upside this gives up" : ""}.`,
    });
  }
  if (ev.applied.booked > 0.5) out.push({ tone: "neutral", text: `Banks ${formatINR(ev.applied.booked)} of profit today instead of leaving it exposed.` });
  else if (ev.applied.booked < -0.5) out.push({ tone: "neutral", text: `Makes a ${formatINR(-ev.applied.booked)} loss permanent today.` });
  if (ev.applied.cash < -0.5) out.push({ tone: "neutral", text: `Needs ${formatINR(ev.outlay)} up front, including about ${formatINR(ev.applied.charges)} of charges.` });
  else if (ev.applied.cash > 0.5) out.push({ tone: "neutral", text: `Brings in ${formatINR(ev.applied.cash)} up front (about ${formatINR(ev.applied.charges)} of charges), but sold options also block margin.` });
  return out;
}

// --- Chart and table --------------------------------------------------------------------

const CURVE_STEPS = 120;

function groupPayoff(legs: BookLeg[], groupKey: string, offset: number) {
  const group = legs.filter((l) => l.groupKey === groupKey);
  return (s: number) => group.reduce((acc, l) => acc + legPayoff(l, s), offset);
}

/** The index level nearest `spot` where a payoff crosses zero, from a dense scan (the payoff is piecewise linear, so interpolating is exact between samples). */
function nearestBreakeven(f: (s: number) => number, lo: number, hi: number, spot: number): number | null {
  let best: number | null = null;
  const n = 600;
  let prevX = lo;
  let prevY = f(lo);
  for (let i = 1; i <= n; i++) {
    const x = lo + ((hi - lo) * i) / n;
    const y = f(x);
    if ((prevY < 0 && y > 0) || (prevY > 0 && y < 0)) {
      const root = prevX + ((x - prevX) * Math.abs(prevY)) / (Math.abs(prevY) + Math.abs(y));
      if (best === null || Math.abs(root - spot) < Math.abs(best - spot)) best = root;
    }
    prevX = x;
    prevY = y;
  }
  return best;
}

/** Before-versus-after P&L at expiry across the index for one instrument + expiry — the data behind the chart. Null when that group has nothing in it. */
export function buildComparisonCurve(book: Book, applied: Applied, groupKey: string, spot: number): PayoffCurve | null {
  const before = groupPayoff(book.legs, groupKey, 0);
  const after = groupPayoff(applied.legs, groupKey, applied.offsetByGroup[groupKey] ?? 0);
  const involved = [...book.legs, ...applied.legs].filter((l) => l.groupKey === groupKey);
  if (involved.length === 0) return null;

  const sd = involved.reduce((acc, l) => acc + l.sigma * Math.sqrt(l.t), 0) / involved.length;
  const half = spot * Math.max(sd, 0.02) * 2.5;
  const strikes = involved.map((l) => l.strike);
  const pad = spot * 0.02;
  const lo = Math.max(Math.min(spot - half, ...strikes.map((k) => k - pad)), spot * 0.2);
  const hi = Math.max(spot + half, ...strikes.map((k) => k + pad));

  const beB = book.legs.some((l) => l.groupKey === groupKey) ? nearestBreakeven(before, lo, hi, spot) : null;
  const beA = applied.legs.some((l) => l.groupKey === groupKey) || (applied.offsetByGroup[groupKey] ?? 0) !== 0 ? nearestBreakeven(after, lo, hi, spot) : null;

  const xs = new Set<number>();
  for (let i = 0; i <= CURVE_STEPS; i++) xs.add(lo + ((hi - lo) * i) / CURVE_STEPS);
  for (const k of strikes) if (k > lo && k < hi) xs.add(k);
  for (const be of [beB, beA]) if (be !== null) xs.add(be);
  const hasBefore = book.legs.some((l) => l.groupKey === groupKey);
  const points = [...xs]
    .sort((a, b) => a - b)
    .map((level) => ({ level, before: hasBefore ? before(level) : null, after: after(level) }));
  const expiry = involved[0].expiry;
  return {
    scenario: { key: "expiry", label: "Expiry", dateLabel: expiry, daysOut: 0, atMs: 0 },
    points,
    breakevenBefore: beB,
    breakevenAfter: beA,
  };
}

export type MoveRow = {
  offset: number;
  level: number;
  before: number;
  after: number;
  /** Market-implied chance the index finishes above this level at expiry. */
  chanceAbove: number;
};

/** P&L at expiry at index levels ±6 steps around now, before and after — the exact figures behind the chart. */
export function buildMoveTable(book: Book, applied: Applied, groupKey: string, instrument: Instrument, spot: number): MoveRow[] {
  const step = LADDER_STEP[instrument];
  const before = groupPayoff(book.legs, groupKey, 0);
  const after = groupPayoff(applied.legs, groupKey, applied.offsetByGroup[groupKey] ?? 0);
  const involved = [...book.legs, ...applied.legs].filter((l) => l.groupKey === groupKey);
  const sd = involved.length ? involved.reduce((acc, l) => acc + l.sigma * Math.sqrt(l.t), 0) / involved.length : 0;
  const above = (level: number) => (sd > 0 ? normCdf(-(Math.log(level / spot) + (sd * sd) / 2) / sd) : level < spot ? 1 : 0);
  const rows: MoveRow[] = [];
  for (let i = -6; i <= 6; i++) {
    const level = spot + i * step;
    rows.push({ offset: i * step, level, before: before(level), after: after(level), chanceAbove: above(level) });
  }
  return rows;
}

// --- Margin ------------------------------------------------------------------------------

/**
 * The book as one basket for Upstox's margin calculator: contracts held both ways are netted, so
 * its hedge benefit applies. `missing` counts legs with no instrument key — when that's not zero
 * the basket is incomplete and a margin figure from it would mislead.
 */
export function marginBasket(legs: BookLeg[]): { items: UpstoxMarginInstrumentRequest[]; missing: number } {
  const net = new Map<string, { qty: number; price: number }>();
  let missing = 0;
  for (const l of legs) {
    if (!l.instrumentKey) {
      missing += 1;
      continue;
    }
    const cur = net.get(l.instrumentKey) ?? { qty: 0, price: l.ltp };
    cur.qty += (l.isShort ? -1 : 1) * l.qty;
    net.set(l.instrumentKey, cur);
  }
  const items: UpstoxMarginInstrumentRequest[] = [];
  for (const [instrument_key, { qty, price }] of net) {
    if (qty === 0) continue;
    items.push({ instrument_key, quantity: Math.abs(qty), transaction_type: qty > 0 ? "BUY" : "SELL", product: "D", price });
  }
  return { items, missing };
}

// --- Build your own ------------------------------------------------------------------------

/** One row of the "build your own" panel. */
export type BuilderMove =
  | { id: string; kind: "reduce"; legId: string; lots: number }
  | { id: string; kind: "add"; legId: string; lots: number }
  | { id: string; kind: "open"; side: Side; type: OptionType; strike: number | null; lots: number };

/** The changes a set of builder rows stands for. Rows that aren't complete or point at something gone are skipped. */
export function builderChanges(moves: BuilderMove[], book: Book, focus: Pick<Underlying, "key"> | null): Change[] {
  const out: Change[] = [];
  for (const m of moves) {
    if (!(m.lots >= 1)) continue;
    if (m.kind === "reduce") {
      if (book.legs.some((l) => l.id === m.legId)) out.push({ kind: "reduce", legId: m.legId, lots: m.lots });
    } else if (m.kind === "add") {
      const leg = book.legs.find((l) => l.id === m.legId);
      if (leg) out.push({ kind: "open", groupKey: leg.groupKey, side: leg.isShort ? "sell" : "buy", type: leg.type, strike: leg.strike, lots: m.lots });
    } else if (focus && m.strike !== null) {
      out.push({ kind: "open", groupKey: focus.key, side: m.side, type: m.type, strike: m.strike, lots: m.lots });
    }
  }
  return out;
}

/** "Sell 2 lots of Nifty 24000 CE + buy 4 lots of Nifty 24400 CE" - the builder's rows in words. */
export function describeChanges(changes: Change[], book: Book): string {
  const parts = changes.map((c) => {
    if (c.kind === "reduce") {
      const leg = book.legs.find((l) => l.id === c.legId);
      return `${leg?.isShort ? "buy back" : "sell"} ${plural(c.lots, "lot")} of ${leg?.label ?? "a position"}`;
    }
    const [instrument] = c.groupKey.split("|");
    return `${c.side} ${plural(c.lots, "lot")} of ${legLabel(instrument as Instrument, c.strike, c.type)}`;
  });
  if (parts.length === 0) return "Nothing chosen yet";
  const text = parts.join(" + ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
