import { useEffect, useState } from "react";

const FLASH_MS = 800;

/**
 * Which way the price last ticked, for a moment after each change - the cue that a number on screen is live. Derived while
 * rendering (React's "adjust state when a prop changes" pattern) rather than in an effect, so there is no frame
 * where the new price shows without its flash. Nothing flashes on the first price, or when a stale price is
 * replaced by a live one (`quiet`): that is a refresh, not a tick.
 */
export function useTickFlash(price: number | undefined, quiet: boolean): { dir: "up" | "down"; on: boolean } {
  const [seen, setSeen] = useState(price);
  const [flash, setFlash] = useState<{ dir: "up" | "down"; on: boolean }>({ dir: "up", on: false });

  if (price !== seen) {
    setSeen(price);
    if (price !== undefined && seen !== undefined && !quiet) setFlash({ dir: price > seen ? "up" : "down", on: true });
  }

  useEffect(() => {
    if (!flash.on) return;
    const id = setTimeout(() => setFlash((f) => ({ ...f, on: false })), FLASH_MS);
    return () => clearTimeout(id);
  }, [flash]);

  return flash;
}
