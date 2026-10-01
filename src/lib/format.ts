const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Rounds to whole rupees and formats with Indian digit grouping, e.g. ₹68,640. */
export function formatINR(amount: number): string {
  return inr.format(Math.round(amount));
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
