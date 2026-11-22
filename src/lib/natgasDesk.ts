/**
 * The natural gas desk on the Commodities tab - the rules behind it, with no React and no fetching. While MCX is shut it
 * shows MCX's last price next to NYMEX's move since, where MCX is expected to open, and what that does to the natural gas
 * positions held; while MCX trades it only says so (measured Oct-Nov 2026: MCX follows NYMEX within the same minute, so
 * NYMEX adds nothing to MCX's own live price - see the notes in the project memory).
 *
 * The expected open itself (the ratio method and the NYMEX contract it follows) is in expectedOpen.ts; this adds how to
 * read it - the graded gap label, how old each price is, a price typed in by hand - the trading hours in IST, and the
 * P&L of the open positions if MCX opens there.
 */

import { isFutureEntry, type PortfolioRow } from "@/lib/calculatePortfolio";
import { toLeg } from "@/lib/calculateRisk";
import { istDateString, priceLegs, strategyPnl, type StrategyLeg } from "@/lib/calculateStrategy";
import { applyMove, expectedOpenMarketFor, impliedOpen, type ExpectedOpenItem, type UsdInr } from "@/lib/expectedOpen";
import { describeEntryContract } from "@/lib/tradeEntriesStore";
import { DEFAULT_LOT_SIZES, mcxSessionCloseIst, usSummerTime } from "@/lib/types";

const IST_OFFSET_MS = 5.5 * 3_600_000;
const MINUTE_MS = 60_000;

// --- The gap label -------------------------------------------------------------------

/** How far off the estimate was on average, and at worst, against MCX's real first trade (15 sessions, 21 Oct to 12 Nov 2026). */
export const TYPICAL_MISS_PCT = 0.18;
export const WORST_MISS_PCT = 0.69;
/** A move smaller than this is within the estimate's own noise (about one typical miss). */
export const NO_GAP_BELOW_PCT = 0.2;
/** From here the move is several typical misses: in the test the direction was right on every gap of 0.3% or more. */
export const CLEAR_GAP_FROM_PCT = 0.5;

export type GapStrength = "none" | "lean" | "clear";
export type GapDirection = "up" | "down" | "flat";
export type GapSignal = { strength: GapStrength; direction: GapDirection; headline: string; detail: string };

/**
 * The opening gap in words, graded by how many typical misses it is. It is the open only - a gap is not a trend for the
 * day, and the test (15 sessions) is far too small to say what comes after the open.
 */
export function gapSignal(movePct: number): GapSignal {
  const size = Math.abs(movePct);
  if (!Number.isFinite(size) || size < NO_GAP_BELOW_PCT) {
    return {
      strength: "none",
      direction: "flat",
      headline: "No clear gap",
      detail: "NYMEX has barely moved since MCX closed, so MCX should open close to where it closed.",
    };
  }
  const direction: GapDirection = movePct > 0 ? "up" : "down";
  const moved = `NYMEX is ${direction} ${size.toFixed(2)}% since MCX closed`;
  const higherOrLower = direction === "up" ? "higher" : "lower";
  if (size < CLEAR_GAP_FROM_PCT) {
    return { strength: "lean", direction, headline: `Leaning ${direction}`, detail: `${moved}, so MCX may open a little ${higherOrLower}. A flat open is still possible.` };
  }
  return { strength: "clear", direction, headline: `Clear gap ${direction}`, detail: `${moved}, so MCX is likely to open ${higherOrLower}.` };
}

// --- The tab's preview ---------------------------------------------------------------

/** The live preview on the Natural gas tab: "Live" while MCX trades, otherwise the gap NYMEX has opened up (null until there is one). */
export type TabPreview = { kind: "live" } | { kind: "gap"; direction: GapDirection; movePct: number };

export function tabPreview(result: { open: boolean } | null, movePct: number | null): TabPreview | null {
  if (result === null) return null;
  if (result.open) return { kind: "live" };
  if (movePct === null || !Number.isFinite(movePct)) return null;
  const shown = Math.round(movePct * 100) / 100;
  return { kind: "gap", direction: shown > 0 ? "up" : shown < 0 ? "down" : "flat", movePct };
}

// --- How old a price is --------------------------------------------------------------

/** "just now", "23 min", "9h 06m", "2d 0h" - how long ago, without the "ago". */
export function ageText(ms: number): string {
  const minutes = Math.floor(Math.max(ms, 0) / MINUTE_MS);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** An instant as an IST clock time ("23:54"), with its weekday ("Fri 23:54") when it was not today. */
export function istStamp(ms: number, nowMs: number): string {
  const at = new Date(ms + IST_OFFSET_MS);
  const time = at.toISOString().slice(11, 16);
  return istDateString(ms) === istDateString(nowMs) ? time : `${WEEKDAY_NAMES[at.getUTCDay()]} ${time}`;
}

// --- The figures on the desk ---------------------------------------------------------

export type DeskFigures = {
  mcxClose: number;
  /** When MCX last traded; null when Upstox did not say. */
  mcxClosedAt: number | null;
  /** NYMEX when MCX last traded. */
  nymexAtClose: number;
  /** NYMEX now: the feed's price, or the one typed in. */
  nymexNow: number;
  /** When `nymexNow` is from: the feed's own time (it runs ~10 minutes behind), or when the price was typed. */
  nymexAsOf: number;
  nymexLabel: string;
  /** The feed says NYMEX is shut too, so its price is its last. A typed price is never stale. */
  nymexShut: boolean;
  /** Rupees per dollar and when it was read; null when the feed has no rate (the rupee columns then say so). */
  rate: number | null;
  rateAsOf: number | null;
  /** NYMEX when MCX last traded, and now, in rupees at that rate. */
  nymexAtCloseInr: number | null;
  nymexNowInr: number | null;
  /** MCX's last price against NYMEX's at that moment in rupees, in percent: positive means MCX was dearer. */
  premiumPct: number | null;
  /** `nymexNow` is the price typed in, not the feed's. */
  typed: boolean;
  movePct: number;
  expectedOpen: number;
  /** Expected open less MCX's last price, in rupees. */
  changeRupees: number;
  /** One typical miss, in rupees, and the range it makes around the expected open. */
  missRupees: number;
  low: number;
  high: number;
  signal: GapSignal;
};

/** The desk's numbers for one ready natural gas item - from the feed, or from a NYMEX price typed in - and `usdInr`, for the rupee columns. */
export function deskFigures(item: ExpectedOpenItem, typed: { price: number; at: number } | null, usdInr: UsdInr | null = null): DeskFigures {
  const implied = typed ? impliedOpen(item.mcxClose, item.nymex.atClose, typed.price) : null;
  const useTyped = typed !== null && implied !== null;
  const movePct = useTyped ? implied.movePct : item.movePct;
  const expectedOpen = useTyped ? implied.price : item.expectedOpen;
  const missRupees = (expectedOpen * TYPICAL_MISS_PCT) / 100;
  const rate = usdInr && usdInr.rate > 0 ? usdInr.rate : null;
  const nymexNow = useTyped ? typed.price : item.nymex.now;
  return {
    mcxClose: item.mcxClose,
    mcxClosedAt: item.mcxClosedAt,
    nymexAtClose: item.nymex.atClose,
    nymexNow,
    nymexAsOf: useTyped ? typed.at : item.nymex.asOf,
    nymexLabel: item.nymex.label,
    nymexShut: !useTyped && item.nymex.stale,
    rate,
    rateAsOf: rate === null || !usdInr ? null : usdInr.asOf,
    nymexAtCloseInr: rate === null ? null : item.nymex.atClose * rate,
    nymexNowInr: rate === null ? null : nymexNow * rate,
    premiumPct: rate === null ? null : (item.mcxClose / (item.nymex.atClose * rate) - 1) * 100,
    typed: useTyped,
    movePct,
    expectedOpen,
    changeRupees: expectedOpen - item.mcxClose,
    missRupees,
    low: expectedOpen - missRupees,
    high: expectedOpen + missRupees,
    signal: gapSignal(movePct),
  };
}

/** How far a typed NYMEX price may sit from the feed's before it is taken for a slip (the wrong contract month, a misplaced decimal). */
export const MAX_TYPED_OFF_PCT = 15;

export type TypedPrice = { ok: true; price: number } | { ok: false; message: string };

/** Reads a NYMEX price typed in dollars ("4.215", "$4.215", "4,215"), and refuses one that is far from the feed's `feedPrice`. */
export function parseNymexInput(text: string, feedPrice: number, contractLabel: string): TypedPrice {
  const cleaned = text.trim().replace(/^\$/, "").replace(/\s+/g, "");
  const normalised = cleaned.includes(".") ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
  if (!/^\d+(\.\d{1,4})?$/.test(normalised)) return { ok: false, message: "Type the price in dollars, like 4.215." };
  const price = Number(normalised);
  if (!(price > 0)) return { ok: false, message: "Type the price in dollars, like 4.215." };
  if (feedPrice > 0) {
    const off = Math.abs(price / feedPrice - 1) * 100;
    if (off > MAX_TYPED_OFF_PCT) {
      return { ok: false, message: `That is ${Math.round(off)}% from the feed's $${feedPrice.toFixed(3)}. Check it is the ${contractLabel} contract.` };
    }
  }
  return { ok: true, price };
}

// --- Trading hours, in IST -----------------------------------------------------------

export type NymexState = "trading" | "break" | "closed";

const NEW_YORK = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** New York's weekday (0 = Sunday) and minutes since midnight at an instant - daylight saving included. */
function newYorkClock(ms: number): { day: number; minutes: number } {
  let day = 0;
  let hour = 0;
  let minute = 0;
  for (const part of NEW_YORK.formatToParts(new Date(ms))) {
    if (part.type === "weekday") day = WEEKDAY_NAMES.indexOf(part.value as (typeof WEEKDAY_NAMES)[number]);
    else if (part.type === "hour") hour = Number(part.value) % 24;
    else if (part.type === "minute") minute = Number(part.value);
  }
  return { day: Math.max(day, 0), minutes: hour * 60 + minute };
}

/**
 * CME Globex energy (NYMEX natural gas): Sunday 18:00 to Friday 17:00 New York time, with an hour's break from 17:00 to 18:00
 * on the other days. This is CME's published schedule, not something the app reads from a feed - and exchange holidays are not in it.
 */
export function nymexState(ms: number): NymexState {
  const { day, minutes } = newYorkClock(ms);
  if (day === 6) return "closed";
  if (day === 0) return minutes >= 18 * 60 ? "trading" : "closed";
  if (day === 5) return minutes < 17 * 60 ? "trading" : "closed";
  return minutes >= 17 * 60 && minutes < 18 * 60 ? "break" : "trading";
}

/** The state of NYMEX now and the first instant (to the quarter hour) it changes; `at` is null if nothing changes within five days. */
export function nymexOutlook(nowMs: number): { state: NymexState; at: number | null } {
  const state = nymexState(nowMs);
  const step = 15 * MINUTE_MS;
  for (let t = Math.ceil((nowMs + 1) / step) * step, i = 0; i < 5 * 96; t += step, i++) {
    if (nymexState(t) !== state) return { state, at: t };
  }
  return { state, at: null };
}

export type SessionHours = {
  /** MCX opens 09:00 and closes at 23:30 while US clocks are on summer time, 23:55 otherwise. */
  mcx: { opens: "09:00"; closes: "23:30" | "23:55" };
  nymex: { breakFrom: string; breakTo: string; weekOpens: string; weekCloses: string };
  summer: boolean;
};

export function sessionHours(nowMs: number): SessionHours {
  const iso = istDateString(nowMs);
  const summer = usSummerTime(iso);
  return {
    summer,
    mcx: { opens: "09:00", closes: mcxSessionCloseIst(iso) },
    nymex: summer
      ? { breakFrom: "02:30", breakTo: "03:30", weekOpens: "Mon 03:30", weekCloses: "Sat 02:30" }
      : { breakFrom: "03:30", breakTo: "04:30", weekOpens: "Mon 04:30", weekCloses: "Sat 03:30" },
  };
}

/** A stretch of an IST day, in minutes since 00:00. */
export type DaySegment = { from: number; to: number };

export type DayBars = {
  /** The IST date, yyyy-mm-dd. */
  date: string;
  mcx: DaySegment[];
  nymexTrading: DaySegment[];
  nymexBreak: DaySegment[];
  /** Minutes since 00:00 IST at `nowMs`. */
  nowMinute: number;
};

/**
 * One IST day as a timeline: when MCX trades (Monday to Friday), and when NYMEX trades or is on its break - read off the same
 * Globex rules as nymexState a quarter hour at a time, so a weekend, the Friday night and Monday's reopening come out right.
 */
export function dayBars(nowMs: number): DayBars {
  const date = istDateString(nowMs);
  const dayStart = Date.parse(`${date}T00:00:00+05:30`);
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const [closeH, closeM] = mcxSessionCloseIst(date).split(":").map(Number);
  const mcx: DaySegment[] = weekday >= 1 && weekday <= 5 ? [{ from: 9 * 60, to: closeH * 60 + closeM }] : [];

  const nymexTrading: DaySegment[] = [];
  const nymexBreak: DaySegment[] = [];
  for (let slot = 0; slot < 96; slot++) {
    const state = nymexState(dayStart + slot * 15 * MINUTE_MS);
    const into = state === "trading" ? nymexTrading : state === "break" ? nymexBreak : null;
    if (!into) continue;
    const from = slot * 15;
    const last = into[into.length - 1];
    if (last && last.to === from) last.to = from + 15;
    else into.push({ from, to: from + 15 });
  }
  return { date, mcx, nymexTrading, nymexBreak, nowMinute: Math.floor((nowMs - dayStart) / MINUTE_MS) };
}

export type WindowRow = { when: string; mcx: string; nymex: string; estimate: string };

/** The week in IST: when each market trades and what the expected open does in each stretch. */
export function windowRows(nowMs: number): WindowRow[] {
  const { mcx, nymex } = sessionHours(nowMs);
  // "Mon 04:30" and "Sat 03:30": the clock time is what follows the weekday and its space.
  const monOpen = nymex.weekOpens.slice(4);
  const satClose = nymex.weekCloses.slice(4);
  return [
    { when: `Mon–Fri ${mcx.opens}–${mcx.closes}`, mcx: "Trading", nymex: "Trading", estimate: "Hidden - MCX has a real price" },
    { when: `Mon–Fri ${mcx.closes}–${nymex.breakFrom}`, mcx: "Shut", nymex: "Trading", estimate: "Updating" },
    { when: `Mon–Fri ${nymex.breakFrom}–${nymex.breakTo}`, mcx: "Shut", nymex: "On break", estimate: "Frozen for the hour" },
    { when: `Mon–Fri ${nymex.breakTo}–${mcx.opens}`, mcx: "Shut", nymex: "Trading", estimate: "Updating - best read just before the open" },
    { when: `Fri ${mcx.closes} – Sat ${satClose}`, mcx: "Shut", nymex: "Trading", estimate: "Updating" },
    { when: `Sat ${satClose} – Mon ${monOpen}`, mcx: "Shut", nymex: "Shut", estimate: "Frozen at NYMEX's last price" },
  ];
}

// --- The positions at the expected open ----------------------------------------------

export type PositionAtOpen = {
  id: string;
  label: string;
  side: "buy" | "sell";
  lots: number;
  isFuture: boolean;
  /** Unrealized P&L now (gross, as the Live Portfolio shows it). */
  pnlNow: number;
  /** What the move to the expected open (and the time until it) adds to it. */
  change: number;
  pnlAtOpen: number;
};

export type PositionsAtOpen = {
  rows: PositionAtOpen[];
  /** Natural gas positions left out because they cannot be priced right now (no live price or volatility). */
  skipped: number;
  totalNow: number;
  totalChange: number;
  totalAtOpen: number;
};

/**
 * The natural gas positions in `rows` if the underlying opens `movePct` away from where it last traded, at `atMs` (MCX's
 * reopening). A future moves one for one. An option is repriced with the same zero-rate Black-Scholes the rest of the app
 * uses, from its own implied volatility held where it is, with the time until `atMs` taken off: the change is the model's value
 * there less its value now, added to the P&L on screen, so the market's own price - not the model's - is the starting
 * point. A gap can also move volatility, which this leaves alone.
 */
export function positionsAtOpen(rows: readonly PortfolioRow[], movePct: number, nowMs: number, atMs: number): PositionsAtOpen {
  const out: PositionAtOpen[] = [];
  let skipped = 0;
  const now = new Date(nowMs);
  const today = istDateString(nowMs);

  for (const row of rows) {
    const { entry } = row;
    if (expectedOpenMarketFor(entry.instrument) !== "NATURALGAS") continue;
    if (row.status !== "ok" || row.livePnl == null || row.liveLtp == null) {
      skipped += 1;
      continue;
    }
    const sign = entry.side === "buy" ? 1 : -1;
    const lotSize = DEFAULT_LOT_SIZES[entry.instrument];
    let change: number | null = null;

    if (isFutureEntry(entry)) {
      change = sign * (applyMove(row.liveLtp, movePct) - row.liveLtp) * entry.lots * lotSize;
    } else {
      const leg = toLeg(row, now, today);
      if (leg && entry.option_type && entry.strike_price != null && entry.expiry_date) {
        const strategyLeg: StrategyLeg = {
          id: entry.id,
          enabled: true,
          side: entry.side,
          type: entry.option_type,
          strike: entry.strike_price,
          expiry: entry.expiry_date,
          lots: entry.lots,
          price: row.entryPrice,
          // normalizeIv reads anything above 3 as a percentage, so the volatility goes in as one.
          chainIv: leg.sigma * 100,
        };
        const priced = priceLegs([strategyLeg], leg.spot, nowMs, lotSize, entry.instrument);
        if (priced.length > 0) change = strategyPnl(priced, applyMove(leg.spot, movePct), atMs) - strategyPnl(priced, leg.spot, nowMs);
      }
    }

    if (change === null || !Number.isFinite(change)) {
      skipped += 1;
      continue;
    }
    out.push({
      id: entry.id,
      label: describeEntryContract(entry),
      side: entry.side,
      lots: entry.lots,
      isFuture: isFutureEntry(entry),
      pnlNow: row.livePnl,
      change,
      pnlAtOpen: row.livePnl + change,
    });
  }

  const sum = (pick: (p: PositionAtOpen) => number) => out.reduce((acc, p) => acc + pick(p), 0);
  return { rows: out, skipped, totalNow: sum((p) => p.pnlNow), totalChange: sum((p) => p.change), totalAtOpen: sum((p) => p.pnlAtOpen) };
}
