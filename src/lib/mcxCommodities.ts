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
  LEAD: { name: "Lead", glyph: "Pb", unit: "₹/kg" },
  LEADMINI: { name: "Lead Mini", glyph: "Pb", unit: "₹/kg" },
  NICKEL: { name: "Nickel", glyph: "Ni", unit: "₹/kg" },
  COTTON: { name: "Cotton", glyph: "CO", unit: "₹/bale" },
  COTTONOIL: { name: "Cottonseed Oil", glyph: "CO", unit: "" },
  KAPAS: { name: "Kapas", glyph: "KA", unit: "" },
  CARDAMOM: { name: "Cardamom", glyph: "CD", unit: "" },
  MENTHAOIL: { name: "Mentha Oil", glyph: "MO", unit: "" },
  SUNOIL: { name: "Sunflower Oil", glyph: "SO", unit: "" },
  STEELREBAR: { name: "Steel Rebar", glyph: "SR", unit: "" },
  ELECDMBL: { name: "Electricity", glyph: "EL", unit: "" },
};

/**
 * The commodities on the Heatmap's Commodities tab and in the Watchlist's starting list: the liquid energy and base/precious
 * metals, in the order a trader reads them. Each is quoted on its current-month future.
 */
export const HEATMAP_COMMODITIES = ["CRUDEOIL", "NATURALGAS", "GOLD", "SILVER", "COPPER", "ZINC", "ALUMINIUM", "LEAD", "NICKEL"] as const;

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
