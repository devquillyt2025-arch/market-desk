/**
 * Which icon an instrument gets in the Watchlist: a drawn one for a commodity (oil drop, gas flame, gold bars ...), and a
 * monogram placeholder for everything else. Indices and stocks have no logo that can be shipped or fetched reliably - the
 * exchange logos that are public range from a 16px dot (NSE) to a wide wordmark with a tagline (BSE), which are not
 * consistent in a small square - so they keep a clean monogram. Pure, so the mapping can be tested.
 */

import type { WatchlistKind } from "@/lib/watchlist";

export type IconKind = "oil" | "gas" | "gold" | "silver" | "copper" | "metal" | "agri" | "power" | "monogram";

/** MCX symbols with a drawn icon. A commodity not listed here gets a monogram. */
const COMMODITY_ICONS: Record<string, IconKind> = {
  CRUDEOIL: "oil",
  CRUDEOILM: "oil",
  NATURALGAS: "gas",
  NATGASMINI: "gas",
  GOLD: "gold",
  GOLDM: "gold",
  GOLDTEN: "gold",
  GOLDGUINEA: "gold",
  GOLDPETAL: "gold",
  SILVER: "silver",
  SILVERM: "silver",
  SILVERMIC: "silver",
  SILVER100: "silver",
  COPPER: "copper",
  ZINC: "metal",
  ZINCMINI: "metal",
  ALUMINIUM: "metal",
  ALUMINI: "metal",
  LEAD: "metal",
  LEADMINI: "metal",
  NICKEL: "metal",
  STEELREBAR: "metal",
  COTTON: "agri",
  COTTONOIL: "agri",
  KAPAS: "agri",
  CARDAMOM: "agri",
  MENTHAOIL: "agri",
  SUNOIL: "agri",
  ELECDMBL: "power",
};

export function instrumentIconKind(item: { kind: WatchlistKind; symbol: string }): IconKind {
  return item.kind === "commodity" ? (COMMODITY_ICONS[item.symbol] ?? "monogram") : "monogram";
}

/** Theme tokens only, so each holds in light and dark. A colour per icon, read by the tile as `--tone`. */
const ICON_TONES: Record<Exclude<IconKind, "monogram">, string> = {
  oil: "color-mix(in srgb, var(--warning) 50%, var(--foreground))",
  gas: "var(--info)",
  gold: "var(--warning)",
  silver: "var(--muted-foreground)",
  copper: "color-mix(in srgb, var(--danger) 40%, var(--warning))",
  metal: "color-mix(in srgb, var(--info) 40%, var(--muted-foreground))",
  agri: "var(--success)",
  power: "var(--accent)",
};

/** Stocks take one of these by their symbol, so a list of them isn't one colour - and never red or green, which already mean down and up. */
const MONOGRAM_TONES = ["var(--accent)", "var(--info)", "var(--accent-soft)", "var(--warning)"] as const;

function hashString(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}

/** The tile's colour for an instrument. */
export function iconTone(item: { kind: WatchlistKind; symbol: string }): string {
  const icon = instrumentIconKind(item);
  if (icon !== "monogram") return ICON_TONES[icon];
  if (item.kind === "equity") return MONOGRAM_TONES[hashString(item.symbol) % MONOGRAM_TONES.length];
  return item.kind === "commodity" ? "var(--warning)" : "var(--accent)";
}
