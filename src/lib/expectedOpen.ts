/**
 * Where MCX natural gas and crude oil are likely to open, worked out while MCX is shut: MCX stops trading at night and
 * over the weekend while NYMEX, whose prices MCX follows, keeps going. So
 *
 *   expected open = MCX's last price x (NYMEX now / NYMEX at the moment MCX last traded)
 *
 * Ratios only - no rupee rate, no unit conversion - so it holds for any commodity MCX tracks this way. The pairing that
 * matters is the contract month: an MCX month follows the NYMEX month after it (MCX November, NYMEX December), and the
 * ratio is taken on that one NYMEX contract, never the rolling "front month" - which can switch overnight, between the two
 * prices, and put a month's spread (11% for natural gas) into the estimate.
 *
 * Measured on the 15 sessions from 21 Oct to 12 Nov 2026 (the estimate at 08:59, with Yahoo's 10-minute delay, against
 * the real first MCX trade): natural gas missed by 0.18% on average (median 0.13%, worst 0.69%), crude oil by 0.12%
 * (median 0.09%, worst 0.39%); guessing "no change" missed by 0.88% and 1.40%. The direction was right on every gap of
 * 0.3% or more. That is an indication, not a promise: the first MCX trade can still differ, and the rupee is assumed unchanged.
 *
 * Pure - no network, no React - so the arithmetic and the rules can be tested on their own.
 */

import { isMarketOpen } from "@/lib/averaging";
import { mcxSessionCloseIst, type Instrument } from "@/lib/types";

export const EXPECTED_OPEN_MARKETS = ["NATURALGAS", "CRUDEOIL"] as const;
export type ExpectedOpenMarket = (typeof EXPECTED_OPEN_MARKETS)[number];

export const EXPECTED_OPEN_LABELS: Record<ExpectedOpenMarket, string> = {
  NATURALGAS: "Natural gas",
  CRUDEOIL: "Crude oil",
};

/** The NYMEX root symbol each market follows. */
const NYMEX_ROOT: Record<ExpectedOpenMarket, string> = { NATURALGAS: "NG", CRUDEOIL: "CL" };

/** Which market an instrument follows - the mini contracts move with the full-size one - or null when it isn't one of these. */
export function expectedOpenMarketFor(instrument: Instrument): ExpectedOpenMarket | null {
  if (instrument === "NATURALGAS" || instrument === "NATGASMINI") return "NATURALGAS";
  if (instrument === "CRUDEOIL" || instrument === "CRUDEOILM") return "CRUDEOIL";
  return null;
}

const MONTH_CODES = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"] as const;
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/**
 * The NYMEX contract an MCX contract follows: the month after the MCX expiry's own. MCX natural gas expiring 24 Nov 2026
 * follows NYMEX December 2026 (Yahoo symbol NGZ26.NYM); expiring 24 Dec, NYMEX January 2027 (NGF27.NYM).
 */
export function nymexContractFor(market: ExpectedOpenMarket, mcxExpiryIso: string): { symbol: string; label: string } | null {
  const match = /^(\d{4})-(\d{2})-\d{2}/.exec(mcxExpiryIso);
  if (!match) return null;
  const month0 = Number(match[2]) - 1;
  if (month0 < 0 || month0 > 11) return null;
  const next = (month0 + 1) % 12;
  const year = Number(match[1]) + (month0 === 11 ? 1 : 0);
  const yy = String(year).slice(-2);
  return { symbol: `${NYMEX_ROOT[market]}${MONTH_CODES[next]}${yy}.NYM`, label: `${MONTH_NAMES[next]} ${yy}` };
}

/** The expected price and the move behind it, or null unless all three prices are positive numbers. */
export function impliedOpen(mcxClose: number, nymexAtClose: number, nymexNow: number): { price: number; movePct: number } | null {
  if (!(mcxClose > 0) || !(nymexAtClose > 0) || !(nymexNow > 0)) return null;
  const ratio = nymexNow / nymexAtClose;
  return { price: mcxClose * ratio, movePct: (ratio - 1) * 100 };
}

/** The same move applied to another price of the same commodity - a position's own underlying, which may be another month's future. */
export function applyMove(price: number, movePct: number): number {
  return price * (1 + movePct / 100);
}

/** MCX's last price and when it last traded, out of one entry of Upstox's `/v2/market-quote/quotes` (last_trade_time is epoch milliseconds, as a string). */
export function parseMcxQuote(entry: unknown): { price: number; lastTradeMs: number | null } | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as { last_price?: unknown; last_trade_time?: unknown };
  if (typeof e.last_price !== "number" || !Number.isFinite(e.last_price) || e.last_price <= 0) return null;
  const traded = Number(e.last_trade_time);
  return { price: e.last_price, lastTradeMs: Number.isFinite(traded) && traded > 0 ? traded : null };
}

/** A contract that hasn't traded for this long while the clock says MCX is open is not trading - a part-day holiday, or before the first trade of the day. */
export const QUIET_AFTER_MS = 20 * 60_000;

/**
 * Whether MCX is trading: "closed" by the clock (night, weekend); "quiet" when the clock says open but the contract has
 * not traded for a while (MCX opens only at 17:00 on some holiday mornings, which no schedule here knows); else "open".
 */
export function mcxState(nowMs: number, lastTradeMs: number | null, instrument: Instrument = "CRUDEOIL"): "open" | "closed" | "quiet" {
  if (!isMarketOpen(nowMs, instrument)) return "closed";
  if (lastTradeMs !== null && nowMs - lastTradeMs > QUIET_AFTER_MS) return "quiet";
  return "open";
}

const IST_OFFSET_MS = 5.5 * 3_600_000;
const DAY_MS = 86_400_000;

/** The next 09:00 IST on a weekday after `nowMs` - when MCX reopens by the clock. */
export function nextMcxOpenMs(nowMs: number): number {
  const istDayStart = Math.floor((nowMs + IST_OFFSET_MS) / DAY_MS) * DAY_MS - IST_OFFSET_MS; // 00:00 IST today, as an instant
  for (let d = 0; d < 8; d++) {
    const open = istDayStart + d * DAY_MS + 9 * 3_600_000;
    const weekday = new Date(open + IST_OFFSET_MS).getUTCDay();
    if (open > nowMs && weekday >= 1 && weekday <= 5) return open;
  }
  return istDayStart + DAY_MS + 9 * 3_600_000;
}

/**
 * When MCX's most recent scheduled session ended before `nowMs`: the latest weekday close at or before it. The fallback for the
 * moment NYMEX's price is read at when Upstox doesn't say when a contract last traded - the schedule can't know a holiday or a
 * part-day session the way the last trade does, but a close that is a few minutes out costs far less than no estimate.
 */
export function lastScheduledCloseMs(nowMs: number): number {
  for (let back = 0; back < 10; back++) {
    const iso = new Date(nowMs + IST_OFFSET_MS - back * DAY_MS).toISOString().slice(0, 10);
    const weekday = new Date(`${iso}T00:00:00Z`).getUTCDay();
    if (weekday < 1 || weekday > 5) continue;
    const close = Date.parse(`${iso}T${mcxSessionCloseIst(iso)}:00+05:30`);
    if (close <= nowMs) return close;
  }
  return nowMs;
}

/** NYMEX's own last update older than this means it is shut too (its weekend, or the daily break): the price is its last, not a live one. */
export const NYMEX_STALE_MS = 45 * 60_000;

export type ExpectedOpenItem = {
  market: ExpectedOpenMarket;
  /** The MCX contract (its current-month future) and its expiry. */
  contract: { label: string; expiry: string };
  /** MCX's last price. */
  mcxClose: number;
  /** When MCX last traded - the moment the NYMEX price below is taken from - or null if Upstox didn't say. */
  mcxClosedAt: number | null;
  nymex: {
    symbol: string;
    label: string;
    /** NYMEX when MCX last traded. */
    atClose: number;
    /** NYMEX now, as of `asOf` (its feed runs ~10 minutes behind). */
    now: number;
    asOf: number;
    /** NYMEX is shut too, so `now` is its last price. */
    stale: boolean;
  };
  /** NYMEX's move since MCX last traded, in percent. */
  movePct: number;
  expectedOpen: number;
};

export type ExpectedOpenUnavailable = {
  market: ExpectedOpenMarket;
  reason: "no_contract" | "no_mcx_price" | "waiting_for_close_price" | "no_global_price";
};

export type ExpectedOpenResult = {
  /** MCX is trading: there is nothing to expect. */
  open: boolean;
  /** MCX should be trading by the clock but isn't (a part-day holiday, or before the day's first trade). */
  quiet: boolean;
  /** When MCX reopens by the clock; null when it isn't known (quiet) or MCX is open. */
  reopensAt: number | null;
  items: (ExpectedOpenItem | ExpectedOpenUnavailable)[];
  fetchedAt: number;
};

export type ExpectedOpenError = { error: string };

export function isExpectedOpenError(value: ExpectedOpenResult | ExpectedOpenError): value is ExpectedOpenError {
  return "error" in value;
}

export function isExpectedOpenItem(value: ExpectedOpenItem | ExpectedOpenUnavailable): value is ExpectedOpenItem {
  return "expectedOpen" in value;
}

/** What one market needs, gathered by the server. */
export type MarketInput = {
  market: ExpectedOpenMarket;
  /** The MCX current-month future, or null if the exchange lists none. */
  contract: { label: string; expiry: string } | null;
  mcx: { price: number; lastTradeMs: number | null } | null;
  nymex: { symbol: string; label: string; atClose: number | null; now: { price: number; asOf: number } | null } | null;
};

/** Puts the gathered prices together: which markets are shut, and for those, where each is expected to open. */
export function assembleExpectedOpen(nowMs: number, inputs: readonly MarketInput[]): ExpectedOpenResult {
  const items: (ExpectedOpenItem | ExpectedOpenUnavailable)[] = [];
  let anyClosed = false;
  let anyQuiet = false;

  for (const input of inputs) {
    const instrument: Instrument = input.market === "NATURALGAS" ? "NATURALGAS" : "CRUDEOIL";
    const state = input.mcx ? mcxState(nowMs, input.mcx.lastTradeMs, instrument) : mcxState(nowMs, null, instrument);
    if (state === "open") continue;
    if (state === "closed") anyClosed = true;
    else anyQuiet = true;

    if (!input.contract || !input.nymex) {
      items.push({ market: input.market, reason: "no_contract" });
    } else if (!input.mcx) {
      items.push({ market: input.market, reason: "no_mcx_price" });
    } else if (input.nymex.atClose === null) {
      items.push({ market: input.market, reason: "waiting_for_close_price" });
    } else if (!input.nymex.now) {
      items.push({ market: input.market, reason: "no_global_price" });
    } else {
      const implied = impliedOpen(input.mcx.price, input.nymex.atClose, input.nymex.now.price);
      if (!implied) {
        items.push({ market: input.market, reason: "no_global_price" });
        continue;
      }
      items.push({
        market: input.market,
        contract: input.contract,
        mcxClose: input.mcx.price,
        mcxClosedAt: input.mcx.lastTradeMs,
        nymex: {
          symbol: input.nymex.symbol,
          label: input.nymex.label,
          atClose: input.nymex.atClose,
          now: input.nymex.now.price,
          asOf: input.nymex.now.asOf,
          stale: nowMs - input.nymex.now.asOf > NYMEX_STALE_MS,
        },
        movePct: implied.movePct,
        expectedOpen: implied.price,
      });
    }
  }

  const open = items.length === 0 && inputs.length > 0;
  return { open, quiet: anyQuiet && !anyClosed, reopensAt: anyClosed ? nextMcxOpenMs(nowMs) : null, items, fetchedAt: nowMs };
}
