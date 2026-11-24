/**
 * The planner's server side against a fake Upstox: which contract is active, what is fetched and kept, a lapsed token, a rate limit,
 * and the closed-market fallback to the last stored session. The fake serves the one-minute candle shape Upstox does: newest first,
 * an ISO time with +05:30 for the bar's start.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { istDay } from "@/lib/natgasPlanner/bars";
import type { Candle } from "@/lib/natgasPlanner/types";
import { chooseActive, defaultFuture, ROLL_DAYS, type NatgasFuture } from "@/lib/natgasContract";
import { getPlanner, resetPlannerFeed, type PlannerDeps } from "@/lib/natgasPlannerFeed";
import { chunkRanges, fetchMinuteHistory, parseCandles } from "@/lib/upstox/minuteCandles";

const at = (iso: string) => Date.parse(iso);
const iso = (t: number) => new Date(t + 19_800_000).toISOString().replace(".000Z", "+05:30");

const NOV: NatgasFuture = { key: "MCX_FO|111", expiry: "2026-11-24", label: "NATURALGAS FUT 24 NOV 26" };
const DEC: NatgasFuture = { key: "MCX_FO|222", expiry: "2026-12-28", label: "NATURALGAS FUT 28 DEC 26" };

const swing = (m: number) => 295 + 3 * Math.sin(m / 55) + 1.2 * Math.sin(m / 13);
/** A full session (09:00-23:54) of candles for a date. */
function session(date: string, volume = 10): Candle[] {
  const start = at(`${date}T00:00:00+05:30`);
  const out: Candle[] = [];
  for (let m = 540; m < 23 * 60 + 55; m++) {
    const o = swing(m);
    const c = swing(m + 1);
    out.push({ t: start + m * 60_000, o, h: Math.max(o, c) + 0.05, l: Math.min(o, c) - 0.05, c, v: volume });
  }
  return out;
}
const DAYS = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-16", "2026-11-17"];
const history = new Map(DAYS.map((d) => [d, session(d)]));
const row = (c: Candle) => [iso(c.t), c.o, c.h, c.l, c.c, c.v, 0];

type Calls = { history: string[]; intraday: number; daily: string[]; total: number };

/** Upstox as a fake. `today` is the date whose candles `todayCandles` are served on the intraday route. */
function fakeUpstox(opts: { todayCandles?: Candle[]; status?: number; failures?: number[]; dailyVolumes?: Record<string, Record<string, number>> } = {}) {
  const calls: Calls = { history: [], intraday: 0, daily: [], total: 0 };
  const failuresLeft = [...(opts.failures ?? [])];
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.total += 1;
    if (opts.status && opts.status !== 200) return new Response("no", { status: opts.status });
    if (failuresLeft.length) return new Response("slow down", { status: failuresLeft.shift()! });
    let m: RegExpMatchArray | null;
    if ((m = url.match(/historical-candle\/intraday\/([^/]+)\/minutes\/1/))) {
      calls.intraday += 1;
      return Response.json({ status: "success", data: { candles: [...(opts.todayCandles ?? [])].reverse().map(row) } });
    }
    if ((m = url.match(/historical-candle\/([^/]+)\/minutes\/1\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/))) {
      calls.history.push(`${m[3]}..${m[2]}`);
      const days = DAYS.filter((d) => d >= m![3] && d <= m![2]);
      return Response.json({ status: "success", data: { candles: days.flatMap((d) => history.get(d)!).reverse().map(row) } });
    }
    if ((m = url.match(/historical-candle\/([^/]+)\/days\/1\//))) {
      const key = decodeURIComponent(m[1]);
      calls.daily.push(key);
      const vols = opts.dailyVolumes?.[key] ?? {};
      return Response.json({ status: "success", data: { candles: Object.entries(vols).map(([d, v]) => [`${d}T00:00:00+05:30`, 1, 1, 1, 1, v, 0]) } });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

const sleeps: number[] = [];
function deps(over: Omit<Partial<PlannerDeps>, "now"> & { now: number }): PlannerDeps {
  const { now, ...rest } = over;
  return { getFutures: async () => [NOV, DEC], getQuote: async () => ({ price: 296.4, lastTradeMs: now - 5000 }), sleep: async (ms) => void sleeps.push(ms), ...rest, now: () => now };
}
const NIGHT = at("2026-11-18T00:30:00+05:30"); // MCX shut, before today's first trade
const MORNING = at("2026-11-18T10:07:30+05:30");
const todaySoFar = session("2026-11-18").filter((c) => c.t < at("2026-11-18T10:07:00+05:30"));

describe("minute candles", () => {
  it("reads Upstox's rows ascending, drops malformed ones and repeats", () => {
    const body = { data: { candles: [["2026-11-17T09:02:00+05:30", 3, 4, 2, 3.5, 7, 0], ["2026-11-17T09:00:00+05:30", 1, 2, 1, 1.5, 5, 0], ["2026-11-17T09:01:00+05:30", "x", 1, 1, 1, 1, 0], ["2026-11-17T09:00:00+05:30", 9, 9, 9, 9, 9, 0], "junk", ["2026-11-17T09:03:00+05:30", 0, 1, 1, 1, 1, 0]] } };
    const c = parseCandles(body);
    assert.deepEqual(c.map((x) => x.t), [at("2026-11-17T09:00:00+05:30"), at("2026-11-17T09:02:00+05:30")]);
    assert.equal(c[0].o, 9); // the later row for the same minute wins
    assert.deepEqual(parseCandles(null), []);
    assert.deepEqual(parseCandles({ data: {} }), []);
  });

  it("splits a long range into contiguous requests of at most 27 days", () => {
    const r = chunkRanges("2026-09-19", "2026-11-17");
    assert.equal(r.length, 3);
    assert.equal(r[0][0], "2026-09-19");
    assert.equal(r.at(-1)![1], "2026-11-17");
    const span = ([a, b]: [string, string]) => (Date.parse(b) - Date.parse(a)) / 86_400_000 + 1;
    assert.ok(r.every((x) => span(x) <= 27));
    for (let i = 1; i < r.length; i++) assert.equal(Date.parse(r[i][0]) - Date.parse(r[i - 1][1]), 86_400_000);
    assert.deepEqual(chunkRanges("2026-11-10", "2026-11-10"), [["2026-11-10", "2026-11-10"]]);
  });

  it("asks for history with the end date first", async () => {
    const urls: string[] = [];
    const fetchImpl = (async (u: RequestInfo | URL) => { urls.push(String(u)); return Response.json({ data: { candles: [] } }); }) as typeof fetch;
    await fetchMinuteHistory("t", "MCX_FO|574319", "2026-11-01", "2026-11-17", { fetchImpl, sleep: async () => {} });
    assert.match(urls[0], /\/v3\/historical-candle\/MCX_FO%7C574319\/minutes\/1\/2026-11-17\/2026-11-01$/);
  });

  it("retries a 429 after 1 s, 3 s and 9 s, then gives up", async () => {
    const waits: number[] = [];
    let n = 0;
    const fetchImpl = (async () => { n += 1; return new Response("slow", { status: 429 }); }) as typeof fetch;
    const r = await fetchMinuteHistory("t", "k", "2026-11-01", "2026-11-02", { fetchImpl, sleep: async (ms) => void waits.push(ms) });
    assert.ok("error" in r && r.status === 429);
    assert.equal(n, 4);
    assert.deepEqual(waits.filter((w) => w >= 1000), [1000, 3000, 9000]);
  });

  it("recovers when a 429 is followed by an answer", async () => {
    let n = 0;
    const fetchImpl = (async () => { n += 1; return n === 1 ? new Response("slow", { status: 429 }) : Response.json({ data: { candles: [["2026-11-17T09:00:00+05:30", 1, 2, 1, 1.5, 5, 0]] } }); }) as typeof fetch;
    const r = await fetchMinuteHistory("t", "k", "2026-11-17", "2026-11-17", { fetchImpl, sleep: async () => {} });
    assert.ok(!("error" in r) && r.candles.length === 1);
  });

  it("reads a 401 or 403 as the lapsed token", async () => {
    for (const status of [401, 403]) {
      const fetchImpl = (async () => new Response("no", { status })) as typeof fetch;
      const r = await fetchMinuteHistory("t", "k", "2026-11-17", "2026-11-17", { fetchImpl, sleep: async () => {} });
      assert.ok("error" in r && r.error === "token_expired");
    }
  });
});

describe("which contract is active", () => {
  it("is the one with more volume in the last session", () => {
    const a = chooseActive([NOV, DEC], new Map([[NOV.key, 1000], [DEC.key, 5000]]));
    assert.equal(a.key, DEC.key);
    assert.match(a.reason, /more business than Nov 2026/);
    assert.equal(chooseActive([NOV, DEC], new Map([[NOV.key, 9000], [DEC.key, 5000]])).key, NOV.key);
  });
  it("is the nearer expiry when volumes are missing or level", () => {
    assert.equal(chooseActive([NOV, DEC], new Map()).key, NOV.key);
    assert.match(chooseActive([NOV, DEC], new Map([[NOV.key, null], [DEC.key, 5]])).reason, /volumes unavailable/);
    assert.equal(chooseActive([NOV, DEC], new Map([[NOV.key, 7], [DEC.key, 7]])).key, NOV.key);
  });
  it("is the only one when only one is listed", () => {
    assert.equal(chooseActive([DEC], new Map()).key, DEC.key);
  });
});

const FEB: NatgasFuture = { key: "MCX_FO|333", expiry: "2027-01-25", label: "NATURALGAS FUT 25 JAN 27" };
const day = (iso: string) => iso;

describe("the default contract", () => {
  it("is the nearest while it has more than three days to run", () => {
    const d = defaultFuture([NOV, DEC, FEB], day("2026-11-18")); // Nov expires in 6 days
    assert.equal(d.key, NOV.key);
    assert.equal(d.reason, "the nearest contract");
  });

  it("moves on to the next when the front month is about to expire - Dec-26 on 23 Nov, with Nov-26 expiring the next day", () => {
    const d = defaultFuture([NOV, DEC, FEB], day("2026-11-23"));
    assert.equal(d.key, DEC.key);
    assert.match(d.reason, /Nov 2026 expires in 1 day/);
    assert.equal(defaultFuture([NOV, DEC], day("2026-11-24")).key, DEC.key); // on the expiry day itself
    assert.match(defaultFuture([NOV, DEC], day("2026-11-24")).reason, /expires in 0 days/);
  });

  it("draws the line at three days: three still rolls on, four does not", () => {
    assert.equal(ROLL_DAYS, 3);
    assert.equal(defaultFuture([NOV, DEC], day("2026-11-21")).key, DEC.key); // 3 days left
    assert.equal(defaultFuture([NOV, DEC], day("2026-11-20")).key, NOV.key); // 4 days left
  });

  it("keeps rolling as the months pass, and uses the only contract there is", () => {
    assert.equal(defaultFuture([DEC, FEB], day("2026-12-26")).key, FEB.key); // Dec-26 expires on the 28th: 2 days
    assert.equal(defaultFuture([DEC], day("2026-12-27")).key, DEC.key);
  });
});

describe("choosing the contract", () => {
  beforeEach(() => {
    resetPlannerFeed();
    sleeps.length = 0;
  });
  const ROLLING = at("2026-11-23T10:30:00+05:30"); // Nov-26 expires tomorrow

  it("opens on Dec-26 today, by the default rule, and lists every contract to choose from", async () => {
    const up = fakeUpstox();
    const r = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: ROLLING, getFutures: async () => [NOV, DEC, FEB] }));
    assert.ok(!("error" in r));
    assert.equal(r.contract.key, DEC.key);
    assert.equal(r.choice, "default");
    assert.deepEqual(r.contracts.map((c) => c.key), [NOV.key, DEC.key, FEB.key]);
    assert.ok(up.calls.daily.length === 0, "the default rule needs no volume lookups");
  });

  it("plans on the contract picked, whatever the default or the volumes say", async () => {
    const up = fakeUpstox({ dailyVolumes: { [NOV.key]: { "2026-11-17": 9000 }, [DEC.key]: { "2026-11-17": 1 } } });
    const r = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: ROLLING, getFutures: async () => [NOV, DEC, FEB] }), FEB.key);
    assert.ok(!("error" in r));
    assert.equal(r.contract.key, FEB.key);
    assert.equal(r.choice, "chosen");
    assert.equal(r.contract.reason, "chosen by you");
  });

  it("goes by volume when asked for 'auto'", async () => {
    const up = fakeUpstox({ dailyVolumes: { [NOV.key]: { "2026-11-20": 9000 }, [DEC.key]: { "2026-11-20": 100 } } });
    const r = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: ROLLING, getFutures: async () => [NOV, DEC, FEB] }), "auto");
    assert.ok(!("error" in r));
    assert.equal(r.contract.key, NOV.key);
    assert.equal(r.choice, "auto");
  });

  it("falls back to the default for a contract that is no longer listed", async () => {
    const up = fakeUpstox();
    const r = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: ROLLING, getFutures: async () => [DEC, FEB] }), "MCX_FO|999");
    assert.ok(!("error" in r));
    assert.equal(r.choice, "default");
    assert.equal(r.contract.key, DEC.key);
  });

  it("asks Upstox for the candles of the contract picked - and only that one's", async () => {
    const urls: string[] = [];
    const up = fakeUpstox();
    const fetchImpl = (async (u: RequestInfo | URL) => { urls.push(String(u)); return up.fetchImpl(u); }) as typeof fetch;
    await getPlanner("t", 5, deps({ fetchImpl, now: ROLLING, getFutures: async () => [NOV, DEC, FEB] }), FEB.key);
    const candleCalls = urls.filter((u) => /minutes\/1/.test(u));
    assert.ok(candleCalls.length > 0);
    assert.ok(candleCalls.every((u) => u.includes(encodeURIComponent(FEB.key))), candleCalls.join("\n"));
  });

  it("keeps each contract's history, so switching back and forth fetches it once", async () => {
    const up = fakeUpstox({ todayCandles: todaySoFar });
    const now = at("2026-11-18T10:07:30+05:30");
    const base = deps({ fetchImpl: up.fetchImpl, now, getFutures: async () => [NOV, DEC] });
    await getPlanner("t", 5, base, NOV.key);
    const afterNov = up.calls.history.length;
    await getPlanner("t", 5, base, DEC.key);
    const afterDec = up.calls.history.length;
    assert.ok(afterDec > afterNov, "the second contract has to be read once");
    await getPlanner("t", 5, base, NOV.key);
    await getPlanner("t", 5, base, DEC.key);
    assert.equal(up.calls.history.length, afterDec, "going back and forth costs nothing");
  });

  it("does not mix the contracts' candles: each one's overview comes from its own", async () => {
    // Nov rises through the days, Dec is flat: the two must not give the same answer.
    const flatCandles = (d: string) => session(d).map((c) => ({ ...c, o: 300, h: 300.05, l: 299.95, c: 300 }));
    history.clear();
    for (const d of DAYS) history.set(d, session(d));
    const up = fakeUpstox();
    const fetchImpl = (async (u: RequestInfo | URL) => {
      const url = String(u);
      if (url.includes(encodeURIComponent(DEC.key)) && /minutes\/1\/\d{4}/.test(url)) {
        const m = url.match(/minutes\/1\/(\d{4}-\d{2}-\d{2})\/(\d{4}-\d{2}-\d{2})/)!;
        const days = DAYS.filter((d) => d >= m[2] && d <= m[1]);
        return Response.json({ data: { candles: days.flatMap(flatCandles).reverse().map(row) } });
      }
      return up.fetchImpl(u);
    }) as typeof fetch;
    const base = deps({ fetchImpl, now: NIGHT, getFutures: async () => [NOV, DEC] });
    const nov = await getPlanner("t", 15, base, NOV.key);
    const dec = await getPlanner("t", 15, base, DEC.key);
    assert.ok(!("error" in nov) && !("error" in dec));
    assert.equal(dec.lastClose, 300);
    assert.notEqual(nov.lastClose, 300);
    assert.notDeepEqual(nov.timeframes.map((t) => t.atr), dec.timeframes.map((t) => t.atr));
  });
});

describe("getPlanner", () => {
  beforeEach(() => {
    resetPlannerFeed();
    sleeps.length = 0;
  });

  it("serves from the last stored session when the market is shut and today has no candles yet", async () => {
    const up = fakeUpstox({ todayCandles: [], dailyVolumes: { [NOV.key]: { "2026-11-17": 9000 }, [DEC.key]: { "2026-11-17": 100 } } });
    const r = await getPlanner("t", 15, deps({ fetchImpl: up.fetchImpl, now: NIGHT }));
    assert.ok(!("error" in r));
    assert.equal(r.mode, "last-session");
    assert.equal(r.contract.key, NOV.key);
    assert.equal(r.market.open, false);
    assert.equal(istDay(r.lastCandleAt!), "2026-11-17");
    assert.equal(r.timeframes.length, 9);
    assert.deepEqual(r.timeframes.map((t) => t.tf), [1, 2, 3, 5, 10, 15, 30, 60, 240]);
    assert.ok(r.timeframes.every((t) => t.green !== null && t.atr !== null));
    assert.equal(r.selected.tf, 15);
    assert.ok(r.selected.chart.length > 0 && r.selected.chart.every((b) => !b.forming));
    assert.ok(r.prevClose !== null); // the close of the session before the last one
    assert.equal(r.ltp?.price, 296.4);
    assert.equal(r.thinPct, 0);
  });

  it("goes live when today's candles arrive, with one forming bar kept out of the signal", async () => {
    const up = fakeUpstox({ todayCandles: todaySoFar });
    const r = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: MORNING }));
    assert.ok(!("error" in r));
    assert.equal(r.mode, "live");
    assert.equal(istDay(r.lastCandleAt!), "2026-11-18");
    assert.equal(r.market.open, true);
    assert.equal(r.selected.chart.filter((b) => b.forming).length, 1);
    const five = r.timeframes.find((t) => t.tf === 5)!;
    assert.ok(five.lastBarEnd! <= MORNING, "a completed bar ended before now");
  });

  it("picks the contract with the volume and reads that one's candles", async () => {
    const up = fakeUpstox({ dailyVolumes: { [NOV.key]: { "2026-11-17": 100 }, [DEC.key]: { "2026-11-17": 9000 } } });
    const r = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: NIGHT }), "auto");
    assert.ok(!("error" in r));
    assert.equal(r.contract.key, DEC.key);
    assert.equal(r.choice, "auto");
    assert.match(r.contract.reason, /more business than Nov 2026/);
  });

  it("falls back to the nearer contract when the daily volumes can't be read", async () => {
    const up = fakeUpstox();
    const fetchImpl = (async (u: RequestInfo | URL) => (String(u).includes("/days/1/") ? new Response("x", { status: 500 }) : up.fetchImpl(u))) as typeof fetch;
    const r = await getPlanner("t", 5, deps({ fetchImpl, now: NIGHT }), "auto");
    assert.ok(!("error" in r));
    assert.equal(r.contract.key, NOV.key);
    assert.match(r.contract.reason, /volumes unavailable/);
  });

  it("keeps history for the day: a second call fetches only today's candles", async () => {
    const up = fakeUpstox({ todayCandles: todaySoFar });
    await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: MORNING }));
    const first = { history: up.calls.history.length, daily: up.calls.daily.length, intraday: up.calls.intraday };
    await getPlanner("t", 15, deps({ fetchImpl: up.fetchImpl, now: MORNING + 20_000 }));
    assert.equal(up.calls.history.length, first.history);
    assert.equal(up.calls.daily.length, first.daily);
    assert.equal(up.calls.intraday, first.intraday + 1); // past the 8 s share
  });

  it("shares today's candles between polls a few seconds apart", async () => {
    const up = fakeUpstox({ todayCandles: todaySoFar });
    await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: MORNING }));
    await getPlanner("t", 10, deps({ fetchImpl: up.fetchImpl, now: MORNING + 3000 }));
    assert.equal(up.calls.intraday, 1);
  });

  it("refetches everything on a new day", async () => {
    const up = fakeUpstox();
    await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: NIGHT }));
    const n = up.calls.history.length;
    await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: NIGHT + 86_400_000 }));
    assert.ok(up.calls.history.length > n);
  });

  it("reads the history in 27-day requests ending the day before today", async () => {
    const up = fakeUpstox();
    await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: NIGHT }));
    assert.ok(up.calls.history.length >= 2);
    assert.ok(up.calls.history.every((range) => { const [from, to] = range.split(".."); return (Date.parse(to) - Date.parse(from)) / 86_400_000 + 1 <= 27 && to <= "2026-11-17"; }));
  });

  it("answers token_expired, and keeps no history for it, when Upstox says 401", async () => {
    const up = fakeUpstox({ status: 401 });
    const r = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: NIGHT }));
    assert.deepEqual(r, { error: "token_expired", status: 401 });
    const ok = fakeUpstox();
    const again = await getPlanner("t", 5, deps({ fetchImpl: ok.fetchImpl, now: NIGHT }));
    assert.ok(!("error" in again));
  });

  it("recovers through a rate limit with the growing waits", async () => {
    const up = fakeUpstox({ failures: [429, 429] });
    const r = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: NIGHT }));
    assert.ok(!("error" in r));
    assert.deepEqual(sleeps.filter((s) => s >= 1000), [1000, 3000]);
  });

  it("goes on with what it has when only the intraday call hiccups", async () => {
    const up = fakeUpstox();
    const fetchImpl = (async (u: RequestInfo | URL) => (String(u).includes("/intraday/") ? new Response("x", { status: 500 }) : up.fetchImpl(u))) as typeof fetch;
    const r = await getPlanner("t", 5, deps({ fetchImpl, now: MORNING }));
    assert.ok(!("error" in r));
    assert.equal(r.mode, "last-session");
  });

  it("carries the replay: sessions covered, a cell per timeframe x ratio with a verdict, and the selected timeframe's recent flips", async () => {
    const up = fakeUpstox();
    const r = await getPlanner("t", 15, deps({ fetchImpl: up.fetchImpl, now: NIGHT }));
    assert.ok(!("error" in r));
    assert.equal(r.replay.sessions, 12);
    assert.equal(r.replay.timeframes.length, 9);
    const cell = r.replay.timeframes.find((t) => t.tf === 15)!.byRatio["2"];
    assert.ok(cell.stats.n > 0);
    assert.equal(cell.verdict.kind, "not-enough"); // 12 sessions is far short of 30
    assert.match(cell.verdict.text, /Not enough data yet/);
    assert.ok(r.replay.recent.length > 0 && r.replay.recent.length <= 10);
  });

  it("says when Upstox lists no natural gas future, and passes a contract-list failure on", async () => {
    const up = fakeUpstox();
    const none = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: NIGHT, getFutures: async () => [] }));
    assert.ok("error" in none && /no natural gas futures/.test(none.error));
    const failed = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: NIGHT, getFutures: async () => ({ error: "Upstox's MCX contract list returned 500", status: 502 }) }));
    assert.deepEqual(failed, { error: "Upstox's MCX contract list returned 500", status: 502 });
  });

  it("works without a quote: the page falls back to the last close", async () => {
    const up = fakeUpstox();
    const r = await getPlanner("t", 5, deps({ fetchImpl: up.fetchImpl, now: NIGHT, getQuote: async () => null }));
    assert.ok(!("error" in r));
    assert.equal(r.ltp, null);
    assert.ok(r.lastClose !== null);
  });
});
