import type { CSSProperties } from "react";

import type { WatchlistKind } from "@/lib/watchlist";

/** A colour per kind of instrument, as references into the app's theme tokens (so each holds in light and dark). */
export const KIND_TONE: Record<WatchlistKind, string> = {
  index: "var(--accent)",
  commodity: "var(--warning)",
  equity: "var(--info)",
};

/** Sets `--tone` for everything inside - the tile, the glow, the chip - to read. */
export function toneStyle(kind: WatchlistKind): CSSProperties {
  return { "--tone": KIND_TONE[kind] } as CSSProperties;
}
