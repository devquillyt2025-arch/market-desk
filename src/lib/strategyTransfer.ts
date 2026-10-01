/**
 * Moving strategies in and out of the Analysis tab — pure, no React or
 * fetching. Two import shapes are understood:
 *   1. a strategy file written by this tab's own Export, and
 *   2. a plain array of trade entries — exactly what Live Portfolio, Paper
 *      Trade and Trade Entries export — so any of those files can be dropped
 *      straight in. Only open (hold) option positions become legs.
 */

import type { LegSide, LegType } from "@/lib/calculateStrategy";
import type { AddTradeEntryInput } from "@/lib/tradeEntriesStore";
import { INSTRUMENTS, type Instrument, type TradeEntry } from "@/lib/types";

export type DraftLeg = {
  id: string;
  enabled: boolean;
  side: LegSide;
  type: LegType;
  strike: number;
  /** ISO yyyy-mm-dd. */
  expiry: string;
  lots: number;
  /** Kept as text so the field can be empty/mid-edit; parsed when the analysis is computed. */
  price: string;
};

export type DraftLegInput = Omit<DraftLeg, "id">;

/** "entry" keeps the price the position was opened at; "live" leaves it blank so the current market price is pulled in. */
export type PriceMode = "entry" | "live";

const FILE_FORMAT = "marketdesk-strategy";
const FILE_VERSION = 1;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isInstrument = (v: unknown): v is Instrument => (INSTRUMENTS as readonly unknown[]).includes(v);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** An open option position with everything a leg needs. */
export function isImportableEntry(entry: TradeEntry): boolean {
  return entry.status === "hold" && entry.strike_price != null && entry.option_type != null && entry.expiry_date != null;
}

export function tradeEntryToLeg(entry: TradeEntry, priceMode: PriceMode): DraftLegInput | null {
  if (!isImportableEntry(entry)) return null;
  const entryPrice = entry.side === "sell" ? entry.sell_price : entry.buy_price;
  return {
    enabled: true,
    side: entry.side,
    type: entry.option_type as LegType,
    strike: entry.strike_price as number,
    expiry: entry.expiry_date as string,
    lots: entry.lots,
    price: priceMode === "entry" ? String(entryPrice) : "",
  };
}

/** A contract chosen in the option-chain picker. `ltp` is the market price when it was picked (null if the chain had none). */
export type PickedLeg = {
  side: LegSide;
  type: LegType;
  strike: number;
  expiry: string;
  lots: number;
  ltp: number | null;
};

/**
 * A new open position for Live Portfolio / Paper Trade from a picked leg.
 * Same convention as the entry form: the executed leg is the market price and
 * the not-yet-executed leg is also the market price (it follows live LTP
 * afterwards), so a fresh position starts at zero P&L. Null when there's no price.
 */
export function pickedLegToEntryInput(instrument: Instrument, leg: PickedLeg, entryDate: string): AddTradeEntryInput | null {
  if (leg.ltp === null) return null;
  return {
    entryDate,
    instrument,
    strikePrice: leg.strike,
    optionType: leg.type,
    expiryDate: leg.expiry,
    lots: leg.lots,
    side: leg.side,
    buyPrice: leg.ltp,
    sellPrice: leg.ltp,
    status: "hold",
  };
}

export function buildStrategyExport(instrument: Instrument, legs: DraftLeg[]) {
  return {
    format: FILE_FORMAT,
    version: FILE_VERSION,
    instrument,
    exportedAt: new Date().toISOString(),
    legs: legs.map(({ enabled, side, type, strike, expiry, lots, price }) => ({
      enabled,
      side,
      type,
      strike,
      expiry,
      lots,
      price: price.trim() === "" ? null : Number(price),
    })),
  };
}

export type ParsedStrategy = {
  instrument: Instrument;
  legs: DraftLegInput[];
  /** Rows in the file that couldn't become a leg (closed, not an option, or a different underlying). */
  skipped: number;
};

function parseFileLeg(raw: unknown, index: number): DraftLegInput {
  const fail = (why: string): never => {
    throw new Error(`Leg ${index + 1} ${why}.`);
  };
  if (!isObject(raw)) return fail("isn't an object");
  if (raw.side !== "buy" && raw.side !== "sell") return fail("needs side \"buy\" or \"sell\"");
  if (raw.type !== "CE" && raw.type !== "PE") return fail("needs type \"CE\" or \"PE\"");
  if (typeof raw.strike !== "number" || !(raw.strike > 0)) return fail("needs a positive strike");
  if (typeof raw.expiry !== "string" || !ISO_DATE.test(raw.expiry)) return fail("needs an expiry as yyyy-mm-dd");
  if (typeof raw.lots !== "number" || !Number.isInteger(raw.lots) || raw.lots < 1) return fail("needs whole-number lots");
  if (raw.price != null && (typeof raw.price !== "number" || !(raw.price >= 0))) return fail("has an invalid price");
  return {
    enabled: raw.enabled !== false,
    side: raw.side,
    type: raw.type,
    strike: raw.strike,
    expiry: raw.expiry,
    lots: raw.lots,
    price: raw.price == null ? "" : String(raw.price),
  };
}

/** Throws an Error with a user-readable message when the data is neither accepted shape. */
export function parseStrategyImport(data: unknown): ParsedStrategy {
  if (isObject(data) && !Array.isArray(data) && data.format === FILE_FORMAT) {
    if (!isInstrument(data.instrument)) throw new Error("The file's underlying isn't Nifty, Bank Nifty or Sensex.");
    if (!Array.isArray(data.legs)) throw new Error("The file has no legs.");
    return { instrument: data.instrument, legs: data.legs.map(parseFileLeg), skipped: 0 };
  }

  if (Array.isArray(data)) {
    const byInstrument = new Map<Instrument, DraftLegInput[]>();
    let skipped = 0;
    for (const item of data) {
      const entry = item as TradeEntry;
      const leg = isObject(item) && isInstrument(entry.instrument) ? tradeEntryToLeg(entry, "entry") : null;
      if (!leg || !isInstrument(entry.instrument)) {
        skipped++;
        continue;
      }
      byInstrument.set(entry.instrument, [...(byInstrument.get(entry.instrument) ?? []), leg]);
    }
    // One strategy has one underlying — keep the index with the most open legs.
    const best = [...byInstrument.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    if (!best) throw new Error("No open option positions found in this file.");
    skipped += [...byInstrument.values()].reduce((acc, l) => acc + l.length, 0) - best[1].length;
    return { instrument: best[0], legs: best[1], skipped };
  }

  throw new Error("Not a strategy file or a trade-entries export.");
}
