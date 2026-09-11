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
