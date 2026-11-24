/**
 * The server feed behind the expected MCX open, with Upstox and Yahoo replaced by fakes: what it asks for, when, and what
 * it keeps. Natural gas (24 Nov 2026 future, key MCX_FO|1) and crude (19 Nov, MCX_FO|2) last traded at 23:54:59 IST on Friday 13 Nov.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { isExpectedOpenItem } from "@/lib/expectedOpen";
import { EXPECTED_OPEN_TTL_MS, getExpectedOpen, resetExpectedOpenFeed, type ExpectedOpenDeps } from "@/lib/expectedOpenFeed";
import type { NatgasFuture } from "@/lib/natgasContract";
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

const PRICES = { "NGZ26.NYM": { atClose: 3.255, now: 3.236 }, "CLZ26.NYM": { atClose: 88.7, now: 88.52 }, "INR=X": { atClose: 92.5, now: 92.6 } };

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

  it("carries the rupee rate with its time, asked once for both markets", async () => {
    const yahoo = fakeYahoo(PRICES);
    const result = await getExpectedOpen("token", deps({ fetchImpl: yahoo.fetchImpl }));
    assert.ok(!("error" in result));
    assert.equal(result.usdInr?.rate, 92.6);
    assert.equal(typeof result.usdInr?.asOf, "number");
    assert.equal(yahoo.urls.filter((u) => u.includes("INR%3DX")).length, 1);
  });

  it("still answers, with no rate, when Yahoo has none for the rupee", async () => {
    const yahoo = fakeYahoo({ "NGZ26.NYM": PRICES["NGZ26.NYM"], "CLZ26.NYM": PRICES["CLZ26.NYM"] });
    const result = await getExpectedOpen("token", deps({ fetchImpl: yahoo.fetchImpl }));
    assert.ok(!("error" in result));
    assert.equal(result.usdInr, null);
    assert.ok(result.items.every(isExpectedOpenItem));
  });

  it("keeps the last rupee rate when a later fetch fails", async () => {
    let t = SAT_NIGHT;
    const good = fakeYahoo(PRICES);
    const first = await getExpectedOpen("token", deps({ fetchImpl: good.fetchImpl, now: () => t }));
    assert.ok(!("error" in first));
    t += 2 * 60_000; // past the rate's minute
    const noRate = fakeYahoo({ "NGZ26.NYM": PRICES["NGZ26.NYM"], "CLZ26.NYM": PRICES["CLZ26.NYM"] });
    const second = await getExpectedOpen("token", deps({ fetchImpl: noRate.fetchImpl, now: () => t }));
    assert.ok(!("error" in second));
    assert.equal(second.usdInr?.rate, 92.6);
  });

  it("asks nothing about the rupee while MCX is trading", async () => {
    const yahoo = fakeYahoo(PRICES);
    await getExpectedOpen("token", deps({ fetchImpl: yahoo.fetchImpl, now: () => THU_EVENING, getQuotes: quotes(THU_EVENING - 4000) }));
    assert.equal(yahoo.urls.length, 0);
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
    assert.equal(yahoo.currents(), 3); // each market's current price, and the rupee rate

    t += EXPECTED_OPEN_TTL_MS - 1;
    await getExpectedOpen("token", d);
    assert.equal(yahoo.urls.length, 5); // still the first result

    t += 2;
    await getExpectedOpen("token", d);
    assert.equal(yahoo.windows(), 2); // the price at the close can't change: kept
    assert.equal(yahoo.currents(), 5); // the current prices are fetched afresh; the rupee rate is a minute old at most, so it is kept
  });

  it("shares one fetch between polls that arrive together", async () => {
    const yahoo = fakeYahoo(PRICES);
    const d = deps({ fetchImpl: yahoo.fetchImpl });
    await Promise.all([getExpectedOpen("token", d), getExpectedOpen("token", d), getExpectedOpen("token", d)]);
    assert.equal(yahoo.urls.length, 5);
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

// ---- a natural gas future of the caller's choosing ----------------------------------------------------------------------------

const NOV_F: NatgasFuture = { key: "MCX_FO|1", expiry: "2026-11-24", label: "NATURALGAS FUT 24 NOV 26" };
const DEC_F: NatgasFuture = { key: "MCX_FO|3", expiry: "2026-12-28", label: "NATURALGAS FUT 28 DEC 26" };
const JAN_F: NatgasFuture = { key: "MCX_FO|4", expiry: "2027-01-25", label: "NATURALGAS FUT 25 JAN 27" };
const LISTED = [NOV_F, DEC_F, JAN_F];
/** MCX December follows NYMEX January 2027 (NGF27), MCX January follows February (NGG27). */
const CHOICE_PRICES = { ...PRICES, "NGF27.NYM": { atClose: 3.55, now: 3.5 }, "NGG27.NYM": { atClose: 3.7, now: 3.7 } };

/** Quotes for the four contracts: every one last traded at `lastTradeMs`, except where `over` says. */
function fourQuotes(lastTradeMs: number, over: Record<string, number> = {}) {
  return async () =>
    new Map([
      ["MCX_FO|1", { price: 307.9, lastTradeMs }],
      ["MCX_FO|2", { price: 8372, lastTradeMs }],
      ["MCX_FO|3", { price: 318.4, lastTradeMs: over["MCX_FO|3"] ?? lastTradeMs }],
      ["MCX_FO|4", { price: 325.1, lastTradeMs: over["MCX_FO|4"] ?? lastTradeMs }],
    ]);
}

function choiceDeps(over: Partial<ExpectedOpenDeps> = {}): ExpectedOpenDeps {
  return deps({ getNatgasFutures: async () => LISTED, getQuotes: fourQuotes(FRI_CLOSE), ...over });
}

describe("a chosen natural gas future", () => {
  beforeEach(() => resetExpectedOpenFeed());

  it("adds nothing about contracts, and keeps the front month, when none was asked for", async () => {
    const yahoo = fakeYahoo(CHOICE_PRICES);
    const result = await getExpectedOpen("token", choiceDeps({ fetchImpl: yahoo.fetchImpl }));
    assert.ok(!("error" in result));
    assert.equal(result.natgas, undefined);
    const gas = result.items[0];
    assert.ok(isExpectedOpenItem(gas));
    assert.equal(gas.contract.expiry, "2026-11-24");
    assert.equal(gas.nymex.symbol, "NGZ26.NYM");
  });

  it("compares the chosen future with the NYMEX month after its own, and lists the futures to choose from", async () => {
    const yahoo = fakeYahoo(CHOICE_PRICES);
    const result = await getExpectedOpen("token", choiceDeps({ fetchImpl: yahoo.fetchImpl }), DEC_F.key);
    assert.ok(!("error" in result));
    const [gas, crude] = result.items;
    assert.ok(isExpectedOpenItem(gas) && isExpectedOpenItem(crude));
    assert.equal(gas.contract.expiry, "2026-12-28");
    assert.equal(gas.nymex.symbol, "NGF27.NYM");
    assert.equal(gas.mcxClose, 318.4);
    assert.ok(Math.abs(gas.expectedOpen - 318.4 * (3.5 / 3.55)) < 1e-9);
    assert.equal(crude.nymex.symbol, "CLZ26.NYM"); // crude is untouched by the choice
    assert.equal(result.natgas?.choice, "chosen");
    assert.equal(result.natgas?.contract.key, DEC_F.key);
    assert.equal(result.natgas?.contract.reason, "chosen by you");
    assert.deepEqual(result.natgas?.contracts.map((c) => c.key), [NOV_F.key, DEC_F.key, JAN_F.key]);
    assert.ok(yahoo.urls.every((u) => !/NGZ26/.test(u)), "the front month's NYMEX contract is not needed");
  });

  it("opens on the default - the nearest future with days to run - for 'default'", async () => {
    const yahoo = fakeYahoo(CHOICE_PRICES);
    // Nov expires in two days (the clock reads 14 Nov), so the default moves on to Dec.
    const rolling = [{ ...NOV_F, expiry: "2026-11-16" }, DEC_F, JAN_F];
    const result = await getExpectedOpen("token", choiceDeps({ fetchImpl: yahoo.fetchImpl, getNatgasFutures: async () => rolling }), "default");
    assert.ok(!("error" in result));
    assert.equal(result.natgas?.choice, "default");
    assert.equal(result.natgas?.contract.key, DEC_F.key);
    assert.match(result.natgas?.contract.reason ?? "", /expires in 2 days/);
    const gas = result.items[0];
    assert.ok(isExpectedOpenItem(gas));
    assert.equal(gas.nymex.symbol, "NGF27.NYM");
  });

  it("falls back to the default for a key that is no longer listed", async () => {
    const yahoo = fakeYahoo(CHOICE_PRICES);
    const result = await getExpectedOpen("token", choiceDeps({ fetchImpl: yahoo.fetchImpl }), "MCX_FO|999");
    assert.ok(!("error" in result));
    assert.equal(result.natgas?.choice, "default");
    assert.equal(result.natgas?.contract.key, NOV_F.key); // 10 days to run: the default is still the nearest
  });

  it("hands 'auto' to the chooser, and passes its error on", async () => {
    const yahoo = fakeYahoo(CHOICE_PRICES);
    const asked: (string | null)[] = [];
    const chooser = async (_token: string, _futures: readonly NatgasFuture[], selection: string | null) => {
      asked.push(selection);
      return { contract: { ...JAN_F, reason: "more business than Dec 2026 in the last session (9 vs 4)" }, choice: "auto" as const };
    };
    const result = await getExpectedOpen("token", choiceDeps({ fetchImpl: yahoo.fetchImpl, chooseContract: chooser }), "auto");
    assert.ok(!("error" in result));
    assert.deepEqual(asked, ["auto"]);
    assert.equal(result.natgas?.choice, "auto");
    assert.equal(result.natgas?.contract.key, JAN_F.key);
    const gas = result.items[0];
    assert.ok(isExpectedOpenItem(gas));
    assert.equal(gas.nymex.symbol, "NGG27.NYM");

    resetExpectedOpenFeed(); // the first answer is shared for a few seconds
    const lapsed = await getExpectedOpen("token", choiceDeps({ fetchImpl: yahoo.fetchImpl, chooseContract: async () => ({ error: "token_expired", status: 401 }) }), "auto");
    assert.deepEqual(lapsed, { error: "token_expired" });
  });

  it("reads whether MCX is trading off the front month: a thin far month that last traded hours ago does not make MCX look shut", async () => {
    const yahoo = fakeYahoo(CHOICE_PRICES);
    const threeHoursAgo = THU_EVENING - 3 * 3_600_000;
    const result = await getExpectedOpen(
      "token",
      choiceDeps({ fetchImpl: yahoo.fetchImpl, now: () => THU_EVENING, getQuotes: fourQuotes(THU_EVENING - 4000, { "MCX_FO|4": threeHoursAgo }) }),
      JAN_F.key,
    );
    assert.ok(!("error" in result));
    assert.equal(result.open, true);
    assert.equal(result.quiet, false);
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.natgas?.last, { price: 325.1, lastTradeMs: threeHoursAgo }); // what the tab shows while MCX trades
    assert.equal(yahoo.urls.length, 0);
  });

  it("keeps each choice's result on its own, and shares polls for the same choice", async () => {
    const yahoo = fakeYahoo(CHOICE_PRICES);
    let quoteCalls = 0;
    const counted = async () => {
      quoteCalls += 1;
      return fourQuotes(FRI_CLOSE)();
    };
    const d = choiceDeps({ fetchImpl: yahoo.fetchImpl, getQuotes: counted });
    await Promise.all([getExpectedOpen("token", d, DEC_F.key), getExpectedOpen("token", d, DEC_F.key)]);
    assert.equal(quoteCalls, 1, "polls that arrive together share one fetch");
    await getExpectedOpen("token", d, DEC_F.key);
    assert.equal(quoteCalls, 1, "and so does the next one, within the few seconds");
    const jan = await getExpectedOpen("token", d, JAN_F.key);
    assert.equal(quoteCalls, 2, "another choice is fetched for itself");
    assert.ok(!("error" in jan) && jan.natgas?.contract.key === JAN_F.key);
    const front = await getExpectedOpen("token", d);
    assert.equal(quoteCalls, 3, "and so is no choice at all - the Watchlist's answer is not the tab's");
    assert.ok(!("error" in front) && front.natgas === undefined);
  });

  it("falls back to the front month when no natural gas future is listed, and passes a failure to list them on", async () => {
    const yahoo = fakeYahoo(CHOICE_PRICES);
    const none = await getExpectedOpen("token", choiceDeps({ fetchImpl: yahoo.fetchImpl, getNatgasFutures: async () => [] }), "default");
    assert.ok(!("error" in none));
    assert.equal(none.natgas, undefined);
    const gas = none.items[0];
    assert.ok(isExpectedOpenItem(gas));
    assert.equal(gas.contract.expiry, "2026-11-24");

    resetExpectedOpenFeed();
    const down = await getExpectedOpen("token", choiceDeps({ fetchImpl: yahoo.fetchImpl, getNatgasFutures: async () => ({ error: "Upstox is down", status: 502 }) }), "default");
    assert.deepEqual(down, { error: "Upstox is down" });
  });

  it("says there is no price when the chosen future has none, and still offers the others", async () => {
    const yahoo = fakeYahoo(CHOICE_PRICES);
    const noJanQuote = async () =>
      new Map([
        ["MCX_FO|1", { price: 307.9, lastTradeMs: FRI_CLOSE }],
        ["MCX_FO|2", { price: 8372, lastTradeMs: FRI_CLOSE }],
      ]);
    const result = await getExpectedOpen("token", choiceDeps({ fetchImpl: yahoo.fetchImpl, getQuotes: noJanQuote }), JAN_F.key);
    assert.ok(!("error" in result));
    const gas = result.items[0];
    assert.ok(!isExpectedOpenItem(gas) && gas.reason === "no_mcx_price");
    assert.equal(result.natgas?.contracts.length, 3);
    assert.equal(result.natgas?.last, null);
  });
});
