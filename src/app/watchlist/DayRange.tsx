import { dayRangePosition, formatRangeValue } from "@/lib/watchlist";

/**
 * Where the price sits in today's low-to-high range: the two ends as numbers and a bar between them, filled in the colour of
 * the day's move. Nothing when the feed gave no usable range. Shared by the Global markets tab's two tables.
 */
export function DayRange({ low, high, price, direction }: { low: number | null; high: number | null; price: number; direction: "up" | "down" | "flat" }) {
  const position = dayRangePosition(low, high, price);
  if (position === null || low === null || high === null) return null;
  const fill = direction === "down" ? "bg-danger-fg/70" : direction === "up" ? "bg-profit/70" : "bg-muted-foreground/50";

  return (
    <div
      role="img"
      aria-label={`Today's range ${formatRangeValue(low)} to ${formatRangeValue(high)}; the price is ${Math.round(position * 100)}% of the way up`}
      className="flex items-center gap-2 font-mono text-xs tabular-nums text-muted-foreground"
    >
      <span className="w-12 text-right">{formatRangeValue(low)}</span>
      <div className="relative h-1.5 min-w-16 flex-1 rounded-full bg-muted">
        <span className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${fill}`} style={{ width: `${position * 100}%` }} />
        <span
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-foreground shadow transition-[left] duration-500"
          style={{ left: `${position * 100}%` }}
        />
      </div>
      <span className="w-12">{formatRangeValue(high)}</span>
    </div>
  );
}
