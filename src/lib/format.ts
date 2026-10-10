const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Rounds to whole rupees and formats with Indian digit grouping, e.g. ₹68,640. */
export function formatINR(amount: number): string {
  return inr.format(Math.round(amount));
}

const level = new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** An index level or a point move to the paisa with Indian digit grouping, e.g. 22,421.95 or -198.50. */
export function formatLevel(value: number): string {
  return level.format(value);
}

/**
 * When a last-known price was fetched: just the time for today ("3:29:41 pm"),
 * with the date for any earlier day ("9 Oct, 3:29 pm") — the daily Upstox token
 * lapses overnight, so the last price on screen is often yesterday's.
 */
export function formatAsOf(ms: number, now: number = Date.now()): string {
  const at = new Date(ms);
  if (at.toDateString() === new Date(now).toDateString()) return at.toLocaleTimeString("en-IN");
  return at.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

/** Text color token for a P&L figure — green above zero, red below, neutral at zero. */
export function pnlColorClass(pnl: number): string {
  if (pnl > 0) return "text-profit";
  if (pnl < 0) return "text-loss";
  return "text-foreground";
}

/** Signed percentage, e.g. +12.3% / -4.5% / 0.0% — 1 decimal by default. */
export function formatPct(pct: number, decimals = 1): string {
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(decimals)}%`;
}

/** Compact Indian-style amount for tight spaces — 1.14L, 39.2K, 2.5Cr — without a currency symbol. */
export function formatCompactINR(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";
  if (abs >= 1e7) return `${sign}${(abs / 1e7).toFixed(2)}Cr`;
  if (abs >= 1e5) return `${sign}${(abs / 1e5).toFixed(2)}L`;
  if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${Math.round(abs)}`;
}
