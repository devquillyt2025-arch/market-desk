/**
 * The server feed behind the expected MCX open, with Upstox and Yahoo replaced by fakes: what it asks for, when, and what
 * it keeps. Natural gas (24 Nov 2026 future, key MCX_FO|1) and crude (19 Nov, MCX_FO|2) last traded at 23:54:59 IST on Friday 13 Nov.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { isExpectedOpenItem } from "@/lib/expectedOpen";
import { EXPECTED_OPEN_TTL_MS, getExpectedOpen, resetExpectedOpenFeed, type ExpectedOpenDeps } from "@/lib/expectedOpenFeed";
import type { McxFuture } from "@/lib/upstox/mcx";

const at = (iso: string) => Date.parse(iso);
const FRI_CLOSE = at("2026-11-13T23:54:59+05:30");
const SAT_NIGHT = at("2026-11-14T00:51:00+05:30");
const THU_EVENING = at("2026-11-12T20:00:00+05:30");

const FUTURES = new Map<string, McxFuture>([
  ["NATURALGAS", { symbol: "NATURALGAS", name: "NATURAL GAS", key: "MCX_FO|1", expiry: "2026-11-24", tradingSymbol: "NATURALGAS FUT 24 NOV 26" }],
  ["CRUDEOIL", { symbol: "CRUDEOIL", name: "CRUDE OIL", key: "MCX_FO|2", expiry: "2026-11-19", tradingSymbol: "CRUDEOIL FUT 19 NOV 26" }],
]);

/** Upstox's quotes: both contracts last traded at `lastTradeMs`. */
function quotes(lastTradeMs: number) {
  return async () =>
    new Map([
      ["MCX_FO|1", { price: 307.9, lastTradeMs }],
      ["MCX_FO|2", { price: 8372, lastTradeMs }],
    ]);
}

/**
 * Yahoo, as a fake: for each symbol a price at the moment MCX closed (1-minute candles) and a current price (the meta),
 * counting what it was asked.
 */
function fakeYahoo(prices: Record<string, { atClose: number; now: number }>, opts: { candlesUpTo?: string } = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    urls.push(url);
    const symbol = decodeURIComponent(url.split("/chart/")[1].split("?")[0]);
    const p = prices[symbol];
    if (!p) return new Response("not found", { status: 404 });
    if (url.includes("interval=1m")) {
      // Candles every minute up to opts.candlesUpTo (default: past the close), all at the close-time price.
      const last = opts.candlesUpTo ? at(opts.candlesUpTo) : FRI_CLOSE + 5 * 60_000;
      const ts: number[] = [];
      for (let t = FRI_CLOSE - 20 * 60_000; t <= last; t += 60_000) ts.push(Math.floor(t / 60_000) * 60);
      return Response.json({ chart: { result: [{ timestamp: ts, indicators: { quote: [{ close: ts.map(() => p.atClose) }] } }] } });
    }
    return Response.json({ chart: { result: [{ meta: { regularMarketPrice: p.now, regularMarketTime: at("2026-11-14T00:41:00+05:30") / 1000, shortName: "x" } }] } });
  }) as typeof fetch;
  return { fetchImpl, urls, windows: () => urls.filter((u) => u.includes("interval=1m")).length, currents: () => urls.filter((u) => u.includes("interval=1d")).length };
}

const PRICES = { "NGZ26.NYM": { atClose: 3.255, now: 3.236 }, "CLZ26.NYM": { atClose: 88.7, now: 88.52 } };

function deps(over: Partial<ExpectedOpenDeps>): ExpectedOpenDeps {
  return { getFutures: async () => FUTURES, getQuotes: quotes(FRI_CLOSE), now: () => SAT_NIGHT, ...over };
}

describe("the expected-open feed", () => {
  beforeEach(() => resetExpectedOpenFeed());

  it("compares each MCX contract with the one NYMEX month it follows, and works out the expected open", async () => {
    const yahoo = fakeYahoo(PRICES);
    const result = await getExpectedOpen("token", deps({ fetchImpl: yahoo.fetchImpl }));
    assert.ok(!("error" in result));
    assert.equal(result.open, false);
    assert.equal(result.items.length, 2);
    const [gas, crude] = result.items;
    assert.ok(isExpectedOpenItem(gas) && isExpectedOpenItem(crude));
    assert.equal(gas.nymex.symbol, "NGZ26.NYM"); // MCX November -> NYMEX December, not the rolling front month
    assert.equal(crude.nymex.symbol, "CLZ26.NYM");
    assert.ok(Math.abs(gas.expectedOpen - 307.9 * (3.236 / 3.255)) < 1e-9);
    assert.ok(Math.abs(crude.expectedOpen - 8372 * (88.52 / 88.7)) < 1e-9);
    assert.equal(gas.contract.expiry, "2026-11-24");
  });

  it("never asks Yahoo about the rolling front month", async () => {
    const yahoo = fakeYahoo(PRICES);
    await getExpectedOpen("token", deps({ fetchImpl: yahoo.fetchImpl }));
    assert.ok(yahoo.urls.every((u) => !/NG%3DF|CL%3DF/.test(u)), yahoo.urls.join("\n"));
  });

  it("asks nothing of Yahoo while MCX is trading", async () => {
    const yahoo = fakeYahoo(PRICES);
    const result = await getExpectedOpen("token", deps({ fetchImpl: yahoo.fetchImpl, now: () => THU_EVENING, getQuotes: quotes(THU_EVENING - 4000) }));
    assert.ok(!("error" in result));
    assert.equal(result.open, true);
    assert.deepEqual(result.items, []);
    assert.equal(yahoo.urls.length, 0);
  });

  it("shares one result between polls for a few seconds, then refreshes only what moves", async () => {
    const yahoo = fakeYahoo(PRICES);
    let t = SAT_NIGHT;
    const d = deps({ fetchImpl: yahoo.fetchImpl, now: () => t });
    await getExpectedOpen("token", d);
    assert.equal(yahoo.windows(), 2); // the NYMEX price at MCX's close, once per market
    assert.equal(yahoo.currents(), 2);

    t += EXPECTED_OPEN_TTL_MS - 1;
    await getExpectedOpen("token", d);
    assert.equal(yahoo.urls.length, 4); // still the first result

    t += 2;
    await getExpectedOpen("token", d);
    assert.equal(yahoo.windows(), 2); // the price at the close can't change: kept
    assert.equal(yahoo.currents(), 4); // the current price is fetched afresh
  });

  it("shares one fetch between polls that arrive together", async () => {
    const yahoo = fakeYahoo(PRICES);
    const d = deps({ fetchImpl: yahoo.fetchImpl });
    await Promise.all([getExpectedOpen("token", d), getExpectedOpen("token", d), getExpectedOpen("token", d)]);
    assert.equal(yahoo.urls.length, 4);
  });

  it("waits, and asks again next time, while Yahoo hasn't caught up to the moment MCX closed", async () => {
    // Candles that stop at 23:30: nothing recent enough to be the price at 23:54:59.
    const behind = fakeYahoo(PRICES, { candlesUpTo: "2026-11-13T23:30:00+05:30" });
    let t = SAT_NIGHT;
    const first = await getExpectedOpen("token", deps({ fetchImpl: behind.fetchImpl, now: () => t }));
    assert.ok(!("error" in first));
    assert.ok(first.items.every((i) => !isExpectedOpenItem(i) && i.reason === "waiting_for_close_price"));

    // A little later the candles are there: the missing price was not remembered as a failure.
    const caughtUp = fakeYahoo(PRICES);
    t += EXPECTED_OPEN_TTL_MS + 1;
    const second = await getExpectedOpen("token", deps({ fetchImpl: caughtUp.fetchImpl, now: () => t }));
    assert.ok(!("error" in second));
    assert.ok(second.items.every(isExpectedOpenItem));
  });

  it("falls back to the scheduled close when Upstox gives no time of the last trade, instead of waiting for ever", async () => {
    const yahoo = fakeYahoo(PRICES);
    const noTime = async () =>
      new Map([
        ["MCX_FO|1", { price: 307.9, lastTradeMs: null }],
        ["MCX_FO|2", { price: 8372, lastTradeMs: null }],
      ]);
    const result = await getExpectedOpen("token", deps({ fetchImpl: yahoo.fetchImpl, getQuotes: noTime }));
    assert.ok(!("error" in result));
    assert.ok(result.items.every(isExpectedOpenItem));
    const [gas] = result.items;
    assert.ok(isExpectedOpenItem(gas));
    assert.equal(gas.mcxClosedAt, null);
    assert.ok(Math.abs(gas.expectedOpen - 307.9 * (3.236 / 3.255)) < 1e-9);
  });

  it("reports a market Yahoo has no price for, and still gives the other", async () => {
    const yahoo = fakeYahoo({ "NGZ26.NYM": PRICES["NGZ26.NYM"] });
    const result = await getExpectedOpen("token", deps({ fetchImpl: yahoo.fetchImpl }));
    assert.ok(!("error" in result));
    const [gas, crude] = result.items;
    assert.ok(isExpectedOpenItem(gas));
    assert.ok(!isExpectedOpenItem(crude));
  });

  it("passes on an Upstox error - a lapsed token - and tries again on the next poll", async () => {
    const yahoo = fakeYahoo(PRICES);
    let fail = true;
    const d = deps({
      fetchImpl: yahoo.fetchImpl,
      getQuotes: async () => (fail ? { error: "token_expired", status: 401 } : quotes(FRI_CLOSE)()),
    });
    const bad = await getExpectedOpen("token", d);
    assert.deepEqual(bad, { error: "token_expired" });
    fail = false;
    const good = await getExpectedOpen("token", d);
    assert.ok(!("error" in good));
    assert.equal(good.items.length, 2);
  });

  it("says no contract when MCX lists no future for a market", async () => {
    const yahoo = fakeYahoo(PRICES);
    const onlyCrude = new Map([["CRUDEOIL", FUTURES.get("CRUDEOIL")!]]);
    const result = await getExpectedOpen("token", deps({ fetchImpl: yahoo.fetchImpl, getFutures: async () => onlyCrude }));
    assert.ok(!("error" in result));
    const gas = result.items.find((i) => i.market === "NATURALGAS");
    assert.ok(gas && !isExpectedOpenItem(gas) && gas.reason === "no_contract");
  });
});
