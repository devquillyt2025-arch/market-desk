/**
 * The global prices in the strip across the top of every page: crude oil abroad (WTI, Brent), the dollar-rupee rate,
 * and the other commodities held on MCX. An MCX crude price is, to a close approximation, WTI times USD/INR, so the
 * strip also shows that product ("WTI in ₹") for reading straight against the Crude Oil prices elsewhere in the app.
 *
 * Pure - no network, no React - so the parsing, the derived price and the formatting are tested on their own.
 * The prices come from Yahoo Finance's public chart feed (see globalMarketsFeed.ts): futures arrive about ten
 * minutes behind the exchange, which the strip says rather than hides.
 */

export type GlobalMarketId = "WTI" | "BRENT" | "USDINR" | "NATGAS" | "GOLD";

type GlobalMarketDef = {
  id: GlobalMarketId;
  /** The Yahoo Finance symbol. */
  symbol: string;
  /** Short enough for a tile. */
  label: string;
  /** The full name, for the tooltip. */
  title: string;
  /** What one unit of the price buys. */
  unit: string;
  currency: "USD" | "INR";
  decimals: number;
  /** Past this age the price is last session's - the market is closed, or the feed has gone quiet. */
  staleAfterMs: number;
};

const MINUTE = 60_000;

/** In the order they appear on the strip. Futures tick all day; the rupee rate updates far less often. */
export const GLOBAL_MARKETS: readonly GlobalMarketDef[] = [
  { id: "WTI", symbol: "CL=F", label: "WTI", title: "WTI crude oil (NYMEX, front month)", unit: "$/bbl", currency: "USD", decimals: 2, staleAfterMs: 45 * MINUTE },
  { id: "BRENT", symbol: "BZ=F", label: "Brent", title: "Brent crude oil (front month)", unit: "$/bbl", currency: "USD", decimals: 2, staleAfterMs: 45 * MINUTE },
  { id: "USDINR", symbol: "INR=X", label: "USD/INR", title: "US dollar in Indian rupees", unit: "₹ per $", currency: "INR", decimals: 2, staleAfterMs: 360 * MINUTE },
  { id: "NATGAS", symbol: "NG=F", label: "Nat gas", title: "Natural gas, Henry Hub (NYMEX, front month)", unit: "$/mmBtu", currency: "USD", decimals: 3, staleAfterMs: 45 * MINUTE },
  { id: "GOLD", symbol: "GC=F", label: "Gold", title: "Gold (COMEX, front month)", unit: "$/oz", currency: "USD", decimals: 1, staleAfterMs: 45 * MINUTE },
];

const BY_ID = new Map<GlobalMarketId, GlobalMarketDef>(GLOBAL_MARKETS.map((def) => [def.id, def]));

export function isGlobalMarketId(value: unknown): value is GlobalMarketId {
  return typeof value === "string" && BY_ID.has(value as GlobalMarketId);
}

export type GlobalQuote = {
  id: GlobalMarketId;
  price: number;
  /** The previous session's close, or null when the feed didn't say - there is then no change to show. */
  previousClose: number | null;
  /** When the feed last updated this price (ms since epoch) - not when it was fetched. */
  asOf: number;
  dayHigh: number | null;
  dayLow: number | null;
};

export type GlobalMarketsResult = {
  quotes: GlobalQuote[];
  /** Markets the feed had no usable price for this time. */
  missing: GlobalMarketId[];
  /** When the server fetched them. */
  fetchedAt: number;
};

export type GlobalMarketsError = { error: string };

export function isGlobalMarketsError(value: GlobalMarketsResult | GlobalMarketsError): value is GlobalMarketsError {
  return "error" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Whether `value` is a quote this module would have produced - used on what comes back from the API and from storage. */
export function isGlobalQuote(value: unknown): value is GlobalQuote {
  if (!isRecord(value) || !isGlobalMarketId(value.id)) return false;
  const price = finite(value.price);
  if (price === null || price <= 0 || finite(value.asOf) === null) return false;
  const optional = (v: unknown) => v === null || finite(v) !== null;
  return optional(value.previousClose) && optional(value.dayHigh) && optional(value.dayLow);
}

/**
 * One market's quote out of a Yahoo Finance chart response (`/v8/finance/chart/<symbol>?interval=1d&range=1d`), or null
 * when the response has no usable price. Only `meta` is read: it carries the live price, the previous close and the
 * time of the last update, so the day's candles are never needed.
 */
export function parseYahooChart(id: GlobalMarketId, body: unknown): GlobalQuote | null {
  if (!isRecord(body) || !isRecord(body.chart) || !Array.isArray(body.chart.result)) return null;
  const meta = body.chart.result[0]?.meta;
  if (!isRecord(meta)) return null;

  const price = finite(meta.regularMarketPrice);
  const updatedSeconds = finite(meta.regularMarketTime);
  if (price === null || price <= 0 || updatedSeconds === null) return null;

  const previous = finite(meta.chartPreviousClose) ?? finite(meta.previousClose);
  return {
    id,
    price,
    previousClose: previous !== null && previous > 0 ? previous : null,
    asOf: updatedSeconds * 1000,
    dayHigh: finite(meta.regularMarketDayHigh),
    dayLow: finite(meta.regularMarketDayLow),
  };
}

/** The live price, the time of its last update and the contract's name out of a Yahoo chart response, or null without a usable price. */
export function parseYahooMeta(body: unknown): { price: number; asOf: number; name: string | null } | null {
  if (!isRecord(body) || !isRecord(body.chart) || !Array.isArray(body.chart.result)) return null;
  const meta = body.chart.result[0]?.meta;
  if (!isRecord(meta)) return null;
  const price = finite(meta.regularMarketPrice);
  const updatedSeconds = finite(meta.regularMarketTime);
  if (price === null || price <= 0 || updatedSeconds === null) return null;
  return { price, asOf: updatedSeconds * 1000, name: typeof meta.shortName === "string" ? meta.shortName : null };
}

/** One candle of a Yahoo intraday chart: when it began, and where it closed. */
export type YahooCandle = { startMs: number; close: number };

/** The candles of a Yahoo chart response (oldest first), skipping the empty ones Yahoo leaves as nulls. */
export function parseYahooCandles(body: unknown): YahooCandle[] {
  if (!isRecord(body) || !isRecord(body.chart) || !Array.isArray(body.chart.result)) return [];
  const result = body.chart.result[0];
  if (!isRecord(result) || !Array.isArray(result.timestamp) || !isRecord(result.indicators) || !Array.isArray(result.indicators.quote)) return [];
  const closes = isRecord(result.indicators.quote[0]) ? result.indicators.quote[0].close : null;
  if (!Array.isArray(closes)) return [];
  const out: YahooCandle[] = [];
  result.timestamp.forEach((seconds: unknown, i: number) => {
    const start = finite(seconds);
    const close = finite(closes[i]);
    if (start !== null && close !== null && close > 0) out.push({ startMs: start * 1000, close });
  });
  return out.sort((a, b) => a.startMs - b.startMs);
}

/**
 * The price at `ms`: the close of the last candle that had finished by then - never a price from after it. Null when there is
 * none, or when it ended more than `maxGapMs` before `ms` (the market was shut, or the feed hasn't caught up).
 */
export function priceBefore(candles: readonly YahooCandle[], ms: number, candleMs = 60_000, maxGapMs = 5 * 60_000): number | null {
  let best: YahooCandle | null = null;
  for (const candle of candles) {
    if (candle.startMs + candleMs <= ms) best = candle;
    else break;
  }
  return best && ms - (best.startMs + candleMs) <= maxGapMs ? best.close : null;
}

/** How far a price has moved since the previous close, or null without one. */
export function changeOf(quote: Pick<GlobalQuote, "price" | "previousClose">): { change: number; percent: number } | null {
  if (quote.previousClose === null || quote.previousClose <= 0) return null;
  const change = quote.price - quote.previousClose;
  return { change, percent: (change / quote.previousClose) * 100 };
}

export type StripItem = {
  key: string;
  label: string;
  title: string;
  unit: string;
  /** Null when there is no price for it this time. */
  quote: GlobalQuote | null;
  format: (value: number) => string;
  staleAfterMs: number;
};

const formatters = new Map<string, Intl.NumberFormat>();
function formatFixed(value: number, decimals: number, locale: "en-US" | "en-IN"): string {
  const key = `${locale}:${decimals}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    formatters.set(key, formatter);
  }
  return formatter.format(value);
}

function formatterFor(def: GlobalMarketDef): (value: number) => string {
  return def.currency === "USD"
    ? (value) => `$${formatFixed(value, def.decimals, "en-US")}`
    : (value) => `₹${formatFixed(value, def.decimals, "en-IN")}`;
}

/**
 * WTI priced in rupees: the dollar price times the rupee rate, for the price and the previous close alike, so its
 * change is the whole move since yesterday - oil's and the rupee's together. Null until both prices are in.
 * `asOf` follows WTI: it is the part that moves, and the rate only drifts.
 */
export function wtiInRupees(quotes: Partial<Record<GlobalMarketId, GlobalQuote>>): GlobalQuote | null {
  const wti = quotes.WTI;
  const rate = quotes.USDINR;
  if (!wti || !rate) return null;
  return {
    id: "WTI",
    price: wti.price * rate.price,
    previousClose: wti.previousClose !== null && rate.previousClose !== null ? wti.previousClose * rate.previousClose : null,
    asOf: wti.asOf,
    dayHigh: null,
    dayLow: null,
  };
}

/** The tiles of the strip, in order, whether or not their prices have arrived. */
export function buildStrip(quotes: Partial<Record<GlobalMarketId, GlobalQuote>>): StripItem[] {
  const items: StripItem[] = GLOBAL_MARKETS.map((def) => ({
    key: def.id,
    label: def.label,
    title: def.title,
    unit: def.unit,
    quote: quotes[def.id] ?? null,
    format: formatterFor(def),
    staleAfterMs: def.staleAfterMs,
  }));

  const wti = BY_ID.get("WTI");
  const rupees: StripItem = {
    key: "WTI_INR",
    label: "WTI in ₹",
    title: "WTI × USD/INR - roughly what MCX crude oil follows",
    unit: "₹/bbl",
    quote: wtiInRupees(quotes),
    format: (value) => `₹${formatFixed(value, 0, "en-IN")}`,
    staleAfterMs: wti?.staleAfterMs ?? 45 * MINUTE,
  };
  // Right after the rupee rate it is built from.
  const at = items.findIndex((item) => item.key === "USDINR");
  items.splice(at + 1, 0, rupees);
  return items;
}

/** Whether a price is older than its market should let it be - closed, or the feed has gone quiet. */
export function isStale(quote: Pick<GlobalQuote, "asOf">, staleAfterMs: number, now: number = Date.now()): boolean {
  return now - quote.asOf > staleAfterMs;
}

export type GlobalMarketsStatus = {
  tone: "loading" | "live" | "closed" | "problem";
  /** What to show beside the label at any width, so a problem or a closed market is never missed; null when all is well. */
  tag: "Offline" | "Feed down" | "Closed" | null;
  /** The sentence for a tooltip or a wide screen. For a problem, the caller can add when the prices on screen are from. */
  summary: string;
};

/**
 * How the prices on screen stand, in one place so the strip and the Watchlist's section never disagree: the browser is
 * offline, the feed is down, the markets are closed, or all is well. `reference` is when the prices were fetched - ages are
 * measured against that, not the clock, which keeps this pure and is right when the data is old because the browser was offline.
 */
export function marketsStatus(input: { items: readonly StripItem[]; loading: boolean; offline: boolean; feedError: string | null; reference: number }): GlobalMarketsStatus {
  if (input.offline) return { tone: "problem", tag: "Offline", summary: "Offline" };
  if (input.feedError) return { tone: "problem", tag: "Feed down", summary: "Price feed unavailable" };
  if (input.loading) return { tone: "loading", tag: null, summary: "Loading prices…" };
  // "Closed" only when both crude prices are in and both are old - a missing price is a feed problem, not a closed market.
  const crude = input.items.filter((item) => item.key === "WTI" || item.key === "BRENT");
  if (crude.every((item) => item.quote !== null && isStale(item.quote, item.staleAfterMs, input.reference))) {
    return { tone: "closed", tag: "Closed", summary: "Markets closed · last prices" };
  }
  return { tone: "live", tag: null, summary: "Delayed ~10 min · Yahoo Finance" };
}

/** The map the strip and the hook pass around: the latest quote per market. */
export function quotesById(quotes: readonly GlobalQuote[]): Partial<Record<GlobalMarketId, GlobalQuote>> {
  const map: Partial<Record<GlobalMarketId, GlobalQuote>> = {};
  for (const quote of quotes) map[quote.id] = quote;
  return map;
}
