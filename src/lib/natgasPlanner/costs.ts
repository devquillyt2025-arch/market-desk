/** What a round trip costs, and the tick arithmetic the stops and targets are rounded with. */

import { COSTS, LOT, TICK } from "@/lib/natgasPlanner/config";

const cents = (x: number) => Math.round(x * 100) / 100;

/** Rounds a price distance UP to the next tick (a stop is never tighter than asked for). */
export const roundUpToTick = (x: number): number => cents(Math.ceil(x / TICK - 1e-9) * TICK);
/** Rounds a price distance to the nearest tick. */
export const roundToTick = (x: number): number => cents(Math.round(x / TICK) * TICK);

/**
 * Brokerage, exchange and SEBI charges, CTT, stamp duty and GST on one lot bought at `buyPrice` and sold at `sellPrice`, in rupees.
 * For a long the buy is the entry fill and the sell the exit; for a short, the reverse. Unrounded: callers round what they show.
 */
export function fees(buyPrice: number, sellPrice: number, lot: number = LOT): number {
  const buyValue = buyPrice * lot;
  const sellValue = sellPrice * lot;
  const brokerage = COSTS.brokeragePerOrder * 2;
  const exchange = COSTS.exchangeAndSebi * (buyValue + sellValue);
  const ctt = COSTS.ctt * sellValue;
  const stamp = COSTS.stamp * buyValue;
  const gst = COSTS.gst * (brokerage + exchange);
  return brokerage + exchange + ctt + stamp + gst;
}

/** The tightest stop distance (rupees a mmBtu) at which a round trip's costs plus two ticks stay near a fifth of the risk. */
export function costFloor(price: number): number {
  return (fees(price, price) / LOT + COSTS.floorExtraTicks * TICK) / COSTS.floorCostShare;
}
