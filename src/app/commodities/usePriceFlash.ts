"use client";

import { useState } from "react";

export type Flash = { dir: "up" | "down"; n: number } | null;

/**
 * Notices when a price ticks: `dir` says which way it went, and `n` counts the ticks so a caller can key an element on it
 * and restart its flash animation each time (the same direction twice in a row would otherwise not replay).
 *
 * Nothing flashes while `enabled` is false - a closed market, or last-known prices held through an outage, haven't
 * "ticked" - and nothing flashes for the first price it sees.
 *
 * It compares during render rather than in an effect (React's own pattern for state that follows a prop): no extra
 * render after the paint, and no frame where the new price is shown without its flash.
 */
export function usePriceFlash(price: number | undefined, enabled: boolean): Flash {
  const [seen, setSeen] = useState(price);
  const [flash, setFlash] = useState<Flash>(null);
  if (price !== seen) {
    setSeen(price);
    if (enabled && price !== undefined && seen !== undefined) {
      setFlash({ dir: price > seen ? "up" : "down", n: (flash?.n ?? 0) + 1 });
    }
  }
  return flash;
}
