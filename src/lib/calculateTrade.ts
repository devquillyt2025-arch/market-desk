/**
 * Pure P&L math for a multi-leg options-selling trade. No React, no Supabase —
 * this is the one place the numbers get computed, so a future bulk
 * analyser/backtester can call it per historical trade without duplicating
 * the logic.
 */

export type TradeLegInput = {
  sellPrice: number;
  buyPrice: number;
};

export type TradeLegResult = TradeLegInput & {
  net: number;
};

export type TradeCalculation = {
  legs: TradeLegResult[];
  totalNet: number;
  totalPnl: number;
};

/** Avoids float artifacts like 0.1 + 0.2 showing up in a price column. */
export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function calculateTrade(legs: TradeLegInput[], qty: number): TradeCalculation {
  const resolvedLegs = legs.map((leg) => ({
    ...leg,
    net: round2(leg.sellPrice - leg.buyPrice),
  }));

  const totalNet = round2(resolvedLegs.reduce((sum, leg) => sum + leg.net, 0));
  const totalPnl = round2(totalNet * qty);

  return { legs: resolvedLegs, totalNet, totalPnl };
}
