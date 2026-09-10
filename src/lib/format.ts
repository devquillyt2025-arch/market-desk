const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

/** Rounds to whole rupees and formats with Indian digit grouping, e.g. ₹68,640. */
export function formatINR(amount: number): string {
  return inr.format(Math.round(amount));
}
