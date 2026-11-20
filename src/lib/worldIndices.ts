/**
 * The stock-market indices of the rest of the world, for the Watchlist's Global markets tab: the US, Canada and Brazil,
 * Europe, Japan, China, Hong Kong, Korea and the other Asia-Pacific markets, and the Gulf, Egypt, Israel and South
 * Africa. India's own are on the Indian markets tab, from Upstox.
 *
 * Pure - no network, no React - so the list, the parsing and the open / closed rule are tested on their own. The
 * prices come from Yahoo Finance's public chart feed (see worldIndicesFeed.ts). It lags the exchanges - 15 minutes
 * for most - and the tab says so. Each symbol here was checked against the feed and returns a level, a previous close
 * and the day's range; ones it has no data for (Chile, Norway, Russia, the UAE, Qatar) or whose price has not moved
 * for weeks (Argentina's Merval) are left out rather than shown as a number that looks live.
 */

export type WorldRegion = "americas" | "europe" | "asia" | "mea";

/** In the order they are shown. */
export const WORLD_REGIONS: readonly { id: WorldRegion; label: string }[] = [
  { id: "americas", label: "Americas" },
  { id: "europe", label: "Europe" },
  { id: "asia", label: "Asia-Pacific" },
  { id: "mea", label: "Middle East & Africa" },
];

export type WorldIndexDef = {
  /** The Yahoo Finance symbol - also the index's identity everywhere in the app. */
  id: string;
  name: string;
  country: string;
  /** Two letters, for the small country mark (flag emoji don't draw on Windows). */
  code: string;
  region: WorldRegion;
  /**
   * Yahoo files this one under another market's time zone, so the trading window it reports can't be used to say whether it
   * is open - only how recently it traded can.
   */
  ignoreSessionWindow?: boolean;
};

const def = (id: string, name: string, country: string, code: string, region: WorldRegion, ignoreSessionWindow?: boolean): WorldIndexDef =>
  ignoreSessionWindow ? { id, name, country, code, region, ignoreSessionWindow } : { id, name, country, code, region };

/** Within a region, the biggest markets first. */
export const WORLD_INDICES: readonly WorldIndexDef[] = [
  def("^GSPC", "S&P 500", "United States", "US", "americas"),
  def("^DJI", "Dow Jones", "United States", "US", "americas"),
  def("^IXIC", "Nasdaq Composite", "United States", "US", "americas"),
  def("^NDX", "Nasdaq 100", "United States", "US", "americas"),
  def("^RUT", "Russell 2000", "United States", "US", "americas"),
  def("^GSPTSE", "S&P/TSX Composite", "Canada", "CA", "americas"),
  def("^BVSP", "Ibovespa", "Brazil", "BR", "americas"),
  def("^MXX", "IPC Mexico", "Mexico", "MX", "americas"),

  def("^FTSE", "FTSE 100", "United Kingdom", "GB", "europe"),
  def("^GDAXI", "DAX", "Germany", "DE", "europe"),
  def("^FCHI", "CAC 40", "France", "FR", "europe"),
  def("^STOXX50E", "Euro Stoxx 50", "Eurozone", "EU", "europe"),
  def("^SSMI", "SMI", "Switzerland", "CH", "europe"),
  def("^IBEX", "IBEX 35", "Spain", "ES", "europe"),
  def("FTSEMIB.MI", "FTSE MIB", "Italy", "IT", "europe"),
  def("^AEX", "AEX", "Netherlands", "NL", "europe"),
  def("^OMXS30", "OMX Stockholm 30", "Sweden", "SE", "europe", true),
  def("^BFX", "BEL 20", "Belgium", "BE", "europe"),
  def("^ATX", "ATX", "Austria", "AT", "europe"),
  def("PSI20.LS", "PSI", "Portugal", "PT", "europe"),
  def("WIG20.WA", "WIG20", "Poland", "PL", "europe"),
  def("XU100.IS", "BIST 100", "Türkiye", "TR", "europe"),

  def("^N225", "Nikkei 225", "Japan", "JP", "asia"),
  def("^HSI", "Hang Seng", "Hong Kong", "HK", "asia"),
  def("000001.SS", "Shanghai Composite", "China", "CN", "asia"),
  def("399001.SZ", "Shenzhen Component", "China", "CN", "asia"),
  def("000300.SS", "CSI 300", "China", "CN", "asia"),
  def("399006.SZ", "ChiNext", "China", "CN", "asia"),
  def("^KS11", "KOSPI", "South Korea", "KR", "asia"),
  def("^KQ11", "KOSDAQ", "South Korea", "KR", "asia"),
  def("^TWII", "Taiwan TAIEX", "Taiwan", "TW", "asia"),
  def("^AXJO", "S&P/ASX 200", "Australia", "AU", "asia"),
  def("^STI", "Straits Times", "Singapore", "SG", "asia"),
  def("^JKSE", "IDX Composite", "Indonesia", "ID", "asia"),
  def("^KLSE", "FTSE Bursa Malaysia KLCI", "Malaysia", "MY", "asia"),
  def("^SET.BK", "SET Index", "Thailand", "TH", "asia"),
  def("PSEI.PS", "PSEi", "Philippines", "PH", "asia"),
  def("^VNINDEX.VN", "VN-Index", "Vietnam", "VN", "asia"),
  def("^NZ50", "NZX 50", "New Zealand", "NZ", "asia"),

  def("^TASI.SR", "Tadawul All Share", "Saudi Arabia", "SA", "mea"),
  def("^TA125.TA", "TA-125", "Israel", "IL", "mea"),
  def("^CASE30", "EGX 30", "Egypt", "EG", "mea"),
  def("^J203.JO", "JSE All Share", "South Africa", "ZA", "mea"),
];

const BY_ID = new Map<string, WorldIndexDef>(WORLD_INDICES.map((d) => [d.id, d]));

export function worldIndexDef(id: string): WorldIndexDef | undefined {
  return BY_ID.get(id);
}

export type WorldQuote = {
  id: string;
  price: number;
  /** The previous session's close, or null when the feed didn't say - there is then no move to show. */
  previousClose: number | null;
  /** When the feed last updated the price (ms since epoch) - not when it was fetched. */
  asOf: number;
  dayHigh: number | null;
  dayLow: number | null;
  /** Where the day (or, for a market that is shut, its last session) opened. Absent on a level saved before this was kept. */
  open?: number | null;
  /** Today's regular trading window as Yahoo reports it (ms since epoch), or null when it gave none. */
  sessionStart: number | null;
  sessionEnd: number | null;
};

export type WorldIndicesResult = {
  quotes: WorldQuote[];
  /** Indices the feed had no usable price for this time. */
  missing: string[];
  /** When the server fetched them. */
  fetchedAt: number;
};

export type WorldIndicesError = { error: string };

export function isWorldIndicesError(value: WorldIndicesResult | WorldIndicesError): value is WorldIndicesError {
  return "error" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Whether `value` is a quote this module would have produced - checked on what comes back from the API and from storage. */
export function isWorldQuote(value: unknown): value is WorldQuote {
  if (!isRecord(value) || typeof value.id !== "string" || !BY_ID.has(value.id)) return false;
  const price = finite(value.price);
  if (price === null || price <= 0 || finite(value.asOf) === null) return false;
  const optional = (v: unknown) => v === null || finite(v) !== null;
  return (
    optional(value.previousClose) &&
    optional(value.dayHigh) &&
    optional(value.dayLow) &&
    optional(value.sessionStart) &&
    optional(value.sessionEnd) &&
    (value.open === undefined || optional(value.open))
  );
}

/**
 * One index's quote out of a Yahoo chart response (`/v8/finance/chart/<symbol>?interval=1d&range=1d`), or null when the
 * response has no usable price. `meta` gives the live level, the previous close, the day's range, the time of the last
 * update and today's trading window; the open is the one candle's open (range=1d at a one-day interval is a single candle).
 */
export function parseWorldChart(id: string, body: unknown): WorldQuote | null {
  if (!isRecord(body) || !isRecord(body.chart) || !Array.isArray(body.chart.result)) return null;
  const meta = body.chart.result[0]?.meta;
  if (!isRecord(meta)) return null;

  const price = finite(meta.regularMarketPrice);
  const updatedSeconds = finite(meta.regularMarketTime);
  if (price === null || price <= 0 || updatedSeconds === null) return null;

  const previous = finite(meta.chartPreviousClose) ?? finite(meta.previousClose);
  const result = body.chart.result[0] as Record<string, unknown>;
  const quoteSeries = isRecord(result.indicators) && Array.isArray(result.indicators.quote) && isRecord(result.indicators.quote[0]) ? result.indicators.quote[0] : null;
  const opens = quoteSeries && Array.isArray(quoteSeries.open) ? quoteSeries.open : [];
  const lastOpen = [...opens].reverse().map(finite).find((v): v is number => v !== null && v > 0) ?? null;
  const period = isRecord(meta.currentTradingPeriod) && isRecord(meta.currentTradingPeriod.regular) ? meta.currentTradingPeriod.regular : null;
  const start = period ? finite(period.start) : null;
  const end = period ? finite(period.end) : null;
  return {
    id,
    price,
    previousClose: previous !== null && previous > 0 ? previous : null,
    asOf: updatedSeconds * 1000,
    dayHigh: finite(meta.regularMarketDayHigh),
    dayLow: finite(meta.regularMarketDayLow),
    open: lastOpen,
    sessionStart: start === null ? null : start * 1000,
    sessionEnd: end === null ? null : end * 1000,
  };
}

/** A price this recent is "live" for a feed that runs about 15 minutes behind, with room for the slow tickers. */
export const OPEN_FRESH_MS = 40 * 60_000;

/**
 * Whether the market is trading as of `nowMs`: its price is recent, and - where Yahoo's trading window can be trusted - the
 * window has begun and not ended. Freshness catches what the window can't: a public holiday, when the window still lists
 * the day's hours but nothing trades. Lunch breaks (Tokyo, Hong Kong, Shanghai) are not told apart, so those read as open
 * through them, then closed once nothing has traded for 40 minutes.
 */
export function isSessionOpen(quote: Pick<WorldQuote, "asOf" | "sessionStart" | "sessionEnd">, index: Pick<WorldIndexDef, "ignoreSessionWindow">, nowMs: number): boolean {
  if (nowMs - quote.asOf > OPEN_FRESH_MS) return false;
  if (index.ignoreSessionWindow || quote.sessionStart === null || quote.sessionEnd === null) return true;
  return nowMs >= quote.sessionStart && nowMs < quote.sessionEnd;
}

/** The map the page and the hook pass around: the latest quote per index. */
export function worldQuotesById(quotes: readonly WorldQuote[]): Record<string, WorldQuote> {
  const map: Record<string, WorldQuote> = {};
  for (const quote of quotes) map[quote.id] = quote;
  return map;
}
