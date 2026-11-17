/**
 * The expected MCX open: the arithmetic, which NYMEX contract an MCX one follows, when MCX counts as shut, and how the
 * pieces are put together. The fixtures follow what was seen on Friday 13 / Saturday 14 Nov 2026: MCX natural gas
 * (24 Nov contract) last traded at 23:54:59 IST at 307.9, and crude (19 Nov contract) at 8,372; MCX reopens Monday 09:00.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  applyMove,
  assembleExpectedOpen,
  expectedOpenMarketFor,
  impliedOpen,
  isExpectedOpenItem,
  lastScheduledCloseMs,
  mcxState,
  nextMcxOpenMs,
  nymexContractFor,
  parseMcxQuote,
  type ExpectedOpenItem,
  type MarketInput,
} from "@/lib/expectedOpen";
import { parseYahooCandles, parseYahooMeta, priceBefore } from "@/lib/globalMarkets";

const at = (iso: string) => Date.parse(iso);
const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

const FRI_CLOSE = at("2026-11-13T23:54:59+05:30");
const SAT_NIGHT = at("2026-11-14T00:51:00+05:30");

const NATGAS: MarketInput = {
  market: "NATURALGAS",
  contract: { label: "Nov 2026", expiry: "2026-11-24" },
  mcx: { price: 307.9, lastTradeMs: FRI_CLOSE },
  nymex: { symbol: "NGZ26.NYM", label: "Dec 26", atClose: 3.255, now: { price: 3.236, asOf: at("2026-11-14T00:41:00+05:30") } },
};
const CRUDE: MarketInput = {
  market: "CRUDEOIL",
  contract: { label: "Nov 2026", expiry: "2026-11-19" },
  mcx: { price: 8372, lastTradeMs: FRI_CLOSE },
  nymex: { symbol: "CLZ26.NYM", label: "Dec 26", atClose: 88.7, now: { price: 88.52, asOf: at("2026-11-14T00:41:00+05:30") } },
};

describe("which NYMEX contract an MCX one follows", () => {
  it("is the month after the MCX expiry's own - MCX November follows NYMEX December", () => {
    assert.deepEqual(nymexContractFor("NATURALGAS", "2026-11-24"), { symbol: "NGZ26.NYM", label: "Dec 26" });
    assert.deepEqual(nymexContractFor("CRUDEOIL", "2026-11-19"), { symbol: "CLZ26.NYM", label: "Dec 26" });
  });

  it("rolls into the next year from December", () => {
    assert.deepEqual(nymexContractFor("NATURALGAS", "2026-12-24"), { symbol: "NGF27.NYM", label: "Jan 27" });
  });

  it("uses the exchange's month letters", () => {
    assert.equal(nymexContractFor("NATURALGAS", "2026-01-27")?.symbol, "NGG26.NYM"); // February
    assert.equal(nymexContractFor("CRUDEOIL", "2026-08-19")?.symbol, "CLU26.NYM"); // September
    assert.equal(nymexContractFor("CRUDEOIL", "2026-05-19")?.symbol, "CLM26.NYM"); // June
  });

  it("gives nothing for a date it can't read", () => {
    assert.equal(nymexContractFor("NATURALGAS", "soon"), null);
    assert.equal(nymexContractFor("NATURALGAS", "2026-13-01"), null);
  });

  it("follows the mini contracts to the same market", () => {
    assert.equal(expectedOpenMarketFor("NATURALGAS"), "NATURALGAS");
    assert.equal(expectedOpenMarketFor("NATGASMINI"), "NATURALGAS");
    assert.equal(expectedOpenMarketFor("CRUDEOIL"), "CRUDEOIL");
    assert.equal(expectedOpenMarketFor("CRUDEOILM"), "CRUDEOIL");
    assert.equal(expectedOpenMarketFor("GOLD"), null);
    assert.equal(expectedOpenMarketFor("NIFTY"), null);
  });
});

describe("the arithmetic", () => {
  it("scales MCX's last price by how far NYMEX has moved since", () => {
    const implied = impliedOpen(307.9, 3.255, 3.236);
    assert.ok(implied);
    near(implied.price, 307.9 * (3.236 / 3.255));
    near(implied.movePct, (3.236 / 3.255 - 1) * 100);
    assert.ok(implied.movePct < -0.58 && implied.movePct > -0.59);
  });

  it("is the last price itself when NYMEX hasn't moved", () => {
    near(impliedOpen(8372, 88.7, 88.7)!.price, 8372);
    near(impliedOpen(8372, 88.7, 88.7)!.movePct, 0);
  });

  it("refuses a price that isn't positive", () => {
    assert.equal(impliedOpen(0, 3.2, 3.2), null);
    assert.equal(impliedOpen(307.9, 0, 3.2), null);
    assert.equal(impliedOpen(307.9, 3.2, NaN), null);
    assert.equal(impliedOpen(307.9, 3.2, -1), null);
  });

  it("applies the same move to another price of the commodity", () => {
    near(applyMove(300, -0.5), 298.5);
    near(applyMove(300, 2), 306);
  });
});

describe("reading Upstox's quote and Yahoo's candles", () => {
  it("takes the last price and the time of the last trade", () => {
    assert.deepEqual(parseMcxQuote({ last_price: 307.9, last_trade_time: "1794594299000", net_change: -5.2 }), { price: 307.9, lastTradeMs: 1794594299000 });
    assert.equal(parseMcxQuote({ last_price: 307.9, last_trade_time: "1794594299000" })?.lastTradeMs, FRI_CLOSE);
  });

  it("keeps the price when Upstox gave no time of the last trade", () => {
    assert.deepEqual(parseMcxQuote({ last_price: 8372 }), { price: 8372, lastTradeMs: null });
    assert.deepEqual(parseMcxQuote({ last_price: 8372, last_trade_time: "0" }), { price: 8372, lastTradeMs: null });
  });

  it("has nothing for an instrument that has no price", () => {
    assert.equal(parseMcxQuote({ last_price: 0 }), null);
    assert.equal(parseMcxQuote({}), null);
    assert.equal(parseMcxQuote(null), null);
    assert.equal(parseMcxQuote("x"), null);
  });

  const candles = (rows: [string, number | null][]) => ({
    chart: { result: [{ timestamp: rows.map(([t]) => at(t) / 1000), indicators: { quote: [{ close: rows.map(([, c]) => c) }] } }] },
  });

  it("reads Yahoo's candles, skipping the empty ones", () => {
    const parsed = parseYahooCandles(candles([["2026-11-13T23:50:00+05:30", 3.25], ["2026-11-13T23:51:00+05:30", null], ["2026-11-13T23:52:00+05:30", 3.26]]));
    assert.deepEqual(parsed.map((c) => c.close), [3.25, 3.26]);
    assert.deepEqual(parseYahooCandles({}), []);
    assert.deepEqual(parseYahooCandles(null), []);
  });

  it("takes the price at a moment from the last candle that had finished by then - never a later one", () => {
    const parsed = parseYahooCandles(candles([["2026-11-13T23:52:00+05:30", 3.25], ["2026-11-13T23:53:00+05:30", 3.26], ["2026-11-13T23:54:00+05:30", 3.27], ["2026-11-13T23:55:00+05:30", 3.99]]));
    // MCX last traded at 23:54:59: the 23:54 candle ends at 23:55, after it, so the 23:53 one (ending 23:54) is the last finished.
    assert.equal(priceBefore(parsed, FRI_CLOSE), 3.26);
    assert.equal(priceBefore(parsed, at("2026-11-13T23:55:00+05:30")), 3.27);
  });

  it("has no price when the candles stop well before that moment - the feed hasn't caught up", () => {
    const parsed = parseYahooCandles(candles([["2026-11-13T23:30:00+05:30", 3.25]]));
    assert.equal(priceBefore(parsed, FRI_CLOSE), null);
    assert.equal(priceBefore([], FRI_CLOSE), null);
  });

  it("reads the live price, its time and the contract's name", () => {
    const body = { chart: { result: [{ meta: { regularMarketPrice: 3.239, regularMarketTime: 1794594720, shortName: "Natural Gas Dec 26" } }] } };
    assert.deepEqual(parseYahooMeta(body), { price: 3.239, asOf: 1794594720000, name: "Natural Gas Dec 26" });
    assert.equal(parseYahooMeta({ chart: { result: [{ meta: { regularMarketTime: 1 } }] } }), null);
  });
});

describe("whether MCX is trading", () => {
  it("is shut at night and on the weekend", () => {
    assert.equal(mcxState(SAT_NIGHT, FRI_CLOSE), "closed");
    assert.equal(mcxState(at("2026-11-13T23:56:00+05:30"), FRI_CLOSE), "closed");
    assert.equal(mcxState(at("2026-11-14T12:00:00+05:30"), FRI_CLOSE), "closed");
    assert.equal(mcxState(at("2026-11-12T08:30:00+05:30"), at("2026-11-11T23:54:00+05:30")), "closed");
  });

  it("is open in the evening while it keeps trading - up to 23:55 in winter, which the old 23:30 close called shut", () => {
    assert.equal(mcxState(at("2026-11-12T20:00:00+05:30"), at("2026-11-12T19:59:40+05:30")), "open");
    assert.equal(mcxState(at("2026-11-13T23:40:00+05:30"), at("2026-11-13T23:39:50+05:30")), "open");
  });

  it("is quiet when the clock says open but nothing has traded for a while - a part-day holiday, or before the first trade", () => {
    assert.equal(mcxState(at("2026-11-12T20:00:00+05:30"), at("2026-11-12T17:00:00+05:30")), "quiet");
    assert.equal(mcxState(at("2026-11-16T09:00:30+05:30"), FRI_CLOSE), "quiet"); // Monday, seconds after the open
  });

  it("trusts the clock alone when Upstox gave no time of the last trade", () => {
    assert.equal(mcxState(at("2026-11-12T20:00:00+05:30"), null), "open");
    assert.equal(mcxState(SAT_NIGHT, null), "closed");
  });

  it("finds when MCX reopens by the clock: the next weekday 09:00 IST", () => {
    assert.equal(nextMcxOpenMs(SAT_NIGHT), at("2026-11-16T09:00:00+05:30")); // Saturday -> Monday
    assert.equal(nextMcxOpenMs(at("2026-11-13T23:56:00+05:30")), at("2026-11-16T09:00:00+05:30")); // Friday night -> Monday
    assert.equal(nextMcxOpenMs(at("2026-11-16T08:00:00+05:30")), at("2026-11-16T09:00:00+05:30")); // before the open
    assert.equal(nextMcxOpenMs(at("2026-11-16T10:00:00+05:30")), at("2026-11-17T09:00:00+05:30")); // after it
    assert.equal(nextMcxOpenMs(at("2026-11-12T23:58:00+05:30")), at("2026-11-13T09:00:00+05:30")); // Thursday night -> Friday
    assert.equal(nextMcxOpenMs(at("2026-11-15T12:00:00+05:30")), at("2026-11-16T09:00:00+05:30")); // Sunday
  });
});

describe("the scheduled close, for when Upstox doesn't say when MCX last traded", () => {
  it("is the latest weekday close at or before now", () => {
    assert.equal(lastScheduledCloseMs(SAT_NIGHT), at("2026-11-13T23:55:00+05:30")); // Saturday -> Friday's close
    assert.equal(lastScheduledCloseMs(at("2026-11-16T08:00:00+05:30")), at("2026-11-13T23:55:00+05:30")); // Monday before the open
    assert.equal(lastScheduledCloseMs(at("2026-11-12T20:00:00+05:30")), at("2026-11-11T23:55:00+05:30")); // Thursday evening -> Wednesday's
    assert.equal(lastScheduledCloseMs(at("2026-11-16T23:56:00+05:30")), at("2026-11-16T23:55:00+05:30")); // just after Monday's close
    assert.equal(lastScheduledCloseMs(at("2026-11-16T23:54:00+05:30")), at("2026-11-13T23:55:00+05:30")); // a minute before it
  });

  it("uses the summer close in summer", () => {
    assert.equal(lastScheduledCloseMs(at("2026-07-16T12:00:00+05:30")), at("2026-07-15T23:30:00+05:30"));
  });
});

describe("putting it together", () => {
  it("gives each shut market its expected open, with what it was worked out from", () => {
    const result = assembleExpectedOpen(SAT_NIGHT, [NATGAS, CRUDE]);
    assert.equal(result.open, false);
    assert.equal(result.quiet, false);
    assert.equal(result.reopensAt, at("2026-11-16T09:00:00+05:30"));
    assert.equal(result.fetchedAt, SAT_NIGHT);
    assert.equal(result.items.length, 2);

    const gas = result.items[0];
    assert.ok(isExpectedOpenItem(gas));
    const item: ExpectedOpenItem = gas;
    assert.equal(item.market, "NATURALGAS");
    near(item.expectedOpen, 307.9 * (3.236 / 3.255));
    assert.equal(item.mcxClose, 307.9);
    assert.equal(item.mcxClosedAt, FRI_CLOSE);
    assert.equal(item.nymex.symbol, "NGZ26.NYM");
    assert.equal(item.nymex.stale, false); // NYMEX updated 10 minutes ago
    assert.ok(item.movePct < 0);
  });

  it("says nothing to expect while MCX is trading - and asks for nothing more", () => {
    const evening = at("2026-11-12T20:00:00+05:30");
    const trading = (m: MarketInput): MarketInput => ({ ...m, mcx: { price: m.mcx!.price, lastTradeMs: evening - 5000 }, nymex: m.nymex ? { ...m.nymex, atClose: null, now: null } : null });
    const result = assembleExpectedOpen(evening, [trading(NATGAS), trading(CRUDE)]);
    assert.equal(result.open, true);
    assert.deepEqual(result.items, []);
    assert.equal(result.reopensAt, null);
  });

  it("marks NYMEX as shut too when its own price is old - the weekend, so the estimate is frozen until it reopens", () => {
    const saturdayMorning = at("2026-11-14T10:00:00+05:30");
    const stale = { ...NATGAS, nymex: { ...NATGAS.nymex!, now: { price: 3.236, asOf: at("2026-11-14T03:25:00+05:30") } } };
    const item = assembleExpectedOpen(saturdayMorning, [stale]).items[0];
    assert.ok(isExpectedOpenItem(item));
    assert.equal(item.nymex.stale, true);
  });

  it("is quiet, not closed, on a holiday morning: no reopening time to promise", () => {
    const result = assembleExpectedOpen(at("2026-11-10T10:00:00+05:30"), [{ ...NATGAS, mcx: { price: 301.7, lastTradeMs: at("2026-11-09T23:54:50+05:30") } }]);
    assert.equal(result.quiet, true);
    assert.equal(result.reopensAt, null);
    assert.equal(result.items.length, 1);
  });

  it("explains what is missing rather than inventing a number", () => {
    const reason = (input: MarketInput) => {
      const item = assembleExpectedOpen(SAT_NIGHT, [input]).items[0];
      return isExpectedOpenItem(item) ? "ok" : item.reason;
    };
    assert.equal(reason({ ...NATGAS, contract: null, nymex: null }), "no_contract");
    assert.equal(reason({ ...NATGAS, mcx: null }), "no_mcx_price");
    assert.equal(reason({ ...NATGAS, nymex: { ...NATGAS.nymex!, atClose: null } }), "waiting_for_close_price");
    assert.equal(reason({ ...NATGAS, nymex: { ...NATGAS.nymex!, now: null } }), "no_global_price");
    assert.equal(reason({ ...NATGAS, nymex: { ...NATGAS.nymex!, atClose: -1 } }), "no_global_price");
  });
});
