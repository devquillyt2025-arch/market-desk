/**
 * The Heatmap's period filter: 1D is "today vs the previous close"; every
 * longer range compares today's price to the close on (or just before) the
 * date that far back. Shared by the server route, which does the comparing,
 * and the view, which draws the buttons and the color legend.
 */

import { addDays } from "@/lib/calculateStrategy";

export const HEATMAP_RANGES = ["1D", "5D", "1M", "3M", "6M", "1Y", "3Y", "5Y"] as const;
export type HeatmapRange = (typeof HEATMAP_RANGES)[number];

export const DEFAULT_HEATMAP_RANGE: HeatmapRange = "1D";

export function isHeatmapRange(value: unknown): value is HeatmapRange {
  return (HEATMAP_RANGES as readonly unknown[]).includes(value);
}

/** Reads naturally after "has moved", e.g. "has moved over the last 3 months". */
export const RANGE_PHRASES: Record<HeatmapRange, string> = {
  "1D": "since the previous close",
  "5D": "over the last 5 days",
  "1M": "over the last month",
  "3M": "over the last 3 months",
  "6M": "over the last 6 months",
  "1Y": "over the last year",
  "3Y": "over the last 3 years",
  "5Y": "over the last 5 years",
};

/**
 * Where the color shades switch, in percent, for each range. A 2% day is a big
 * move while a 2% year is nothing, so one fixed scale would paint every long
 * range a single color. `small` splits the soft shade from the solid one;
 * `large` splits the solid shade from the deep one — the same on both sides of
 * zero. 1D's `small` matches the original design; 1Y's pair is its legend.
 */
export const RANGE_BANDS: Record<HeatmapRange, { small: number; large: number }> = {
  "1D": { small: 2, large: 5 },
  "5D": { small: 3, large: 10 },
  "1M": { small: 5, large: 15 },
  "3M": { small: 5, large: 25 },
  "6M": { small: 5, large: 35 },
  "1Y": { small: 5, large: 50 },
  "3Y": { small: 10, large: 100 },
  "5Y": { small: 10, large: 200 },
};

/** `iso` moved by whole months, clamping to the month's last day (31 Mar − 1 month → 28/29 Feb, not 3 Mar). */
function shiftMonths(iso: string, months: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return `${targetYear}-${String(targetMonth + 1).padStart(2, "0")}-${String(Math.min(day, lastDay)).padStart(2, "0")}`;
}

/**
 * The date a longer range looks back to — today's price is measured against
 * the last close on or before it. 5D looks back a full week: five trading
 * sessions is the same weekday last week, which stays right whether today is
 * a trading day or a weekend (counting sessions would be off by one in one of
 * the two). 1D isn't here — it uses Upstox's own previous close.
 */
export function rangeStartDate(range: Exclude<HeatmapRange, "1D">, todayIso: string): string {
  switch (range) {
    case "5D":
      return addDays(todayIso, -7);
    case "1M":
      return shiftMonths(todayIso, -1);
    case "3M":
      return shiftMonths(todayIso, -3);
    case "6M":
      return shiftMonths(todayIso, -6);
    case "1Y":
      return shiftMonths(todayIso, -12);
    case "3Y":
      return shiftMonths(todayIso, -36);
    case "5Y":
      return shiftMonths(todayIso, -60);
  }
}
