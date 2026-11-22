/**
 * What the app knows about MCX commodities beyond what Upstox sends: a readable name, the unit the price is quoted
 * in, and a short glyph for a tile. Pure - shared by the Heatmap's Commodities tab and the Watchlist, on the server
 * and in the browser.
 *
 * Upstox calls the full-size and mini contracts by one exchange name ("CRUDE OIL"), so the symbol is the identity
 * here, and the name says which one it is.
 */

type CommodityInfo = {
  name: string;
  /** Two or three characters for a tile: the chemical symbol for a metal, the futures root for energy. */
  glyph: string;
  /** What one unit of the quoted price buys, e.g. "₹/bbl" - empty when it isn't worth saying. */
  unit: string;
};

const INFO: Record<string, CommodityInfo> = {
  CRUDEOIL: { name: "Crude Oil", glyph: "CL", unit: "₹/bbl" },
  CRUDEOILM: { name: "Crude Oil Mini", glyph: "CL", unit: "₹/bbl" },
  NATURALGAS: { name: "Natural Gas", glyph: "NG", unit: "₹/mmBtu" },
  NATGASMINI: { name: "Natural Gas Mini", glyph: "NG", unit: "₹/mmBtu" },
  GOLD: { name: "Gold", glyph: "Au", unit: "₹/10 g" },
  GOLDM: { name: "Gold Mini", glyph: "Au", unit: "₹/10 g" },
  GOLDTEN: { name: "Gold Ten", glyph: "Au", unit: "₹/10 g" },
  GOLDGUINEA: { name: "Gold Guinea", glyph: "Au", unit: "₹/8 g" },
  GOLDPETAL: { name: "Gold Petal", glyph: "Au", unit: "₹/g" },
  SILVER: { name: "Silver", glyph: "Ag", unit: "₹/kg" },
  SILVERM: { name: "Silver Mini", glyph: "Ag", unit: "₹/kg" },
  SILVERMIC: { name: "Silver Micro", glyph: "Ag", unit: "₹/kg" },
  SILVER100: { name: "Silver 100", glyph: "Ag", unit: "" },
  COPPER: { name: "Copper", glyph: "Cu", unit: "₹/kg" },
  ZINC: { name: "Zinc", glyph: "Zn", unit: "₹/kg" },
  ZINCMINI: { name: "Zinc Mini", glyph: "Zn", unit: "₹/kg" },
  ALUMINIUM: { name: "Aluminium", glyph: "Al", unit: "₹/kg" },
  ALUMINI: { name: "Aluminium Mini", glyph: "Al", unit: "₹/kg" },
  COTTON: { name: "Cotton", glyph: "CO", unit: "₹/bale" },
  COTTONOIL: { name: "Cottonseed Oil", glyph: "CO", unit: "" },
  KAPAS: { name: "Kapas", glyph: "KA", unit: "" },
  SUNOIL: { name: "Sunflower Oil", glyph: "SO", unit: "" },
  ELECDMBL: { name: "Electricity", glyph: "EL", unit: "" },
};

/**
 * The commodities a fresh Watchlist starts with (and its database seed): the liquid energy and base/precious metals, in the
 * order a trader reads them. Each is quoted on its current-month future. The Heatmap's Commodities tab is not limited to these -
 * it shows every commodity the exchange lists (see commodityFutures).
 */
export const STARTING_COMMODITIES = ["CRUDEOIL", "NATURALGAS", "GOLD", "SILVER", "COPPER", "ZINC", "ALUMINIUM"] as const;

function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

/** The MCX indices (MCXBULLDEX, MCXMETLDEX) trade as futures too, but they are indices, not commodities. */
export function isMcxCommodity(symbol: string): boolean {
  return !symbol.startsWith("MCX");
}

/**
 * Commodities the exchange lists that this app deliberately doesn't offer, anywhere: not on the Heatmap, not in the Watchlist's
 * search, not as an instrument. The Heatmap and the search read the exchange's own contract list, so removing a commodity from the
 * app's tables alone would not keep it out - it would reappear the moment the exchange listed it. This list does.
 */
export const NOT_OFFERED_COMMODITIES: ReadonlySet<string> = new Set(["MENTHAOIL", "CARDAMOM", "LEAD", "LEADMINI", "NICKEL"]);

/** A commodity the app offers: an MCX commodity (not one of its indices) that isn't in NOT_OFFERED_COMMODITIES. */
export function isOfferedCommodity(symbol: string): boolean {
  return isMcxCommodity(symbol) && !NOT_OFFERED_COMMODITIES.has(symbol);
}

/**
 * The commodities among a set of MCX futures, in the order given. The exchange's list also carries its two indices (MCXBULLDEX,
 * MCXMETLDEX), which trade as futures but aren't commodities, and commodities this app doesn't offer (NOT_OFFERED_COMMODITIES).
 * Taking the commodities from the exchange's own list, rather than from a list written down here, means one that starts trading
 * later shows up without a code change.
 */
export function commodityFutures<T extends { symbol: string }>(futures: Iterable<T>): T[] {
  return [...futures].filter((future) => isOfferedCommodity(future.symbol));
}

/** "Crude Oil", "Gold Mini" - from the catalog, or tidied from the exchange's own name for a commodity not in it. */
export function commodityName(symbol: string, exchangeName?: string): string {
  return INFO[symbol]?.name ?? titleCase(exchangeName ?? symbol);
}

export function commodityGlyph(symbol: string): string {
  return INFO[symbol]?.glyph ?? symbol.slice(0, 2).toUpperCase();
}

/** "₹/bbl" - empty for a commodity whose unit isn't known. */
export function commodityUnit(symbol: string): string {
  return INFO[symbol]?.unit ?? "";
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 2026" from a contract's yyyy-mm-dd expiry. */
export function contractMonthLabel(expiryIso: string): string {
  const [year, month] = expiryIso.split("-");
  const name = MONTHS[Number(month) - 1];
  return name && year ? `${name} ${year}` : expiryIso;
}
