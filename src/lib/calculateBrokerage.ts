/**
 * Charge model sourced from Upstox's public brokerage calculator
 * (https://upstox.com/calculator/brokerage-calculator/) and pricing page
 * (https://upstox.com/pricing/), covering all four segments the calculator
 * lists. Brokerage and DP charges are Upstox-specific; STT, transaction
 * charges, SEBI fees, stamp duty, and GST are exchange/government mandated
 * and consistent across brokers, though they change periodically (most
 * recently the 1 April 2026 STT hike on futures and options - see
 * STT_HIKE_DATE). Treat this as indicative, not a substitute for a broker's
 * actual contract note. Upstox's rate-card page lags its own calculator, so
 * check a rate against the calculator's output, not the page text.
 *
 * MCX commodity options are their own segment: the tax is CTT (commodity
 * transaction tax), 0.05% on the sell side, not the 0.1% STT of index options,
 * and MCX's transaction charge differs from NSE's - from Upstox's help-center
 * page on commodity pricing. CTT is reported in the `stt` field.
 *
 * MCX commodity futures are a segment of their own too: CTT is 0.01% on the sell side (non-agricultural), and MCX's transaction
 * charge on a future is 0.0021%. These two are the published statutory / exchange rates, not read off Upstox's calculator the
 * way the index-futures rate was - check them against it before trusting a rupee-exact figure.
 */

import { round2, type TradeLegInput } from "@/lib/calculateTrade";
import { isCommodityInstrument, type Instrument } from "@/lib/types";

export type BrokerageSegment = "DELIVERY" | "INTRADAY" | "FUTURES" | "OPTIONS" | "COMMODITY_OPTIONS" | "COMMODITY_FUTURES";

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

const SEGMENT_RATES: Record<BrokerageSegment, SegmentRates> = {
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
    sttSellPercent: 0.05,
    // 0.002% - what Upstox's calculator charges on a Nifty future (the old 0.00188% came from a stale copy of its rate card).
    transactionChargePercent: 0.002,
    stampDutyBuyPercent: 0.002,
  },
  OPTIONS: {
    label: "Options",
    brokeragePerOrder: 20,
    brokeragePercent: null,
    sttBuyPercent: 0,
    sttSellPercent: 0.15,
    transactionChargePercent: 0.0495,
    stampDutyBuyPercent: 0.003,
  },
  COMMODITY_OPTIONS: {
    label: "Commodity options",
    brokeragePerOrder: 20,
    brokeragePercent: null,
    sttBuyPercent: 0,
    sttSellPercent: 0.05,
    transactionChargePercent: 0.0418,
    stampDutyBuyPercent: 0.003,
  },
  COMMODITY_FUTURES: {
    label: "Commodity futures",
    brokeragePerOrder: 20,
    brokeragePercent: 0.05,
    sttBuyPercent: 0,
    sttSellPercent: 0.01,
    transactionChargePercent: 0.0021,
    stampDutyBuyPercent: 0.002,
  },
};

/**
 * The Union Budget 2026-27 raised STT on index derivatives from this date: futures 0.02% -> 0.05% and options (on the premium sold)
 * 0.1% -> 0.15%. `SEGMENT_RATES` holds today's rates; a trade dated before this day is still charged the old ones, so a past trade's
 * charges in Reports don't change retroactively.
 */
export const STT_HIKE_DATE = "2026-04-01";
const STT_SELL_PERCENT_BEFORE_HIKE: Partial<Record<BrokerageSegment, number>> = { FUTURES: 0.02, OPTIONS: 0.1 };

/** The charge segment an option on `instrument` is billed under - the indices' options, or MCX commodity options. */
export function optionsSegmentFor(instrument: Instrument): BrokerageSegment {
  return isCommodityInstrument(instrument) ? "COMMODITY_OPTIONS" : "OPTIONS";
}

/** The charge segment a future on `instrument` is billed under - the index futures, or MCX commodity futures. */
export function futuresSegmentFor(instrument: Instrument): BrokerageSegment {
  return isCommodityInstrument(instrument) ? "COMMODITY_FUTURES" : "FUTURES";
}

/** The charge segment of a derivative on `instrument`: its future's if it is one, otherwise its option's. */
export function derivativeSegmentFor(instrument: Instrument, isFuture: boolean): BrokerageSegment {
  return isFuture ? futuresSegmentFor(instrument) : optionsSegmentFor(instrument);
}

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
 *
 * `soldOn` (yyyy-mm-dd) is the day the sell order was placed. Left out it means today, at today's rates; give it for a past trade
 * to get the STT that applied then (see STT_HIKE_DATE).
 */
export function calculateBrokerage(
  segment: BrokerageSegment,
  legs: TradeLegInput[],
  qty: number,
  soldOn?: string | null,
): BrokerageBreakdown {
  const current = SEGMENT_RATES[segment];
  const earlierStt = soldOn && soldOn < STT_HIKE_DATE ? STT_SELL_PERCENT_BEFORE_HIKE[segment] : undefined;
  const rates = earlierStt === undefined ? current : { ...current, sttSellPercent: earlierStt };

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
  const lines = {
    brokerage: round2(brokerage),
    stt: round2(stt),
    transactionCharges: round2(transactionCharges),
    clearingCharges: round2(CLEARING_CHARGES),
    dpCharges: round2(dpCharges),
    stampDuty: round2(stampDuty),
    sebiCharges: round2(sebiCharges),
    gst: round2(gst),
  };
  // The total is the sum of the lines as shown, the way Upstox's calculator adds them - rounding the sum of the unrounded
  // amounts instead can differ by a paisa, and the lines on screen then don't add up to the total beside them.
  const totalCharges = round2(Object.values(lines).reduce((sum, line) => sum + line, 0));
  const pointsToBreakeven = qty > 0 ? totalCharges / qty : 0;

  return {
    ...lines,
    totalCharges,
    netBuyValue: round2(netBuyValue),
    netSellValue: round2(netSellValue),
    pointsToBreakeven: round2(pointsToBreakeven),
  };
}
