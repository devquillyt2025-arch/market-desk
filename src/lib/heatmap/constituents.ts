/**
 * Constituents behind the Heatmap tab. Every stock is priced from its NSE
 * listing (`NSE_EQ|<ISIN>`) — including the Sensex ones, which also trade on
 * NSE under the same ISIN with a near-identical price. That keeps all three
 * indices on one exchange segment, so one proxy route and one quote
 * endpoint serves them all.
 *
 * Hand-maintained: NSE/BSE reconstitute these indices every March/September
 * (Nifty) and June/December (Sensex), so a stock that's been swapped out
 * needs updating here. Sources: NSE's published Nifty 50 / Nifty Bank lists
 * (niftyindices.com) and BSE's Sensex constituents. A stock missing from a
 * quote response simply doesn't render — it never breaks the grid.
 */

import { INSTRUMENT_LABELS, type Instrument } from "@/lib/types";

export type HeatmapStock = {
  /** NSE trading symbol — also the key for the logo image. */
  symbol: string;
  name: string;
  isin: string;
};

const STOCKS: Record<string, Omit<HeatmapStock, "symbol">> = {
  ADANIENT: { name: "Adani Enterprises", isin: "INE423A01024" },
  ADANIPORTS: { name: "Adani Ports and Special Economic Zone", isin: "INE742F01042" },
  APOLLOHOSP: { name: "Apollo Hospitals Enterprise", isin: "INE437A01024" },
  ASIANPAINT: { name: "Asian Paints", isin: "INE021A01026" },
  AUBANK: { name: "AU Small Finance Bank", isin: "INE949L01017" },
  AXISBANK: { name: "Axis Bank", isin: "INE238A01034" },
  "BAJAJ-AUTO": { name: "Bajaj Auto", isin: "INE917I01010" },
  BAJAJFINSV: { name: "Bajaj Finserv", isin: "INE918I01026" },
  BAJFINANCE: { name: "Bajaj Finance", isin: "INE296A01032" },
  BANKBARODA: { name: "Bank of Baroda", isin: "INE028A01039" },
  BEL: { name: "Bharat Electronics", isin: "INE263A01024" },
  BHARTIARTL: { name: "Bharti Airtel", isin: "INE397D01024" },
  BSE: { name: "BSE", isin: "INE118H01025" },
  CANBK: { name: "Canara Bank", isin: "INE476A01022" },
  CIPLA: { name: "Cipla", isin: "INE059A01026" },
  COALINDIA: { name: "Coal India", isin: "INE522F01014" },
  DRREDDY: { name: "Dr. Reddy's Laboratories", isin: "INE089A01031" },
  EICHERMOT: { name: "Eicher Motors", isin: "INE066A01021" },
  ETERNAL: { name: "Eternal", isin: "INE758T01015" },
  FEDERALBNK: { name: "Federal Bank", isin: "INE171A01029" },
  GRASIM: { name: "Grasim Industries", isin: "INE047A01021" },
  HCLTECH: { name: "HCL Technologies", isin: "INE860A01027" },
  HDFCBANK: { name: "HDFC Bank", isin: "INE040A01034" },
  HDFCLIFE: { name: "HDFC Life Insurance Company", isin: "INE795G01014" },
  HINDALCO: { name: "Hindalco Industries", isin: "INE038A01020" },
  HINDUNILVR: { name: "Hindustan Unilever", isin: "INE030A01027" },
  ICICIBANK: { name: "ICICI Bank", isin: "INE090A01021" },
  IDFCFIRSTB: { name: "IDFC First Bank", isin: "INE092T01019" },
  INDIGO: { name: "InterGlobe Aviation", isin: "INE646L01027" },
  INDUSINDBK: { name: "IndusInd Bank", isin: "INE095A01012" },
  INFY: { name: "Infosys", isin: "INE009A01021" },
  ITC: { name: "ITC", isin: "INE154A01025" },
  JIOFIN: { name: "Jio Financial Services", isin: "INE758E01017" },
  JSWSTEEL: { name: "JSW Steel", isin: "INE019A01038" },
  KOTAKBANK: { name: "Kotak Mahindra Bank", isin: "INE237A01036" },
  LT: { name: "Larsen & Toubro", isin: "INE018A01030" },
  "M&M": { name: "Mahindra & Mahindra", isin: "INE101A01026" },
  MARUTI: { name: "Maruti Suzuki India", isin: "INE585B01010" },
  MAXHEALTH: { name: "Max Healthcare Institute", isin: "INE027H01010" },
  NESTLEIND: { name: "Nestle India", isin: "INE239A01024" },
  NTPC: { name: "NTPC", isin: "INE733E01010" },
  ONGC: { name: "Oil & Natural Gas Corporation", isin: "INE213A01029" },
  PNB: { name: "Punjab National Bank", isin: "INE160A01022" },
  POWERGRID: { name: "Power Grid Corporation of India", isin: "INE752E01010" },
  RELIANCE: { name: "Reliance Industries", isin: "INE002A01018" },
  SBILIFE: { name: "SBI Life Insurance Company", isin: "INE123W01016" },
  SBIN: { name: "State Bank of India", isin: "INE062A01020" },
  SHRIRAMFIN: { name: "Shriram Finance", isin: "INE721A01047" },
  SUNPHARMA: { name: "Sun Pharmaceutical Industries", isin: "INE044A01036" },
  TATACONSUM: { name: "Tata Consumer Products", isin: "INE192A01025" },
  TATASTEEL: { name: "Tata Steel", isin: "INE081A01020" },
  TCS: { name: "Tata Consultancy Services", isin: "INE467B01029" },
  TECHM: { name: "Tech Mahindra", isin: "INE669C01036" },
  TITAN: { name: "Titan Company", isin: "INE280A01028" },
  TMPV: { name: "Tata Motors Passenger Vehicles", isin: "INE155A01022" },
  TRENT: { name: "Trent", isin: "INE849A01020" },
  ULTRACEMCO: { name: "UltraTech Cement", isin: "INE481G01011" },
  UNIONBANK: { name: "Union Bank of India", isin: "INE692A01016" },
  YESBANK: { name: "Yes Bank", isin: "INE528G01035" },
};

/** Nifty 50. */
const NIFTY_SYMBOLS: string[] = [
  "ADANIENT", "ADANIPORTS", "APOLLOHOSP", "ASIANPAINT",
  "AXISBANK", "BSE", "BAJAJ-AUTO", "BAJFINANCE",
  "BAJAJFINSV", "BEL", "BHARTIARTL", "CIPLA",
  "COALINDIA", "DRREDDY", "EICHERMOT", "ETERNAL",
  "GRASIM", "HCLTECH", "HDFCBANK", "HDFCLIFE",
  "HINDALCO", "HINDUNILVR", "ICICIBANK", "ITC",
  "INFY", "INDIGO", "JSWSTEEL", "JIOFIN",
  "KOTAKBANK", "LT", "M&M", "MARUTI",
  "MAXHEALTH", "NTPC", "NESTLEIND", "ONGC",
  "POWERGRID", "RELIANCE", "SBILIFE", "SHRIRAMFIN",
  "SBIN", "SUNPHARMA", "TCS", "TATACONSUM",
  "TMPV", "TATASTEEL", "TECHM", "TITAN",
  "TRENT", "ULTRACEMCO",
];

/** Nifty Bank. */
const BANKNIFTY_SYMBOLS: string[] = [
  "AUBANK", "AXISBANK", "BANKBARODA", "CANBK",
  "FEDERALBNK", "HDFCBANK", "ICICIBANK", "IDFCFIRSTB",
  "INDUSINDBK", "KOTAKBANK", "PNB", "SBIN",
  "UNIONBANK", "YESBANK",
];

/** BSE Sensex. */
const SENSEX_SYMBOLS: string[] = [
  "ADANIPORTS", "ASIANPAINT", "AXISBANK", "BAJFINANCE",
  "BAJAJFINSV", "BEL", "BHARTIARTL", "ETERNAL",
  "HCLTECH", "HDFCBANK", "HINDUNILVR", "ICICIBANK",
  "INDIGO", "INFY", "ITC", "KOTAKBANK",
  "LT", "M&M", "MARUTI", "NTPC",
  "POWERGRID", "RELIANCE", "SBIN", "SUNPHARMA",
  "TCS", "TATASTEEL", "TECHM", "TITAN",
  "TRENT", "ULTRACEMCO",
];

const INDEX_SYMBOLS: Record<Instrument, string[]> = {
  NIFTY: NIFTY_SYMBOLS,
  BANKNIFTY: BANKNIFTY_SYMBOLS,
  SENSEX: SENSEX_SYMBOLS,
};

/** The heatmap tabs, in display order. Labels come from the app-wide instrument labels, except Nifty — "Nifty 50" is what the index is called on a heatmap. */
export const HEATMAP_TABS: { id: Instrument; label: string }[] = [
  { id: "NIFTY", label: "Nifty 50" },
  { id: "BANKNIFTY", label: INSTRUMENT_LABELS.BANKNIFTY },
  { id: "SENSEX", label: INSTRUMENT_LABELS.SENSEX },
];

export function getHeatmapStocks(index: Instrument): HeatmapStock[] {
  return INDEX_SYMBOLS[index].map((symbol) => ({ symbol, ...STOCKS[symbol] }));
}

export function heatmapInstrumentKey(stock: Pick<HeatmapStock, "isin">): string {
  return `NSE_EQ|${stock.isin}`;
}
