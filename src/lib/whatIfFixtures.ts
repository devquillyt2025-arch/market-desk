/**
 * Shared fixtures for the What-if lab's tests: a coherent option chain (zero-rate Black-Scholes at 14%
 * vol, so prices, spreads and odds agree with each other), position rows priced off it, and a helper
 * that builds the book and underlyings a lab run starts from. Test-only - nothing in the app imports it.
 */

import assert from "node:assert/strict";

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { normCdf, yearsToExpiry } from "@/lib/calculateRisk";
import { DEFAULT_LOT_SIZES, type TradeEntry } from "@/lib/types";
import type { UpstoxOptionChainResult } from "@/lib/upstox/types";
import { buildBook, buildUnderlyings } from "@/lib/whatIf";

export const NOW = Date.parse("2026-11-05T05:00:00Z"); // Thursday 10:30 IST
export const EXPIRY = "2026-11-10";
export const KEY = `NIFTY|${EXPIRY}`;
export const SPOT = 24000;
export const LOT = DEFAULT_LOT_SIZES.NIFTY;

// --- fixtures: a coherent option chain (zero-rate Black-Scholes at 14% vol) -----------------

function bs(strike: number, isCall: boolean, ivPct = 14): number {
  const t = yearsToExpiry(EXPIRY, new Date(NOW));
  const sd = (ivPct / 100) * Math.sqrt(t);
  const d1 = (Math.log(SPOT / strike) + (sd * sd) / 2) / sd;
  const d2 = d1 - sd;
  return isCall ? SPOT * normCdf(d1) - strike * normCdf(d2) : strike * normCdf(-d2) - SPOT * normCdf(-d1);
}

export function chain(): UpstoxOptionChainResult {
  const data = [];
  for (let strike = 23000; strike <= 25000; strike += 50) {
    const leg = (isCall: boolean) => ({
      instrument_key: `NSE_FO|${strike}${isCall ? "C" : "P"}`,
      market_data: { ltp: Math.round(bs(strike, isCall) * 20) / 20 || 0.05, oi: 200_000, volume: 1000 },
      option_greeks: { iv: 14, delta: isCall ? 0.5 : -0.5, gamma: 0.001, theta: -10, vega: 8 },
    });
    data.push({ strike_price: strike, underlying_spot_price: SPOT, call_options: leg(true), put_options: leg(false) });
  }
  return { status: "success", data };
}

export const CHAINS = { [KEY]: chain() };

export function ltpOf(strike: number, isCall: boolean): number {
  return Math.round(bs(strike, isCall) * 20) / 20;
}

let seq = 0;
function entry(over: Partial<TradeEntry>): TradeEntry {
  seq += 1;
  return {
    id: `e${seq}`,
    user_id: null,
    entry_date: "2026-11-02",
    instrument: "NIFTY",
    strike_price: 24000,
    option_type: "CE",
    expiry_date: EXPIRY,
    closing_date: null,
    lots: 4,
    side: "buy",
    buy_price: 180,
    sell_price: 180,
    pnl: 0,
    status: "hold",
    remarks: null,
    created_at: "2026-11-02T04:00:00Z",
    updated_at: "2026-11-02T04:00:00Z",
    ...over,
  };
}

export function row(over: Partial<TradeEntry>, entryPrice: number): PortfolioRow {
  const e = entry({ ...over, buy_price: entryPrice, sell_price: entryPrice });
  const isCall = e.option_type === "CE";
  const ltp = ltpOf(e.strike_price!, isCall);
  return {
    entry: e,
    entryPrice,
    status: "ok",
    instrumentKey: `NSE_FO|${e.strike_price}${isCall ? "C" : "P"}`,
    liveLtp: ltp,
    livePnl: 0,
    prevClose: ltp,
    delta: isCall ? 0.5 : -0.5,
    gamma: 0.001,
    theta: -10,
    vega: 8,
    oi: 200_000,
    iv: 14,
    volume: 1000,
    underlyingSpot: SPOT,
    nearbyIv: 14,
    brokerageIfClosed: 40,
    stale: false,
    asOf: null,
  };
}

export const longCall = () => row({ strike_price: 24000, option_type: "CE", lots: 4, side: "buy" }, 180);
export const shortCall = () => row({ strike_price: 24200, option_type: "CE", lots: 2, side: "sell" }, 90);

export function setup(rows: PortfolioRow[], funds: number | null = null) {
  const book = buildBook(rows, NOW);
  const unders = buildUnderlyings(CHAINS, NOW);
  return { book, unders, funds, focusKey: KEY };
}

export const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
