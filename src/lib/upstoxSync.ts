/**
 * Pure reconciliation between what Upstox reports and what this app has
 * stored — no React, no fetching, no Supabase. Live Portfolio mirrors the
 * account's open positions; Trade Entries takes in the closed round trips of
 * Upstox's P&L report. Each works out a plan here first, so the stores only
 * have to write it, and the import dialog can show it before anything changes.
 *
 * Neither table carries an Upstox id: rows are matched on what they hold
 * (contract, side, lots, prices, dates), which also lets entries typed in by
 * hand before the sync existed be recognised instead of duplicated.
 */

import { round2 } from "@/lib/calculateTrade";
import type { AddTradeEntryInput } from "@/lib/tradeEntriesStore";
import type { LivePortfolioEntry, TradeEntry } from "@/lib/types";
import type { UpstoxClosedTrade, UpstoxPnlReportSuccess, UpstoxPosition } from "@/lib/upstox/types";

/** Same format as calculatePortfolio's legSnapshotKey, so a position can find its live-priced row. */
export function positionContractKey(p: Pick<UpstoxPosition, "instrument" | "expiry" | "strike" | "optionType">): string {
  return `${p.instrument}|${p.expiry}|${p.strike}|${p.optionType}`;
}

function entryToInput(entry: TradeEntry): AddTradeEntryInput {
  return {
    entryDate: entry.entry_date,
    instrument: entry.instrument,
    strikePrice: entry.strike_price ?? undefined,
    optionType: entry.option_type ?? undefined,
    expiryDate: entry.expiry_date ?? undefined,
    closingDate: entry.closing_date ?? undefined,
    lots: entry.lots,
    side: entry.side,
    buyPrice: Number(entry.buy_price),
    sellPrice: Number(entry.sell_price),
    status: entry.status,
    remarks: entry.remarks ?? undefined,
  };
}

function averageOf(value: number, quantity: number): number | null {
  return quantity > 0 ? round2(value / quantity) : null;
}

// --- Live Portfolio ---------------------------------------------------------

export type PositionSyncPlan = {
  /** `key` names the position (contract, side, date opened), so the same new position always gets the same row id. */
  inserts: { key: string; input: AddTradeEntryInput }[];
  /** Open rows whose lots or price changed on Upstox. */
  updates: { entry: LivePortfolioEntry; input: AddTradeEntryInput }[];
  /** Open rows Upstox no longer has open — squared off as of `today`. */
  closes: { entry: LivePortfolioEntry; input: AddTradeEntryInput }[];
};

function holdsContract(entry: TradeEntry, p: UpstoxPosition): boolean {
  return (
    entry.instrument === p.instrument &&
    entry.strike_price != null &&
    Number(entry.strike_price) === p.strike &&
    entry.option_type === p.optionType &&
    entry.expiry_date === p.expiry
  );
}

/**
 * Makes Live Portfolio's open ("hold") rows match the account's open
 * positions one-to-one. A row that already matches a position keeps its own
 * entry date, remarks and — unless the position was traded today — its price:
 * Upstox's average for a carried position may be marked to an earlier close,
 * while the row has what it was actually opened at. Rows with no open
 * position behind them any more are squared off, at Upstox's exit price when
 * the position closed today (otherwise it's no longer in the response).
 */
export function planPositionSync(entries: LivePortfolioEntry[], positions: UpstoxPosition[], today: string): PositionSyncPlan {
  const remaining = entries.filter((e) => e.status === "hold");
  const plan: PositionSyncPlan = { inserts: [], updates: [], closes: [] };

  for (const p of positions) {
    if (p.quantity === 0 || p.averagePrice == null) continue;
    const side = p.quantity > 0 ? "buy" : "sell";
    const lots = Math.max(1, Math.round(Math.abs(p.quantity) / p.lotSize));
    const price = p.averagePrice;

    const index = remaining.findIndex((e) => holdsContract(e, p) && e.side === side);
    if (index === -1) {
      const entryDate = p.overnightQuantity === 0 ? today : (p.openedOn ?? today);
      plan.inserts.push({
        key: `${p.instrumentKey}|${side}|${entryDate}`,
        input: {
          entryDate,
          instrument: p.instrument,
          strikePrice: p.strike,
          optionType: p.optionType,
          expiryDate: p.expiry,
          lots,
          side,
          // Same convention as the entry form: both legs at the entry price
          // until the position closes, so it starts at zero P&L.
          buyPrice: price,
          sellPrice: price,
          status: "hold",
        },
      });
      continue;
    }

    const [entry] = remaining.splice(index, 1);
    const tradedToday = p.dayBuyQuantity > 0 || p.daySellQuantity > 0;
    const entryPrice = round2(Number(side === "sell" ? entry.sell_price : entry.buy_price));
    if (entry.lots === lots && (!tradedToday || entryPrice === price)) continue;
    plan.updates.push({ entry, input: { ...entryToInput(entry), lots, buyPrice: price, sellPrice: price } });
  }

  for (const entry of remaining) {
    const flat = positions.find((p) => p.quantity === 0 && holdsContract(entry, p));
    const exit = flat
      ? entry.side === "buy"
        ? averageOf(flat.daySellValue, flat.daySellQuantity)
        : averageOf(flat.dayBuyValue, flat.dayBuyQuantity)
      : null;
    const input = entryToInput(entry);
    plan.closes.push({
      entry,
      input: {
        ...input,
        status: "squared_off",
        closingDate: today,
        buyPrice: entry.side === "sell" && exit != null ? exit : input.buyPrice,
        sellPrice: entry.side === "buy" && exit != null ? exit : input.sellPrice,
      },
    });
  }

  return plan;
}

/**
 * A position's P&L for today's session — trades made today, plus the open
 * quantity marked to `ltp` (falling back to Upstox's last price), less what
 * was carried in at the previous close. Covers positions squared off today,
 * which the open rows on screen no longer do. Same sign convention as livePnl,
 * and likewise before charges. Null when a price it needs is missing.
 */
export function positionDayPnl(p: UpstoxPosition, ltp: number | null): number | null {
  const price = ltp ?? p.lastPrice;
  if (p.quantity !== 0 && price == null) return null;
  if (p.overnightQuantity !== 0 && p.closePrice == null) return null;
  return round2(p.daySellValue - p.dayBuyValue + p.quantity * (price ?? 0) - p.overnightQuantity * (p.closePrice ?? 0));
}

// --- Trade Entries ----------------------------------------------------------

export type TradeImportItem =
  | { kind: "new"; trade: UpstoxClosedTrade }
  | { kind: "update"; trade: UpstoxClosedTrade; entry: TradeEntry; changes: string[] }
  | { kind: "same"; trade: UpstoxClosedTrade; entry: TradeEntry };

export type TradeImportPlan = {
  items: TradeImportItem[];
  /** Closed entries inside the report's dates that match no trade in it — offered for removal, never removed by default. */
  missing: TradeEntry[];
};

function sameContract(entry: TradeEntry, t: UpstoxClosedTrade): boolean {
  return (
    entry.instrument === t.instrument &&
    (entry.strike_price == null ? null : Number(entry.strike_price)) === t.strike &&
    (entry.option_type ?? null) === t.optionType
  );
}

/** What a matched entry would change to, as short labels for the import dialog — empty when it already agrees. */
function differences(entry: TradeEntry, t: UpstoxClosedTrade): string[] {
  const changes: string[] = [];
  if (entry.entry_date !== t.entryDate || entry.closing_date !== t.closingDate) changes.push("dates");
  if (entry.expiry_date !== t.expiry) changes.push("expiry");
  if (entry.side !== t.side) changes.push("side");
  if (entry.lots !== t.lots) changes.push("lots");
  if (round2(Number(entry.buy_price)) !== t.buyPrice || round2(Number(entry.sell_price)) !== t.sellPrice) changes.push("prices");
  if (round2(Number(entry.pnl)) !== t.pnl) changes.push("P&L");
  if (entry.status !== "squared_off") changes.push("status");
  return changes;
}

/**
 * Lines a financial year of Upstox trades up against the journal, one-to-one.
 * First on contract + lots + both prices (prices get copied off the broker
 * exactly, while hand-typed dates and expiries are where mistakes creep in),
 * then on contract + lots + a shared date for whatever's left. Only entries
 * dated inside the report's year are considered. An entry closed today is
 * never called missing: Upstox adds a day's trades to the report the next day.
 */
export function planTradeImport(
  entries: TradeEntry[],
  report: Pick<UpstoxPnlReportSuccess, "trades" | "from" | "to">,
  today: string,
): TradeImportPlan {
  const inYear = (d: string | null) => d != null && d >= report.from && d <= report.to;
  const remaining = entries.filter((e) => inYear(e.entry_date) || inYear(e.closing_date));
  const matched = new Map<string, TradeEntry>();

  function take(predicate: (e: TradeEntry) => boolean): TradeEntry | null {
    const index = remaining.findIndex(predicate);
    return index === -1 ? null : remaining.splice(index, 1)[0];
  }

  for (const t of report.trades) {
    const entry = take(
      (e) =>
        sameContract(e, t) &&
        e.lots === t.lots &&
        round2(Number(e.buy_price)) === t.buyPrice &&
        round2(Number(e.sell_price)) === t.sellPrice,
    );
    if (entry) matched.set(t.key, entry);
  }
  for (const t of report.trades) {
    if (matched.has(t.key)) continue;
    const entry = take(
      (e) =>
        sameContract(e, t) &&
        e.lots === t.lots &&
        [e.entry_date, e.closing_date].some((d) => d === t.entryDate || d === t.closingDate),
    );
    if (entry) matched.set(t.key, entry);
  }

  const items: TradeImportItem[] = report.trades.map((trade) => {
    const entry = matched.get(trade.key);
    if (!entry) return { kind: "new", trade };
    const changes = differences(entry, trade);
    return changes.length > 0 ? { kind: "update", trade, entry, changes } : { kind: "same", trade, entry };
  });

  // A trade belongs to the year it closed in, so one opened in March and
  // closed in April is only missing if April's year doesn't have it.
  const missing = remaining.filter((e) => {
    const closed = e.closing_date ?? e.entry_date;
    return e.status === "squared_off" && inYear(closed) && closed < today;
  });
  return { items, missing };
}
