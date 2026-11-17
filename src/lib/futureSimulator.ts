/**
 * The arithmetic behind Live Portfolio's Simulate tab for an index future: "what if I added (or exited) N lots at
 * this price?". Pure, read-only, no React. A future has no premium, strike or decay, so none of the averaging
 * simulator's option maths applies - what is left is a blended entry price, a break-even, the profit or loss it
 * would book, and what the order costs in brokerage and taxes.
 *
 * Every price here is the future's real price (what the contract trades at), not the index-terms price the
 * What-if engine models it in - the odds, the chart and the margin check come from that engine; see whatIf.ts.
 */

import { calculateBrokerage } from "@/lib/calculateBrokerage";
import { round2 } from "@/lib/calculateTrade";

export type FuturePosition = {
  side: "buy" | "sell";
  lots: number;
  lotSize: number;
  /** Price the open lots were entered at. */
  avgPrice: number;
  /** What the contract trades at now. */
  livePrice: number;
};

export type FutureOrder =
  /** More lots the same way round, at `price`. */
  | { kind: "add"; lots: number; price: number }
  /** Close `lots` of the position at `price`. */
  | { kind: "exit"; lots: number; price: number };

export type FutureSnapshot = {
  lots: number;
  qty: number;
  /** Blended entry price of what is open - 0 once nothing is. */
  avgPrice: number;
  /** Profit or loss on what is open, at the live price, before brokerage. */
  pnl: number;
  /** ₹ gained or lost for a 100-point move in the index, against the position. */
  per100Points: number;
  /** Points the future has to move before the position is back to even (negative: it is already in profit by that much). Positive means it must move in the position's favour. */
  pointsToBreakeven: number;
};

export type FutureSimulation = {
  before: FutureSnapshot;
  after: FutureSnapshot;
  /** Profit or loss locked in by an exit, before charges; 0 for an add. */
  booked: number;
  /** Estimated brokerage, taxes and fees of the order. */
  charges: number;
  /** The order's lots after being held within what is open: an exit can't close more than there is. */
  lots: number;
};

const sign = (side: FuturePosition["side"]) => (side === "sell" ? -1 : 1);

function snapshot(side: FuturePosition["side"], lots: number, lotSize: number, avgPrice: number, livePrice: number): FutureSnapshot {
  const qty = lots * lotSize;
  const s = sign(side);
  return {
    lots,
    qty,
    avgPrice: lots > 0 ? round2(avgPrice) : 0,
    pnl: lots > 0 ? round2(s * (livePrice - avgPrice) * qty) : 0,
    per100Points: s * 100 * qty,
    // Long: breaks even again at the average, so it needs avg − live. Short: live − avg.
    pointsToBreakeven: lots > 0 ? round2(s * (avgPrice - livePrice)) : 0,
  };
}

export function simulateFuture(position: FuturePosition, order: FutureOrder): FutureSimulation {
  const { side, lots, lotSize, avgPrice, livePrice } = position;
  const before = snapshot(side, lots, lotSize, avgPrice, livePrice);
  const s = sign(side);
  const orderLots = order.kind === "exit" ? Math.min(Math.max(Math.floor(order.lots), 0), lots) : Math.max(Math.floor(order.lots), 0);
  const orderQty = orderLots * lotSize;

  let after: FutureSnapshot;
  let booked = 0;
  if (order.kind === "add") {
    const total = lots + orderLots;
    const blended = total > 0 ? (lots * avgPrice + orderLots * order.price) / total : avgPrice;
    after = snapshot(side, total, lotSize, blended, livePrice);
  } else {
    booked = round2(s * (order.price - avgPrice) * orderQty);
    after = snapshot(side, lots - orderLots, lotSize, avgPrice, livePrice);
  }

  // An add opens in the position's own direction; an exit closes the other way.
  const buying = order.kind === "add" ? side === "buy" : side === "sell";
  const charges =
    orderQty > 0
      ? calculateBrokerage("FUTURES", [buying ? { buyPrice: order.price, sellPrice: 0 } : { buyPrice: 0, sellPrice: order.price }], orderQty).totalCharges
      : 0;

  return { before, after, booked, charges, lots: orderLots };
}
