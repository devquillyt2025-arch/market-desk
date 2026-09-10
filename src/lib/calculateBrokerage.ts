/**
 * Charge model sourced from Upstox's public brokerage calculator
 * (https://upstox.com/calculator/brokerage-calculator/) and pricing page
 * (https://upstox.com/pricing/), covering all four segments the calculator
 * lists. Brokerage and DP charges are Upstox-specific; STT, transaction
 * charges, SEBI fees, stamp duty, and GST are exchange/government mandated
 * and consistent across brokers, though they change periodically (most
 * recently the Oct 2024 STT revision). Treat this as indicative, not a
 * substitute for a broker's actual contract note.
 */

import { round2, type TradeLegInput } from "@/lib/calculateTrade";

export type BrokerageSegment = "DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS";

type SegmentRates = {
  label: string;
  /** Flat brokerage per order; also the cap when brokeragePercent is set. */
  brokeragePerOrder: number;
  /** null = always the flat fee. Otherwise brokerage is min(flat, value * percent). */
  brokeragePercent: number | null;
  sttBuyPercent: number;
  sttSellPercent: number;
  /** Applies to both buy and sell order value. */
  transactionChargePercent: number;
  /** Applies to buy order value only. */
  stampDutyBuyPercent: number;
};

export const SEGMENT_RATES: Record<BrokerageSegment, SegmentRates> = {
  DELIVERY: {
    label: "Delivery",
    brokeragePerOrder: 20,
    brokeragePercent: null,
    sttBuyPercent: 0.1,
    sttSellPercent: 0.1,
    transactionChargePercent: 0.00345,
    stampDutyBuyPercent: 0.015,
  },
  INTRADAY: {
    label: "Intraday",
    brokeragePerOrder: 20,
    brokeragePercent: 0.1,
    sttBuyPercent: 0,
    sttSellPercent: 0.025,
    transactionChargePercent: 0.00345,
    stampDutyBuyPercent: 0.003,
  },
  FUTURES: {
    label: "Futures",
    brokeragePerOrder: 20,
    brokeragePercent: 0.05,
    sttBuyPercent: 0,
    sttSellPercent: 0.02,
    transactionChargePercent: 0.00188,
    stampDutyBuyPercent: 0.002,
  },
  OPTIONS: {
    label: "Options",
    brokeragePerOrder: 20,
    brokeragePercent: null,
    sttBuyPercent: 0,
    sttSellPercent: 0.1,
    transactionChargePercent: 0.0495,
    stampDutyBuyPercent: 0.003,
  },
};

const SEBI_CHARGE_PERCENT = 0.0001; // ₹10 per crore of turnover, same across segments
const GST_PERCENT = 18; // on (brokerage + transaction charges + SEBI fees)
/** ₹20/scrip/sell-day + GST, delivery only — https://upstox.com/pricing/. */
const DP_CHARGE_PER_SELL_LEG = 20 * (1 + GST_PERCENT / 100);
/** Upstox's calculator lists this line item but doesn't levy it — always ₹0. */
const CLEARING_CHARGES = 0;

export type BrokerageBreakdown = {
  brokerage: number;
  stt: number;
  transactionCharges: number;
  clearingCharges: number;
  dpCharges: number;
  stampDuty: number;
  sebiCharges: number;
  gst: number;
  totalCharges: number;
  netBuyValue: number;
  netSellValue: number;
  pointsToBreakeven: number;
};

/**
 * A leg with only a sell (or only a buy) price is treated as one executed
 * order rather than a round trip — e.g. a sold option left to expire
 * worthless never has a buy-side order, so it shouldn't be charged as one.
 */
export function calculateBrokerage(
  segment: BrokerageSegment,
  legs: TradeLegInput[],
  qty: number,
): BrokerageBreakdown {
  const rates = SEGMENT_RATES[segment];

  function orderBrokerage(value: number): number {
    if (rates.brokeragePercent === null) return rates.brokeragePerOrder;
    return Math.min(rates.brokeragePerOrder, value * (rates.brokeragePercent / 100));
  }

  let brokerage = 0;
  let stt = 0;
  let transactionCharges = 0;
  let stampDuty = 0;
  let dpCharges = 0;
  let netBuyValue = 0;
  let netSellValue = 0;

  for (const leg of legs) {
    if (leg.sellPrice > 0) {
      const sellValue = leg.sellPrice * qty;
      brokerage += orderBrokerage(sellValue);
      stt += sellValue * (rates.sttSellPercent / 100);
      transactionCharges += sellValue * (rates.transactionChargePercent / 100);
      netSellValue += sellValue;
      if (segment === "DELIVERY") dpCharges += DP_CHARGE_PER_SELL_LEG;
    }
    if (leg.buyPrice > 0) {
      const buyValue = leg.buyPrice * qty;
      brokerage += orderBrokerage(buyValue);
      stt += buyValue * (rates.sttBuyPercent / 100);
      transactionCharges += buyValue * (rates.transactionChargePercent / 100);
      stampDuty += buyValue * (rates.stampDutyBuyPercent / 100);
      netBuyValue += buyValue;
    }
  }

  const turnover = netBuyValue + netSellValue;
  const sebiCharges = turnover * (SEBI_CHARGE_PERCENT / 100);
  const gst = (brokerage + transactionCharges + sebiCharges) * (GST_PERCENT / 100);
  const clearingCharges = CLEARING_CHARGES;
  const totalCharges = brokerage + stt + transactionCharges + clearingCharges + dpCharges + stampDuty + sebiCharges + gst;
  const pointsToBreakeven = qty > 0 ? totalCharges / qty : 0;

  return {
    brokerage: round2(brokerage),
    stt: round2(stt),
    transactionCharges: round2(transactionCharges),
    clearingCharges: round2(clearingCharges),
    dpCharges: round2(dpCharges),
    stampDuty: round2(stampDuty),
    sebiCharges: round2(sebiCharges),
    gst: round2(gst),
    totalCharges: round2(totalCharges),
    netBuyValue: round2(netBuyValue),
    netSellValue: round2(netSellValue),
    pointsToBreakeven: round2(pointsToBreakeven),
  };
}

export function brokerageRuleText(segment: BrokerageSegment): string {
  const rates = SEGMENT_RATES[segment];
  if (rates.brokeragePercent === null) {
    return `flat ₹${rates.brokeragePerOrder} per order`;
  }
  return `₹${rates.brokeragePerOrder} or ${rates.brokeragePercent}% of order value, whichever is lower, per order`;
}
