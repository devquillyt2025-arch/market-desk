/**
 * The figures are real: what Upstox returned for the MCX futures on Saturday 21 Nov 2026 at 01:36 IST, after Friday's close at
 * 23:55. The daily candles are the exchange's own closes; `cp` is Upstox's "previous close", which it had reset for some contracts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sessionReference } from "@/lib/heatmap/sessionMove";

const istMs = (isoDate: string, hhmm: string) => {
  const [y, m, d] = isoDate.split("-").map(Number);
  const [hh, mm] = hhmm.split(":").map(Number);
  return Date.UTC(y, m - 1, d, hh, mm) - 5.5 * 3_600_000;
};
const closes = (...pairs: [string, number][]) => pairs.map(([date, close]) => ({ date, close, open: null }));
const pct = (price: number, ref: number | null) => (ref === null ? null : Math.round(((price - ref) / ref) * 10000) / 100);

describe("the close a commodity's one-day move is measured against", () => {
  // Completed sessions before Saturday 21 Nov: Gold (the 1 kg contract) fell from 127,452 to 121,949 on Friday.
  const gold = closes(["2026-11-17", 134223], ["2026-11-18", 129814], ["2026-11-19", 127452], ["2026-11-20", 121949]);

  it("is the close before the last trade's session - Gold, whose cp (121,778) had been reset to Friday's settlement", () => {
    const ref = sessionReference({ closes: gold, lastTradeMs: istMs("2026-11-20", "23:54"), cp: 121778 });
    assert.equal(ref, 127452);
    assert.equal(pct(121949, ref), -4.32); // not +0.14%
  });

  it("agrees with Upstox's cp wherever that is right - Gold Mini, whose cp was still Thursday's close", () => {
    const mini = closes(["2026-11-18", 129880], ["2026-11-19", 127499], ["2026-11-20", 121871]);
    const ref = sessionReference({ closes: mini, lastTradeMs: istMs("2026-11-20", "23:54"), cp: 127499 });
    assert.equal(ref, 127499);
    assert.equal(pct(121871, ref), -4.41);
  });

  it("fixes the silvers and copper the same way", () => {
    assert.equal(pct(148900, sessionReference({ closes: closes(["2026-11-19", 157482], ["2026-11-20", 148900]), lastTradeMs: istMs("2026-11-20", "23:54"), cp: 147813 })), -5.45);
    assert.equal(pct(1154, sessionReference({ closes: closes(["2026-11-19", 1193.6], ["2026-11-20", 1154]), lastTradeMs: istMs("2026-11-20", "23:54"), cp: 1152.9 })), -3.32);
  });

  it("is the last completed close while the session is on - the same as cp", () => {
    // Friday 15:00: today's candle isn't in `closes` yet (it is partial), so the last close is Thursday's.
    const duringFriday = closes(["2026-11-18", 129814], ["2026-11-19", 127452]);
    assert.equal(sessionReference({ closes: duringFriday, lastTradeMs: istMs("2026-11-20", "15:00"), cp: 127452 }), 127452);
  });

  it("uses the session of the last trade for a contract that trades rarely, however long ago that was", () => {
    // Sunflower Oil last traded Wednesday 18 Nov at 16:50; its cp had already been reset to the same 1,525 it traded at.
    const sunoil = closes(["2026-11-16", 1530], ["2026-11-17", 1535], ["2026-11-18", 1525], ["2026-11-19", 1525], ["2026-11-20", 1525]);
    const ref = sessionReference({ closes: sunoil, lastTradeMs: istMs("2026-11-18", "16:50"), cp: 1525 });
    assert.equal(ref, 1535);
    assert.equal(pct(1525, ref), -0.65);
  });

  it("reads the IST date of a trade, not the UTC one - 23:54 IST is 18:24 UTC the same day, 00:10 IST is the previous UTC day", () => {
    const c = closes(["2026-11-18", 100], ["2026-11-19", 110], ["2026-11-20", 120]);
    assert.equal(sessionReference({ closes: c, lastTradeMs: Date.UTC(2026, 10, 20, 18, 24), cp: null }), 110); // Fri 23:54 IST -> session 20th -> 19th's close
    assert.equal(sessionReference({ closes: c, lastTradeMs: Date.UTC(2026, 10, 20, 18, 40), cp: null }), 120); // 00:10 IST on the 21st -> session 21st -> 20th's close
  });

  it("falls back to cp when a contract has no history that far back (a new month's contract)", () => {
    assert.equal(sessionReference({ closes: closes(["2026-11-20", 7700]), lastTradeMs: istMs("2026-11-20", "23:54"), cp: 7807 }), 7807);
    assert.equal(sessionReference({ closes: [], lastTradeMs: istMs("2026-11-20", "23:54"), cp: 7807 }), 7807);
  });

  it("falls back to cp when there is no usable last trade, and to nothing when there is no cp either", () => {
    assert.equal(sessionReference({ closes: gold, lastTradeMs: null, cp: 121778 }), 121778);
    assert.equal(sessionReference({ closes: gold, lastTradeMs: 0, cp: 121778 }), 121778);
    assert.equal(sessionReference({ closes: gold, lastTradeMs: Number.NaN, cp: 121778 }), 121778);
    assert.equal(sessionReference({ closes: gold, lastTradeMs: null, cp: null }), null);
    assert.equal(sessionReference({ closes: gold, lastTradeMs: null, cp: 0 }), null);
  });
});
