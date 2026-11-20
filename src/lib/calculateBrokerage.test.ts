/**
 * Index futures and options charges. The futures figures are Upstox's own brokerage calculator for "NSE NIFTY FUT 23 NOV 26 FUT",
 * 130 units bought at 25,400 and sold at 25,575 (screenshot of 18 Nov 2026), line by line:
 *   brokerage 40.00, STT 1,662.38, exchange 132.54, stamp duty 66.04, SEBI 6.63, GST 32.25 - total 1,939.84, net P&L 20,810.16.
 * STT is 0.05% of the sell side - the Budget 2026-27 rate, in force from 1 April 2026 (it was 0.02% before).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateBrokerage, STT_HIKE_DATE } from "@/lib/calculateBrokerage";
import { summarizeEntries } from "@/lib/calculateReports";
import type { TradeEntry } from "@/lib/types";

const near = (actual: number, expected: number, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

const NIFTY_FUTURE_LEG = [{ buyPrice: 25_400, sellPrice: 25_575 }];

describe("a Nifty future, as Upstox's calculator bills it", () => {
  const c = calculateBrokerage("FUTURES", NIFTY_FUTURE_LEG, 130);

  it("matches every line of the breakup", () => {
    near(c.netBuyValue, 3_302_000);
    near(c.netSellValue, 3_324_750);
    near(c.brokerage, 40);
    near(c.stt, 1_662.38);
    near(c.transactionCharges, 132.54);
    near(c.stampDuty, 66.04);
    near(c.sebiCharges, 6.63);
    near(c.gst, 32.25);
    assert.equal(c.clearingCharges, 0);
    assert.equal(c.dpCharges, 0);
  });

  it("totals ₹1,939.84 - the lines as shown add up to it, to the paisa", () => {
    near(c.totalCharges, 1_939.84, 0.001);
    near(c.brokerage + c.stt + c.transactionCharges + c.clearingCharges + c.dpCharges + c.stampDuty + c.sebiCharges + c.gst, c.totalCharges, 0.001);
    near(c.netSellValue - c.netBuyValue - c.totalCharges, 20_810.16, 0.001);
  });

  it("needs about 14.92 points to break even", () => {
    near(c.pointsToBreakeven, 14.92, 0.01);
  });
});

describe("STT before and after 1 April 2026", () => {
  const sell = (soldOn?: string | null, segment: "FUTURES" | "OPTIONS" = "FUTURES") =>
    calculateBrokerage(segment, segment === "FUTURES" ? NIFTY_FUTURE_LEG : [{ buyPrice: 100, sellPrice: 120 }], 130, soldOn).stt;

  it("is 0.05% on a future and 0.15% on an option's premium from the hike", () => {
    near(sell(STT_HIKE_DATE), 3_324_750 * 0.0005);
    near(sell("2026-11-18"), 3_324_750 * 0.0005);
    near(sell(undefined), 3_324_750 * 0.0005); // no date: today's rates
    near(sell(null), 3_324_750 * 0.0005);
    near(sell("2026-11-18", "OPTIONS"), 120 * 130 * 0.0015);
  });

  it("is still 0.02% and 0.1% for a trade sold before it, so past trades keep their charges", () => {
    near(sell("2026-03-31"), 3_324_750 * 0.0002);
    near(sell("2025-06-10"), 3_324_750 * 0.0002);
    near(sell("2026-03-31", "OPTIONS"), 120 * 130 * 0.001);
  });

  it("changes nothing else about a trade", () => {
    const before = calculateBrokerage("FUTURES", NIFTY_FUTURE_LEG, 130, "2026-03-31");
    const after = calculateBrokerage("FUTURES", NIFTY_FUTURE_LEG, 130, "2026-11-18");
    near(before.brokerage, after.brokerage);
    near(before.transactionCharges, after.transactionCharges);
    near(before.stampDuty, after.stampDuty);
    near(after.totalCharges - before.totalCharges, 3_324_750 * 0.0003, 0.02); // only the extra STT - it carries no GST
  });

  it("leaves a commodity option's CTT alone", () => {
    const leg = [{ buyPrice: 365.45, sellPrice: 400 }];
    near(calculateBrokerage("COMMODITY_OPTIONS", leg, 200, "2026-03-31").stt, calculateBrokerage("COMMODITY_OPTIONS", leg, 200, "2026-11-18").stt);
  });
});

describe("Reports bill each entry at the STT of the day it was sold", () => {
  const entry = (over: Partial<TradeEntry>): TradeEntry => ({
    id: "e",
    user_id: null,
    entry_date: "2026-03-10",
    instrument: "NIFTY",
    strike_price: null,
    option_type: null,
    expiry_date: "2026-03-30",
    closing_date: "2026-03-20",
    lots: 2,
    side: "sell",
    buy_price: 25_400,
    sell_price: 25_575,
    pnl: 22_750,
    status: "squared_off",
    remarks: null,
    created_at: "",
    updated_at: "",
    ...over,
  });

  const charges = (e: TradeEntry) => summarizeEntries([e]).totalCharges;

  it("keeps a March future at the old rate and a November one at the new", () => {
    const march = charges(entry({}));
    const november = charges(entry({ entry_date: "2026-11-10", closing_date: "2026-11-18", expiry_date: "2026-11-24" }));
    near(november - march, 3_324_750 * 0.0003, 0.02);
  });

  it("dates a long by its closing day - that is when it was sold", () => {
    // Bought 31 Mar (before), sold 2 Apr (after): STT at the new rate.
    const long = entry({ side: "buy", entry_date: "2026-03-31", closing_date: "2026-04-02" });
    const sellFirst = entry({ side: "sell", entry_date: "2026-03-31", closing_date: "2026-04-02" });
    assert.ok(charges(long) > charges(sellFirst));
  });
});
