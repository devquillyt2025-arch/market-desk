import type { MoveDirection } from "@/lib/watchlist";

/**
 * How an up, a down and a flat move are painted - written out in full so Tailwind sees every class. Colour is never the
 * only signal: each also gets an arrow (or a dash) and a signed figure beside it.
 */
export const DIRECTION: Record<MoveDirection, { text: string; pill: string; fill: string; label: string }> = {
  up: { text: "text-profit", pill: "bg-profit/10 text-profit ring-profit/25", fill: "bg-profit", label: "up" },
  down: { text: "text-danger-fg", pill: "bg-danger-fg/10 text-danger-fg ring-danger-fg/25", fill: "bg-danger-fg", label: "down" },
  flat: { text: "text-muted-foreground", pill: "bg-muted text-muted-foreground ring-border", fill: "bg-muted-foreground", label: "flat" },
};

/** A small solid triangle (or a dash, when flat) in the current text colour. */
export function MoveArrow({ direction, className = "size-2.5" }: { direction: MoveDirection; className?: string }) {
  if (direction === "flat") return <span aria-hidden="true" className="inline-block h-0.5 w-2.5 rounded-full bg-current" />;
  return (
    <svg viewBox="0 0 10 10" className={className} aria-hidden="true">
      <path d={direction === "up" ? "M5 1.5 9.2 8.5H0.8Z" : "M5 8.5 0.8 1.5h8.4Z"} fill="currentColor" />
    </svg>
  );
}
