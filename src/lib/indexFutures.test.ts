/**
 * Index futures in Live Portfolio. The fixtures are the real shapes seen from Upstox on 17 Nov 2026 for a short
 * 2-lot NIFTY December future (NIFTY FUT 29 DEC 26, NSE_FO|58875): sold at 25,575, LTP 25,601.2, previous close
 * 25,449.6 - Upstox's own unrealised P&L for it was -3,406. A Nifty lot is 65.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calculateBrokerage } from "@/lib/calculateBrokerage";
import {
  calculateTodayPnl,
  closedPositionCharges,
  computePortfolioRow,
  futureGroupKey,
  isFutureEntry,
  isTrackedEntry,
  legSnapshotKey,
  summariseClosedPosition,
  toLegSnapshot,
  type FutureQuotes,
  type LegSnapshots,
} from "@/lib/calculatePortfolio";
import { describeEntryContract } from "@/lib/tradeEntriesStore";
import type { LivePortfolioEntry } from "@/lib/types";
import {
  futureContractId,
  futuresExchangeFor,
  futuresExchangeOfKey,
  parseFutureQuote,
  parseIndexFutures,
} from "@/lib/upstox/futures";
import type { UpstoxPosition } from "@/lib/upstox/types";
import { planPositionSync, positionContractKey, positionDayPnl } from "@/lib/upstoxSync";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// Epoch ms Upstox sends for an expiry: 23:59:59 IST on the day.
const DEC_29_2026 = Date.parse("2026-12-29T23:59:59+05:30");
const NOV_23_2026 = Date.parse("2026-11-23T23:59:59+05:30");
const JAN_25_2027 = Date.parse("2027-01-25T23:59:59+05:30");

function futureRow(over: Record<string, unknown>) {
  return {
    segment: "NSE_FO",
    instrument_type: "FUT",
    underlying_symbol: "NIFTY",
    instrument_key: "NSE_FO|58875",
    expiry: DEC_29_2026,
    lot_size: 65,
    strike_price: 0,
    trading_symbol: "NIFTY FUT 29 DEC 26",
    ...over,
  };
}

describe("index futures in Upstox's instrument file", () => {
  const parsed = parseIndexFutures(
    [
      futureRow({}),
      futureRow({ instrument_key: "NSE_FO|61471", expiry: NOV_23_2026 }),
      futureRow({ instrument_key: "NSE_FO|54749", expiry: JAN_25_2027 }),
      futureRow({ instrument_key: "NSE_FO|58872", underlying_symbol: "BANKNIFTY", lot_size: 30 }),
      // None of these is a tracked index future: a month already gone, other indices, options, other exchanges' rows.
      futureRow({ instrument_key: "NSE_FO|old", expiry: Date.parse("2026-10-27T23:59:59+05:30") }),
      futureRow({ instrument_key: "NSE_FO|midcp", underlying_symbol: "MIDCPNIFTY" }),
      futureRow({ instrument_key: "NSE_FO|fin", underlying_symbol: "FINNIFTY" }),
      futureRow({ instrument_key: "NSE_FO|stock", underlying_symbol: "RELIANCE", lot_size: 500 }),
      futureRow({ instrument_key: "NSE_FO|opt", instrument_type: "CE", strike_price: 25400 }),
      futureRow({ instrument_key: "BSE_FO|1", segment: "BSE_FO" }),
      futureRow({ instrument_key: "NSE_FO|nolot", lot_size: 0 }),
    ],
    "NSE_FO",
    "2026-11-17",
  );

  it("keeps the live futures of Nifty and Bank Nifty, as contracts with no strike and no CE/PE", () => {
    assert.ok(parsed);
    assert.deepEqual([...parsed.contracts.keys()].sort(), ["NSE_FO|54749", "NSE_FO|58872", "NSE_FO|58875", "NSE_FO|61471"]);
    assert.deepEqual(parsed.contracts.get("NSE_FO|58875"), {
      instrument: "NIFTY",
      strike: null,
      optionType: null,
      expiry: "2026-12-29",
      lotSize: 65,
    });
    assert.equal(parsed.contracts.get("NSE_FO|58872")?.lotSize, 30);
  });

  it("finds the key to quote a contract under from its instrument and expiry", () => {
    assert.ok(parsed);
    assert.equal(parsed.keyByContract.get(futureContractId("NIFTY", "2026-12-29")), "NSE_FO|58875");
    assert.equal(parsed.keyByContract.get(futureContractId("NIFTY", "2026-11-23")), "NSE_FO|61471");
    assert.equal(parsed.keyByContract.get(futureContractId("BANKNIFTY", "2026-12-29")), "NSE_FO|58872");
    assert.equal(parsed.keyByContract.get(futureContractId("NIFTY", "2026-12-30")), undefined);
  });

  it("still lists a contract on its expiry day, but not the day after", () => {
    const onExpiry = parseIndexFutures([futureRow({})], "NSE_FO", "2026-12-29");
    const after = parseIndexFutures([futureRow({})], "NSE_FO", "2026-12-30");
    assert.equal(onExpiry?.contracts.size, 1);
    assert.equal(after?.contracts.size, 0);
  });

  it("reads Sensex futures from the BSE segment", () => {
    const sensex = parseIndexFutures(
      [futureRow({ segment: "BSE_FO", instrument_key: "BSE_FO|1145756", underlying_symbol: "SENSEX", lot_size: 20 })],
      "BSE_FO",
      "2026-11-17",
    );
    assert.equal(sensex?.contracts.get("BSE_FO|1145756")?.instrument, "SENSEX");
    assert.equal(futuresExchangeFor("SENSEX"), "BSE");
    assert.equal(futuresExchangeFor("NIFTY"), "NSE");
    assert.equal(futuresExchangeFor("BANKNIFTY"), "NSE");
  });

  it("is not fooled by a file that isn't a list", () => {
    assert.equal(parseIndexFutures({ not: "a list" }, "NSE_FO"), null);
  });

  it("tells which exchange a position's token belongs to", () => {
    assert.equal(futuresExchangeOfKey("NSE_FO|58875"), "NSE");
    assert.equal(futuresExchangeOfKey("BSE_FO|1145756"), "BSE");
    assert.equal(futuresExchangeOfKey("MCX_FO|584900"), null);
    assert.equal(futuresExchangeOfKey("NSE_EQ|INE002A01018"), null);
  });
});

describe("a future's quote", () => {
  // The shape of /v2/market-quote/quotes for NSE_FO|58875, with the depth and circuit limits left out.
  const quote = {
    last_price: 25601.2,
    net_change: 151.6,
    ohlc: { open: 25500, high: 25704.6, low: 25437.1, close: 25601.2 },
    volume: 808795,
    oi: 2112305,
    instrument_token: "NSE_FO|58875",
  };

  it("reads the price, the previous close (price less net change), open interest and volume", () => {
    assert.deepEqual(parseFutureQuote(quote, "NSE_FO|58875"), {
      instrumentKey: "NSE_FO|58875",
      ltp: 25601.2,
      prevClose: 25449.6, // what the position itself reports as close_price - without float noise
      oi: 2112305,
      volume: 808795,
    });
  });

  it("has no close to offer when Upstox sends no net change, and no OI when it is zero", () => {
    const parsed = parseFutureQuote({ last_price: 25601.2, oi: 0, volume: 10 }, "NSE_FO|58875");
    assert.equal(parsed?.prevClose, null);
    assert.equal(parsed?.oi, null);
  });

  it("says nothing rather than a row of zeros when nothing has traded", () => {
    assert.equal(parseFutureQuote({ last_price: 0, net_change: 0 }, "NSE_FO|58875"), null);
    assert.equal(parseFutureQuote(undefined, "NSE_FO|58875"), null);
  });
});

/** What /api/upstox/positions returns for the real position: 130 units sold today at 25,575. */
const NIFTY_FUTURE_POSITION: UpstoxPosition = {
  instrumentKey: "NSE_FO|58875",
  instrument: "NIFTY",
  strike: null,
  optionType: null,
  expiry: "2026-12-29",
  lotSize: 65,
  quantity: -130,
  overnightQuantity: 0,
  averagePrice: 25575,
  buyQuantity: 0,
  buyValue: 0,
  sellQuantity: 130,
  sellValue: 3324750,
  dayBuyQuantity: 0,
  dayBuyValue: 0,
  daySellQuantity: 130,
  daySellValue: 3324750,
  lastPrice: 25601.2,
  closePrice: 25449.6,
  openedOn: null,
};

const FUTURE_ENTRY: LivePortfolioEntry = {
  id: "f1",
  user_id: null,
  entry_date: "2026-11-17",
  instrument: "NIFTY",
  strike_price: null,
  option_type: null,
  expiry_date: "2026-12-29",
  closing_date: null,
  lots: 2,
  side: "sell",
  buy_price: 25575,
  sell_price: 25575,
  pnl: 0,
  status: "hold",
  remarks: null,
  created_at: "2026-11-17T09:30:00Z",
  updated_at: "2026-11-17T09:30:00Z",
};

const OPTION_ENTRY: LivePortfolioEntry = {
  ...FUTURE_ENTRY,
  id: "o1",
  strike_price: 25400,
  option_type: "PE",
  buy_price: 405.1,
  sell_price: 405.1,
};

describe("syncing a futures position into Live Portfolio", () => {
  it("opens a 2-lot short as a row with an expiry and no strike or CE/PE", () => {
    const plan = planPositionSync([], [NIFTY_FUTURE_POSITION], "2026-11-17");
    assert.equal(plan.inserts.length, 1);
    const { input } = plan.inserts[0];
    assert.equal(input.instrument, "NIFTY");
    assert.equal(input.lots, 2); // 130 units / 65, not 130 lots
    assert.equal(input.side, "sell");
    assert.equal(input.strikePrice, undefined);
    assert.equal(input.optionType, undefined);
    assert.equal(input.expiryDate, "2026-12-29");
    assert.equal(input.sellPrice, 25575);
    assert.equal(input.status, "hold");
    assert.equal(input.entryDate, "2026-11-17");
  });

  it("recognises the row it wrote, so the next sync adds nothing", () => {
    const plan = planPositionSync([FUTURE_ENTRY], [NIFTY_FUTURE_POSITION], "2026-11-17");
    assert.deepEqual([plan.inserts.length, plan.updates.length, plan.closes.length], [0, 0, 0]);
  });

  it("follows the lots when more is sold", () => {
    const bigger: UpstoxPosition = { ...NIFTY_FUTURE_POSITION, quantity: -195, sellQuantity: 195, daySellQuantity: 195, sellValue: 4987125, daySellValue: 4987125 };
    const plan = planPositionSync([FUTURE_ENTRY], [bigger], "2026-11-17");
    assert.equal(plan.updates.length, 1);
    assert.equal(plan.updates[0].input.lots, 3);
  });

  it("squares the row off when the future is closed, at the exit price of the day", () => {
    const flat: UpstoxPosition = {
      ...NIFTY_FUTURE_POSITION,
      quantity: 0,
      averagePrice: null,
      buyQuantity: 130,
      buyValue: 3318250,
      dayBuyQuantity: 130,
      dayBuyValue: 3318250,
    };
    const plan = planPositionSync([FUTURE_ENTRY], [flat], "2026-11-17");
    assert.equal(plan.closes.length, 1);
    const { input } = plan.closes[0];
    assert.equal(input.status, "squared_off");
    assert.equal(input.closingDate, "2026-11-17");
    assert.equal(input.buyPrice, 25525); // bought back at 3,318,250 / 130
    assert.equal(input.sellPrice, 25575);
  });

  it("keeps a future and an option that expire the same day apart", () => {
    const optionPosition: UpstoxPosition = {
      ...NIFTY_FUTURE_POSITION,
      instrumentKey: "NSE_FO|1",
      strike: 25400,
      optionType: "PE",
      expiry: "2026-12-29",
      averagePrice: 405.1,
    };
    // Only the option is open: the future's row must be closed, not mistaken for the option's.
    const plan = planPositionSync([FUTURE_ENTRY, OPTION_ENTRY], [optionPosition], "2026-11-17");
    assert.equal(plan.inserts.length, 0);
    assert.deepEqual(plan.closes.map((c) => c.entry.id), ["f1"]);
    // And the other way round: only the future is open.
    const other = planPositionSync([FUTURE_ENTRY, OPTION_ENTRY], [NIFTY_FUTURE_POSITION], "2026-11-17");
    assert.deepEqual(other.closes.map((c) => c.entry.id), ["o1"]);
  });
});

describe("pricing a future from its quote", () => {
  const quotes: FutureQuotes = {
    [futureGroupKey("NIFTY", "2026-12-29")]: { instrumentKey: "NSE_FO|58875", ltp: 25601.2, prevClose: 25449.6, oi: 2112305, volume: 808795 },
  };

  it("is a future, not a half-filled option - and is tracked either way", () => {
    assert.ok(isFutureEntry(FUTURE_ENTRY));
    assert.ok(!isFutureEntry(OPTION_ENTRY));
    assert.ok(!isFutureEntry({ ...FUTURE_ENTRY, expiry_date: null })); // a legacy entry with nothing set
    assert.ok(isTrackedEntry(FUTURE_ENTRY) && isTrackedEntry(OPTION_ENTRY));
    assert.ok(!isTrackedEntry({ ...FUTURE_ENTRY, expiry_date: null }));
  });

  it("matches Upstox's own unrealised P&L for the short: -3,406", () => {
    const row = computePortfolioRow(FUTURE_ENTRY, {}, undefined, quotes);
    assert.equal(row.status, "ok");
    near(row.livePnl ?? NaN, -3406, 0.01); // (25,575 - 25,601.2) x 130
    assert.equal(row.liveLtp, 25601.2);
    assert.equal(row.entryPrice, 25575);
    assert.equal(row.prevClose, 25449.6);
    assert.equal(row.instrumentKey, "NSE_FO|58875"); // the key the margin call is asked under
    assert.equal(row.oi, 2112305);
  });

  it("has no Greeks or IV of its own, and no index read until its option chain has loaded", () => {
    const row = computePortfolioRow(FUTURE_ENTRY, {}, undefined, quotes);
    for (const field of [row.delta, row.gamma, row.theta, row.vega, row.iv, row.nearbyIv, row.underlyingSpot]) {
      assert.equal(field, null);
    }
  });

  it("estimates the exit charges at the futures rates, not the options ones", () => {
    const row = computePortfolioRow(FUTURE_ENTRY, {}, undefined, quotes);
    const expected = calculateBrokerage("FUTURES", [{ buyPrice: 25601.2, sellPrice: 25575 }], 130).totalCharges;
    near(row.brokerageIfClosed ?? NaN, expected, 0.001);
    const asOption = calculateBrokerage("OPTIONS", [{ buyPrice: 25601.2, sellPrice: 25575 }], 130).totalCharges;
    assert.notEqual(Math.round(expected), Math.round(asOption));
  });

  it("measures today's move from the previous close, or from the entry price when opened today", () => {
    // Opened today: the move before the entry was never this position's.
    near(calculateTodayPnl(computePortfolioRow(FUTURE_ENTRY, {}, undefined, quotes), "2026-11-17") ?? NaN, -3406, 0.01);
    // Carried in from an earlier day: from the close of 25,449.6 - the short has lost 151.6 points a unit.
    const carried = { ...FUTURE_ENTRY, entry_date: "2026-11-14" };
    near(calculateTodayPnl(computePortfolioRow(carried, {}, undefined, quotes), "2026-11-17") ?? NaN, (25449.6 - 25601.2) * 130, 0.01);
  });

  it("waits for its quote, and says so when the quote fails", () => {
    assert.equal(computePortfolioRow(FUTURE_ENTRY, {}, undefined, {}).status, "loading");
    const failed = computePortfolioRow(FUTURE_ENTRY, {}, undefined, { [futureGroupKey("NIFTY", "2026-12-29")]: { error: "No NIFTY future is listed for 2026-12-29." } });
    assert.equal(failed.status, "error");
    assert.equal(failed.errorMessage, "No NIFTY future is listed for 2026-12-29.");
  });

  it("keeps showing the last price through an outage, flagged stale - but not through any other error", () => {
    const fresh = computePortfolioRow(FUTURE_ENTRY, {}, undefined, quotes);
    const snap = toLegSnapshot(fresh, 1_700_000_000_000);
    assert.ok(snap);
    const lastKnown: LegSnapshots = { [snap.key]: snap.snapshot };

    for (const error of ["token_expired", "network_error"]) {
      const row = computePortfolioRow(FUTURE_ENTRY, {}, lastKnown, { [futureGroupKey("NIFTY", "2026-12-29")]: { error } });
      assert.equal(row.status, "ok", error);
      assert.equal(row.stale, true);
      assert.equal(row.asOf, 1_700_000_000_000);
      near(row.livePnl ?? NaN, -3406, 0.01);
    }
    const other = computePortfolioRow(FUTURE_ENTRY, {}, lastKnown, { [futureGroupKey("NIFTY", "2026-12-29")]: { error: "Upstox returned 500" } });
    assert.equal(other.status, "error");
  });

  it("does not share a poll group with an option expiring the same day", () => {
    assert.notEqual(futureGroupKey("NIFTY", "2026-12-29"), "NIFTY|2026-12-29");
  });
});

describe("today's P&L of a futures position", () => {
  it("is -3,406 for the short opened today, whichever way it is measured", () => {
    near(positionDayPnl(NIFTY_FUTURE_POSITION, 25601.2) ?? NaN, -3406, 0.01);
  });

  it("finds the position's live price by the same key the priced row is stored under", () => {
    assert.equal(positionContractKey(NIFTY_FUTURE_POSITION), legSnapshotKey(FUTURE_ENTRY as Parameters<typeof legSnapshotKey>[0]));
    const optionPosition: UpstoxPosition = { ...NIFTY_FUTURE_POSITION, strike: 25400, optionType: "PE" };
    assert.equal(positionContractKey(optionPosition), legSnapshotKey(OPTION_ENTRY as Parameters<typeof legSnapshotKey>[0]));
  });
});

describe("a future squared off today", () => {
  it("is billed as a future, round trip", () => {
    const flat: UpstoxPosition = { ...NIFTY_FUTURE_POSITION, quantity: 0, averagePrice: null, buyQuantity: 130, buyValue: 3318250, dayBuyQuantity: 130, dayBuyValue: 3318250 };
    const summary = summariseClosedPosition(flat);
    near(summary.pnl, 6500, 0.01); // sold 3,324,750, bought back 3,318,250
    const expected = calculateBrokerage("FUTURES", [{ buyPrice: 25525, sellPrice: 25575 }], 130).totalCharges;
    near(summary.charges ?? NaN, expected, 0.001);
  });

  it("shows the futures line items in the detail popup, not an option's: STT on the sell side only, and the exchange fee of a future", () => {
    const flat: UpstoxPosition = { ...NIFTY_FUTURE_POSITION, quantity: 0, averagePrice: null, buyQuantity: 130, buyValue: 3318250, dayBuyQuantity: 130, dayBuyValue: 3318250 };
    const charges = closedPositionCharges(flat);
    assert.ok(charges);
    near(charges.stt, 3324750 * 0.0005, 0.01); // 0.05% of the 33.25 lakh sold = 1,662.38
    near(charges.stampDuty, 3318250 * 0.00002, 0.01); // 0.002% of the buy side
    near(charges.transactionCharges, (3324750 + 3318250) * 0.00002, 0.01);
    near(charges.brokerage, 40, 0.001); // 20 + 20: 0.05% of a lakh-plus order is over the cap, so the flat fee
    near(charges.totalCharges, calculateBrokerage("FUTURES", [{ buyPrice: 25525, sellPrice: 25575 }], 130).totalCharges, 0.001);
    assert.equal(summariseClosedPosition(flat).charges, charges.totalCharges); // the table and the popup agree

    const asOption = calculateBrokerage("OPTIONS", [{ buyPrice: 25525, sellPrice: 25575 }], 130);
    assert.ok(asOption.stt > charges.stt * 2);
    assert.ok(asOption.transactionCharges > charges.transactionCharges * 10);
  });

  it("still bills an option at the options rates, and an MCX option at its own", () => {
    const option: UpstoxPosition = { ...NIFTY_FUTURE_POSITION, strike: 25400, optionType: "PE", quantity: 0, averagePrice: null, buyQuantity: 130, buyValue: 13000, sellQuantity: 130, sellValue: 15600 };
    near(closedPositionCharges(option)?.totalCharges ?? NaN, calculateBrokerage("OPTIONS", [{ buyPrice: 100, sellPrice: 120 }], 130).totalCharges, 0.001);
    const crude: UpstoxPosition = { ...option, instrument: "CRUDEOIL" };
    near(closedPositionCharges(crude)?.totalCharges ?? NaN, calculateBrokerage("COMMODITY_OPTIONS", [{ buyPrice: 100, sellPrice: 120 }], 130).totalCharges, 0.001);
  });

  it("has no breakdown until both a buy and a sell are known", () => {
    assert.equal(closedPositionCharges(NIFTY_FUTURE_POSITION), null); // still open: sold, not yet bought back
  });
});

describe("naming a future", () => {
  it("reads NIFTY FUT - the contract month is the Expiry column beside it", () => {
    assert.equal(describeEntryContract(FUTURE_ENTRY), "NIFTY FUT");
    assert.equal(describeEntryContract({ instrument: "BANKNIFTY", strike_price: null, option_type: null, expiry_date: "2026-12-29" }), "BANKNIFTY FUT");
  });

  it("leaves options and plain entries as they were", () => {
    assert.equal(describeEntryContract(OPTION_ENTRY), "NIFTY 25400 PE");
    assert.equal(describeEntryContract({ instrument: "NIFTY", strike_price: null, option_type: null, expiry_date: null }), "Nifty");
    // Callers that don't have an expiry to hand (the older ones) keep the plain label.
    assert.equal(describeEntryContract({ instrument: "NIFTY", strike_price: null, option_type: null }), "Nifty");
  });
});
