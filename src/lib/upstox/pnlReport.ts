/**
 * Server-only: Upstox's trade-wise P&L report for one segment (F&O, equity) —
 * the rows (`/v2/trade/profit-loss/data`, paged) and the year's charges
 * (`/v2/trade/profit-loss/charges`). Shared by the pnl-report route (Trade
 * Entries' sync) and pnl-summary (Reports' Upstox Trade Summary).
 *
 * Upstox asks for one financial year per call ("2627" = Apr 2026 – Mar 2027).
 * An optional date range inside it narrows the result to trades that closed
 * in that range — checked against the live API: an October range keeps a
 * trade sold in September and bought back in October.
 */

import { round2 } from "@/lib/calculateTrade";
import { isUpstoxGetError, num, upstoxData, upstoxGet, type UpstoxGetError } from "@/lib/upstox/api";
import type { UpstoxChargesBreakdown, UpstoxPnlSegment } from "@/lib/upstox/types";

export type DateRange = { from: string; to: string };

/** Where a report call is pointed: which segment, which financial year, optionally which dates inside it. */
export type ReportScope = { segment: UpstoxPnlSegment; fyStart: number; range?: DateRange };

/** The financial year a yyyy-mm-dd date falls in, as the year it starts in. */
export function fyStartOf(isoDate: string): number {
  const [year, month] = isoDate.split("-").map(Number);
  return month >= 4 ? year : year - 1;
}

/** 2026 → "2627", the form Upstox wants. */
export function financialYearCode(fyStart: number): string {
  return `${String(fyStart).slice(2)}${String(fyStart + 1).slice(2)}`;
}

/** "2026-10-30" → "30-10-2026". */
function upstoxDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-");
  return `${d}-${m}-${y}`;
}

function reportParams({ segment, fyStart, range }: ReportScope): URLSearchParams {
  const params = new URLSearchParams({ segment, financial_year: financialYearCode(fyStart) });
  if (range) {
    params.set("from_date", upstoxDate(range.from));
    params.set("to_date", upstoxDate(range.to));
  }
  return params;
}

/** Every row of one year's report — one per matched fill, so a 3-lot exit is three rows. */
export async function getPnlReportRows(
  token: string,
  scope: ReportScope,
): Promise<{ rows: Record<string, unknown>[] } | UpstoxGetError> {
  const metaResult = await upstoxGet(token, `/v2/trade/profit-loss/metadata?${reportParams(scope)}`);
  if (isUpstoxGetError(metaResult)) return metaResult;
  const meta = upstoxData(metaResult.body) as { trades_count?: unknown; page_size_limit?: unknown } | undefined;
  const tradesCount = num(meta?.trades_count);
  const pageSize = Math.min(num(meta?.page_size_limit) || 5000, 5000);

  const rows: Record<string, unknown>[] = [];
  for (let page = 1; (page - 1) * pageSize < tradesCount; page++) {
    const params = reportParams(scope);
    params.set("page_number", String(page));
    params.set("page_size", String(pageSize));
    const result = await upstoxGet(token, `/v2/trade/profit-loss/data?${params}`);
    if (isUpstoxGetError(result)) return result;
    const data = upstoxData(result.body);
    if (!Array.isArray(data)) return { error: "Upstox's P&L report was missing the expected data.", status: 502 };
    rows.push(...(data as Record<string, unknown>[]));
    if (data.length < pageSize) break;
  }
  return { rows };
}

/**
 * Upstox's own charges for the year (or range), broken down. For F&O its API
 * lumps exchange transaction charges and SEBI fees together under "others"
 * (its app splits them); for equity it reports them apart. Either way they're
 * summed into one line here, so every segment reads the same.
 */
export async function getPnlCharges(
  token: string,
  scope: ReportScope,
): Promise<{ charges: UpstoxChargesBreakdown } | UpstoxGetError> {
  const result = await upstoxGet(token, `/v2/trade/profit-loss/charges?${reportParams(scope)}`);
  if (isUpstoxGetError(result)) return result;
  const breakdown = (upstoxData(result.body) as { charges_breakdown?: Record<string, unknown> } | undefined)?.charges_breakdown;
  if (!breakdown) return { error: "Upstox's charges response was missing the expected data.", status: 502 };

  const taxes = (breakdown.taxes ?? {}) as Record<string, unknown>;
  const charges = (breakdown.charges ?? {}) as Record<string, unknown>;
  return {
    charges: {
      total: round2(num(breakdown.total)),
      brokerage: round2(num(breakdown.brokerage)),
      gst: round2(num(taxes.gst)),
      stt: round2(num(taxes.stt)),
      stampDuty: round2(num(taxes.stamp_duty)),
      transactionAndSebi: round2(num(charges.transaction) + num(charges.sebi_turnover) + num(charges.others)),
      clearing: round2(num(charges.clearing)),
      ipft: round2(num(charges.ipft)),
      demat: round2(num(charges.demat_transaction)),
    },
  };
}
