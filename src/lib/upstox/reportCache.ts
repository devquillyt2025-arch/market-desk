/**
 * Pure: the last good copy of Upstox's P&L report that Reports keeps on this device, so the page isn't blank on a morning
 * when the daily Upstox token has lapsed (or offline) - it shows what it last saw, labelled with when. localStorage can be
 * missing, full, or hold anything, so what is read back is checked rather than trusted.
 */

import type { UpstoxReportTrade } from "@/lib/upstox/types";

export const REPORT_CACHE_KEY = "marketdesk:upstox-report";

export type StoredReport = { fetchedAt: number; trades: UpstoxReportTrade[] };

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether `value` has everything Reports reads from a trade - anything less would draw a chart with holes in it. */
export function isReportTrade(value: unknown): value is UpstoxReportTrade {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    isString(t.id) &&
    isString(t.segment) &&
    isString(t.instrument) &&
    isString(t.label) &&
    isString(t.entry_date) && ISO_DAY.test(t.entry_date) &&
    isString(t.closing_date) && ISO_DAY.test(t.closing_date) &&
    isNumber(t.pnl) &&
    isNumber(t.buy_amount) &&
    isNumber(t.sell_amount) &&
    isNumber(t.quantity) &&
    isString(t.created_at) &&
    (t.side === null || t.side === "buy" || t.side === "sell")
  );
}

/** A saved report read back from storage, or null if it is missing, damaged, or not one. */
export function parseStoredReport(raw: string | null): StoredReport | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const { fetchedAt, trades } = parsed as Partial<StoredReport>;
    if (!isNumber(fetchedAt) || !Array.isArray(trades) || !trades.every(isReportTrade)) return null;
    return { fetchedAt, trades };
  } catch {
    return null;
  }
}
