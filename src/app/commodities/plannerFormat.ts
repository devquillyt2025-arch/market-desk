/** How the planner writes its figures - one place, so the table, the plan and the chart agree. */

import { formatINR, formatLevel } from "@/lib/format";

export const tfLabel = (tf: number) => (tf === 60 ? "1h" : tf === 240 ? "4h" : `${tf}m`);
export const tfWords = (tf: number) => (tf === 60 ? "1-hour" : tf === 240 ? "4-hour" : `${tf}-minute`);
/** "₹306.30" - a price to the paisa. */
export const price = (n: number) => `₹${formatLevel(n)}`;
/** A rupee amount per lot, whole rupees, Indian grouping. */
export const inr = (n: number) => formatINR(n);
export const signedInr = (n: number) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${formatINR(Math.abs(n))}`;
export const pct = (n: number, digits = 2) => `${n.toFixed(digits)}%`;
/** "2h 10m" for a span of milliseconds. */
export function span(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(minutes / 60);
  return h > 0 ? `${h}h ${String(minutes % 60).padStart(2, "0")}m` : `${minutes}m`;
}
/** "10:15" for an instant, in IST. */
export const istClock = (ms: number) => new Date(ms + 19_800_000).toISOString().slice(11, 16);
/** "17 Nov 10:15" - a day and time in IST. */
export function istStampLong(ms: number): string {
  const d = new Date(ms + 19_800_000);
  return `${d.getUTCDate()} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()]} ${d.toISOString().slice(11, 16)}`;
}
