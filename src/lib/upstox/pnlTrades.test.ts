/**
 * Upstox's trade-wise P&L report, index options and MCX. The crude fixtures are the real rows and fills
 * Upstox returned on 13 Nov 2026 for a 2-lot CRUDEOIL 17 Nov 7800 CE bought and sold on 12 Nov: two 1-lot buys
 * at 365.4 / 365.5, then one 2-lot sell at 440. MCX counts lots and bakes the multiplier (100) into amounts.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { getHistoricalFills, type HistoricalFill } from "@/lib/upstox/api";
import { addCharges, ZERO_CHARGES } from "@/lib/upstox/pnlReport";
import { firstSideOf, groupReportRows, parseScrip, reportQuantityInUnits, tradesFromGroups } from "@/lib/upstox/pnlTrades";
import { JOURNAL_PNL_SEGMENTS, UPSTOX_PNL_SEGMENT_LABELS, UPSTOX_PNL_SEGMENTS } from "@/lib/upstox/types";

const CRUDE_ROWS = [
  { quantity: 1, isin: null, scrip_name: "CRUDEOIL 17 Nov 2026 CE 7800", trade_type: "OPT", buy_date: "12-11-2026", buy_average: 365.4, sell_date: "12-11-2026", sell_average: 440, buy_amount: 36540, sell_amount: 44000 },
  { quantity: 1, isin: null, scrip_name: "CRUDEOIL 17 Nov 2026 CE 7800", trade_type: "OPT", buy_date: "12-11-2026", buy_average: 365.5, sell_date: "12-11-2026", sell_average: 440, buy_amount: 36550, sell_amount: 44000 },
];

/** Index F&O counts units: a 2-lot Nifty trade at the current 65-unit lot is quantity 130. */
const NIFTY_ROW = { quantity: 130, scrip_name: "NIFTY 09 Nov 2026 PE 23400", trade_type: "OPT", buy_date: "05-11-2026", sell_date: "06-11-2026", buy_amount: 13000, sell_amount: 15600 };

function fill(over: Partial<HistoricalFill>): HistoricalFill {
  return { tradeId: "1", date: "2026-11-12", side: "BUY", symbol: "CRUDEOIL", optionType: "CE", strike: 7800, expiry: "2026-11-17", quantity: 1, ...over };
}

const CRUDE_FILLS = [
  fill({ tradeId: "481572048", side: "BUY" }),
  fill({ tradeId: "481572050", side: "BUY" }),
  fill({ tradeId: "482123715", side: "SELL", quantity: 2 }),
];

describe("parseScrip", () => {
  it("reads an MCX option the way it reads an index one", () => {
    assert.deepEqual(parseScrip("CRUDEOIL 17 Nov 2026 CE 7800", "OPT"), {
      name: "CRUDEOIL",
      instrument: "CRUDEOIL",
      expiry: "2026-11-17",
      optionType: "CE",
      strike: 7800,
    });
  });

  it("knows the mini contracts and gold, and leaves other commodities as untracked", () => {
    assert.equal(parseScrip("CRUDEOILM 17 Nov 2026 PE 7700", "OPT")?.instrument, "CRUDEOILM");
    assert.equal(parseScrip("GOLD 26 Nov 2026 CE 150000", "OPT")?.instrument, "GOLD");
    assert.equal(parseScrip("GOLDM 26 Nov 2026 CE 150000", "OPT")?.instrument, "GOLDM");
    assert.equal(parseScrip("SILVER 27 Nov 2026 CE 180000", "OPT")?.instrument, null);
  });
});

describe("MCX rows in the report", () => {
  it("brings lots up to units - the indices already count units", () => {
    assert.equal(reportQuantityInUnits("CRUDEOIL", 2), 200);
    assert.equal(reportQuantityInUnits("CRUDEOILM", 2), 20);
    assert.equal(reportQuantityInUnits("GOLD", 1), 100);
    assert.equal(reportQuantityInUnits("NIFTY", 130), 130);
  });

  it("merges the real crude fills into one 2-lot trade at the 365.45 average", () => {
    const { groups, otherCount, grossPnl } = groupReportRows(CRUDE_ROWS);
    const [[key, group]] = [...groups];
    const firstSide = firstSideOf(group, CRUDE_FILLS);
    assert.equal(firstSide, "BUY"); // the two buys have the lower trade ids
    const [trade, ...rest] = tradesFromGroups(groups, new Map([[key, firstSide]] as [string, "BUY" | "SELL"][]));

    assert.equal(rest.length, 0);
    assert.equal(otherCount, 0);
    assert.equal(trade.instrument, "CRUDEOIL");
    assert.equal(trade.strike, 7800);
    assert.equal(trade.optionType, "CE");
    assert.equal(trade.expiry, "2026-11-17");
    assert.equal(trade.lots, 2);
    assert.equal(trade.quantity, 200);
    assert.equal(trade.buyPrice, 365.45);
    assert.equal(trade.sellPrice, 440);
    assert.equal(trade.side, "buy");
    assert.equal(trade.entryDate, "2026-11-12");
    assert.equal(trade.closingDate, "2026-11-12");
    // Exactly Upstox's own amounts, and exactly (sell - buy) x 100 x 2 lots from the stored prices.
    assert.equal(trade.pnl, 14910);
    assert.equal(grossPnl, 14910);
    assert.equal(Math.round((trade.sellPrice - trade.buyPrice) * 100 * trade.lots * 100) / 100, trade.pnl);
  });

  it("calls a same-day trade a sell when the history shows the sell filled first", () => {
    const sellFirst = [
      fill({ tradeId: "100", side: "SELL", quantity: 2 }),
      fill({ tradeId: "200", side: "BUY" }),
      fill({ tradeId: "201", side: "BUY" }),
    ];
    const { groups } = groupReportRows(CRUDE_ROWS);
    const [[key, group]] = [...groups];
    const [trade] = tradesFromGroups(groups, new Map([[key, firstSideOf(group, sellFirst) ?? "BUY"]]));
    assert.equal(trade.side, "sell");
  });

  it("falls back to buy when the history has nothing for the day", () => {
    const { groups } = groupReportRows(CRUDE_ROWS);
    const [[, group]] = [...groups];
    assert.equal(firstSideOf(group, []), null);
    assert.equal(tradesFromGroups(groups, new Map())[0].side, "buy");
  });

  it("matches a fill only to its own contract", () => {
    const { groups } = groupReportRows(CRUDE_ROWS);
    const [[, group]] = [...groups];
    assert.equal(firstSideOf(group, [fill({ strike: 7900, side: "SELL" })]), null);
    assert.equal(firstSideOf(group, [fill({ optionType: "PE", side: "SELL" })]), null);
    assert.equal(firstSideOf(group, [fill({ symbol: "GOLD", side: "SELL" })]), null);
    assert.equal(firstSideOf(group, [fill({ date: "2026-11-11", side: "SELL" })]), null);
  });

  it("sizes a mini contract in its own, smaller lot", () => {
    const [trade] = tradesFromGroups(
      groupReportRows([{ quantity: 3, scrip_name: "CRUDEOILM 17 Nov 2026 CE 7800", trade_type: "OPT", buy_date: "10-11-2026", sell_date: "11-11-2026", buy_amount: 3000, sell_amount: 3600 }]).groups,
      new Map(),
    );
    assert.equal(trade.lots, 3);
    assert.equal(trade.quantity, 30);
    assert.equal(trade.buyPrice, 100);
    assert.equal(trade.sellPrice, 120);
    assert.equal(trade.pnl, 600);
  });
});

describe("index rows keep working beside MCX ones", () => {
  it("leaves index quantities in units and works out their lots", () => {
    const [trade] = tradesFromGroups(groupReportRows([NIFTY_ROW]).groups, new Map());
    assert.equal(trade.instrument, "NIFTY");
    assert.equal(trade.lots, 2);
    assert.equal(trade.quantity, 130);
    assert.equal(trade.buyPrice, 100);
    assert.equal(trade.sellPrice, 120);
    assert.equal(trade.side, "buy");
    assert.equal(trade.entryDate, "2026-11-05");
    assert.equal(trade.closingDate, "2026-11-06");
  });

  it("reads a mixed F&O and MCX report: both become trades, the rest are counted, P&L covers every row", () => {
    const stockOption = { quantity: 500, scrip_name: "RELIANCE 24 Nov 2026 CE 1500", trade_type: "OPT", buy_date: "02-11-2026", sell_date: "03-11-2026", buy_amount: 5000, sell_amount: 4000 };
    const silver = { quantity: 1, scrip_name: "SILVER 27 Nov 2026 CE 180000", trade_type: "OPT", buy_date: "02-11-2026", sell_date: "03-11-2026", buy_amount: 20000, sell_amount: 21000 };
    const { groups, otherCount, otherNames, grossPnl } = groupReportRows([NIFTY_ROW, ...CRUDE_ROWS, stockOption, silver]);

    const trades = tradesFromGroups(groups, new Map());
    assert.deepEqual(trades.map((t) => t.instrument), ["NIFTY", "CRUDEOIL"]); // oldest entry first
    assert.equal(otherCount, 2);
    assert.deepEqual([...otherNames].sort(), ["RELIANCE", "SILVER"]);
    assert.equal(grossPnl, 2600 + 14910 - 1000 + 1000);
  });

  it("does not let one trade's dates merge into another's", () => {
    const later = { ...CRUDE_ROWS[0], buy_date: "13-11-2026", sell_date: "13-11-2026" };
    assert.equal(tradesFromGroups(groupReportRows([...CRUDE_ROWS, later]).groups, new Map()).length, 2);
  });
});

describe("MCX trade history", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  /** The rows exactly as Upstox sends them: an MCX fill leaves `symbol` empty and names the commodity in `scrip_name`. */
  const COM_API_ROWS = [
    { exchange: "MCX", segment: "COM", option_type: "CE", quantity: 1, amount: 36540, trade_id: "481572048", trade_date: "2026-11-12", transaction_type: "BUY", scrip_name: "CRUDEOIL", strike_price: "7800.0", expiry: "2026-11-17", price: 365.4, isin: "", symbol: "", instrument_token: "" },
    { exchange: "MCX", segment: "COM", option_type: "CE", quantity: 2, amount: 88000, trade_id: "482123715", trade_date: "2026-11-12", transaction_type: "SELL", scrip_name: "CRUDEOIL", strike_price: "7800.0", expiry: "2026-11-17", price: 440, isin: "", symbol: "", instrument_token: "" },
  ];

  function stubFetch(rows: unknown[]) {
    const urls: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return new Response(JSON.stringify({ status: "success", data: rows, metaData: { page: { total_records: rows.length } } }), { status: 200 });
    }) as typeof fetch;
    return urls;
  }

  it("takes the commodity from scrip_name when symbol is empty, so an MCX fill finds its contract", async () => {
    const urls = stubFetch(COM_API_ROWS);
    const result = await getHistoricalFills("token", "2026-11-12", "2026-11-13", "COM");
    assert.ok("fills" in result);
    assert.match(urls[0], /segment=COM/);
    assert.deepEqual(
      result.fills.map((f) => [f.symbol, f.side, f.strike, f.expiry, f.optionType]),
      [
        ["CRUDEOIL", "BUY", 7800, "2026-11-17", "CE"],
        ["CRUDEOIL", "SELL", 7800, "2026-11-17", "CE"],
      ],
    );
    const { groups } = groupReportRows(CRUDE_ROWS);
    assert.equal(firstSideOf([...groups.values()][0], result.fills), "BUY");
  });

  it("still prefers symbol for NSE and BSE fills", async () => {
    stubFetch([{ ...COM_API_ROWS[0], exchange: "NSE", segment: "FO", symbol: "NIFTY", scrip_name: "NIFTY 23400 PE 09 NOV 26" }]);
    const result = await getHistoricalFills("token", "2026-11-12", "2026-11-13");
    assert.ok("fills" in result);
    assert.equal(result.fills[0].symbol, "NIFTY");
  });
});

describe("report segments", () => {
  it("offers MCX in Reports and syncs it into the journal", () => {
    assert.ok((UPSTOX_PNL_SEGMENTS as readonly string[]).includes("COM"));
    assert.equal(UPSTOX_PNL_SEGMENT_LABELS.COM, "MCX");
    assert.deepEqual([...JOURNAL_PNL_SEGMENTS], ["FO", "COM"]);
  });

  it("adds charges line by line", () => {
    const fo = { ...ZERO_CHARGES, total: 100.1, brokerage: 40, gst: 18.1, stt: 30, stampDuty: 2, transactionAndSebi: 10 };
    // The real MCX charges for the crude trade above.
    const com = { ...ZERO_CHARGES, total: 196.64, brokerage: 60, gst: 22.95, stt: 44, stampDuty: 2.19, transactionAndSebi: 67.5 };
    const sum = addCharges(fo, com);
    assert.equal(sum.total, 296.74);
    assert.equal(sum.brokerage, 100);
    assert.equal(sum.stt, 74);
    assert.equal(sum.transactionAndSebi, 77.5);
    assert.deepEqual(addCharges(ZERO_CHARGES, com), com);
  });
});
