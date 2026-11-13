/**
 * The Analysis tab with an MCX commodity: importing a position into it, saving the strategy, and the timing that
 * differs from the indices (an MCX option runs to 23:30 on its expiry day, not 15:30). The fixture is the real
 * natural gas position: long 2 lots of NATURALGAS 330 PE, 20 Nov 2026 expiry, bought at 29.
 */

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { defaultExpiryFor, expiryCloseMs, firstLiveExpiry, priceLegs, targetMomentMs, type StrategyLeg } from "@/lib/calculateStrategy";
import { loadSavedAnalysis, saveAnalysis } from "@/lib/savedAnalysis";
import { buildStrategyExport, parseStrategyImport, tradeEntryToLeg } from "@/lib/strategyTransfer";
import type { TradeEntry } from "@/lib/types";

function entry(over: Partial<TradeEntry>): TradeEntry {
  return {
    id: "r1",
    user_id: null,
    entry_date: "2026-11-13",
    instrument: "NATURALGAS",
    strike_price: 330,
    option_type: "PE",
    expiry_date: "2026-11-20",
    closing_date: null,
    lots: 2,
    side: "buy",
    buy_price: 29,
    sell_price: 29,
    pnl: 0,
    status: "hold",
    remarks: null,
    created_at: "2026-11-13T12:00:00Z",
    updated_at: "2026-11-13T12:00:00Z",
    ...over,
  };
}

describe("importing a natural gas position into Analysis", () => {
  it("turns the open row into a leg, at its entry price or left blank for the live one", () => {
    assert.deepEqual(tradeEntryToLeg(entry({}), "entry"), {
      enabled: true,
      side: "buy",
      type: "PE",
      strike: 330,
      expiry: "2026-11-20",
      lots: 2,
      price: "29",
    });
    assert.equal(tradeEntryToLeg(entry({}), "live")?.price, "");
  });

  it("leaves a squared-off row out", () => {
    assert.equal(tradeEntryToLeg(entry({ status: "squared_off", closing_date: "2026-11-16" }), "entry"), null);
  });

  it("takes a trade-entries export of mixed underlyings and keeps the one with the most open legs", () => {
    const nifty = entry({ id: "n1", instrument: "NIFTY", strike_price: 25400, expiry_date: "2026-11-23", lots: 1 });
    const parsed = parseStrategyImport([nifty, entry({ id: "g1" }), entry({ id: "g2", strike_price: 320, option_type: "CE" })]);
    assert.equal(parsed.instrument, "NATURALGAS");
    assert.equal(parsed.legs.length, 2);
    assert.equal(parsed.skipped, 1); // the Nifty leg, a different underlying
  });

  it("reads back a strategy file it wrote for natural gas", () => {
    const leg = { id: "a", enabled: true, side: "buy" as const, type: "PE" as const, strike: 330, expiry: "2026-11-20", lots: 2, price: "29" };
    const parsed = parseStrategyImport(JSON.parse(JSON.stringify(buildStrategyExport("NATURALGAS", [leg]))));
    assert.equal(parsed.instrument, "NATURALGAS");
    assert.deepEqual(parsed.legs, [{ enabled: true, side: "buy", type: "PE", strike: 330, expiry: "2026-11-20", lots: 2, price: "29" }]);
  });

  it("still refuses a file for an underlying the app doesn't track", () => {
    assert.throws(
      () => parseStrategyImport({ format: "marketdesk-strategy", version: 1, instrument: "SILVER", legs: [] }),
      /crude oil, gold or natural gas/,
    );
  });
});

describe("the saved strategy", () => {
  const realStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  function stubStorage(initial?: string) {
    const store = new Map<string, string>(initial === undefined ? [] : [["marketdesk:analysis", initial]]);
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    });
  }
  afterEach(() => {
    if (realStorage) Object.defineProperty(globalThis, "localStorage", realStorage);
    else delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("survives a reload for a commodity", () => {
    stubStorage();
    const legs = [{ id: "a", enabled: true, side: "buy" as const, type: "PE" as const, strike: 330, expiry: "2026-11-20", lots: 2, price: "29" }];
    saveAnalysis({ instrument: "NATURALGAS", legs, spotOverride: "" });
    assert.deepEqual(loadSavedAnalysis(), { instrument: "NATURALGAS", legs, spotOverride: "" });
  });

  it("treats an underlying the app doesn't track as nothing saved", () => {
    stubStorage(JSON.stringify({ instrument: "SILVER", legs: [], spotOverride: "" }));
    assert.equal(loadSavedAnalysis(), null);
  });
});

describe("MCX timing in Analysis", () => {
  const at = (iso: string) => Date.parse(iso);

  it("moves the date slider's in-between days to the commodity's own 23:30 close", () => {
    const now = at("2026-11-13T12:00:00+05:30");
    const expiryMs = expiryCloseMs("2026-11-20", "NATURALGAS");
    assert.equal(targetMomentMs(3, 7, now, expiryMs, "NATURALGAS"), at("2026-11-16T23:30:00+05:30"));
    assert.equal(targetMomentMs(3, 7, now, expiryMs), at("2026-11-16T15:30:00+05:30")); // the indices' close
    assert.equal(targetMomentMs(0, 7, now, expiryMs, "NATURALGAS"), now);
    assert.equal(targetMomentMs(7, 7, now, expiryMs, "NATURALGAS"), expiryMs);
  });

  it("picks the first listed expiry that hasn't run out - an MCX one is still live in the evening of its day", () => {
    const listed = ["2026-11-20", "2026-12-23", "2027-01-21"];
    assert.equal(firstLiveExpiry(listed, "NATURALGAS", at("2026-11-13T12:00:00+05:30")), "2026-11-20");
    assert.equal(firstLiveExpiry(listed, "NATURALGAS", at("2026-11-20T20:00:00+05:30")), "2026-11-20");
    assert.equal(firstLiveExpiry(listed, "NATURALGAS", at("2026-11-20T23:45:00+05:30")), "2026-12-23");
    assert.equal(firstLiveExpiry(listed, "NATURALGAS", at("2027-02-01T12:00:00+05:30")), undefined);
    assert.equal(firstLiveExpiry([], "NATURALGAS", at("2026-11-13T12:00:00+05:30")), undefined); // list not loaded yet
  });

  // The real lists Upstox gave on 13 Nov 2026 (a Friday): Bank Nifty lists monthlies only.
  const BANKNIFTY_LISTED = ["2026-11-23", "2026-12-29", "2027-01-25"];
  const NIFTY_LISTED = ["2026-11-17", "2026-11-23", "2026-12-01"];

  it("starts Bank Nifty on its real monthly expiry, not the weekly Tuesday it doesn't list - which left the tab with no spot", () => {
    const now = at("2026-11-13T12:00:00+05:30");
    assert.equal(defaultExpiryFor("BANKNIFTY", BANKNIFTY_LISTED, "2026-11-13", now), "2026-11-23");
    // Before the list arrives, or if it never does, the old weekly guess is still better than nothing.
    assert.equal(defaultExpiryFor("BANKNIFTY", undefined, "2026-11-13", now), "2026-11-17");
    assert.equal(defaultExpiryFor("BANKNIFTY", [], "2026-11-13", now), "2026-11-17");
  });

  it("starts Nifty and Sensex on the nearest listed expiry, which is the weekly one when they list it", () => {
    const now = at("2026-11-13T12:00:00+05:30");
    assert.equal(defaultExpiryFor("NIFTY", NIFTY_LISTED, "2026-11-13", now), "2026-11-17");
    assert.equal(defaultExpiryFor("SENSEX", ["2026-11-19", "2026-11-26"], "2026-11-13", now), "2026-11-19");
    // Past the 15:30 close on the expiry day, the next listed one takes over.
    assert.equal(defaultExpiryFor("NIFTY", NIFTY_LISTED, "2026-11-17", at("2026-11-17T16:00:00+05:30")), "2026-11-23");
  });

  it("gives a commodity no default until its list is known - there is no weekly pattern to guess from", () => {
    const now = at("2026-11-13T12:00:00+05:30");
    assert.equal(defaultExpiryFor("NATURALGAS", undefined, "2026-11-13", now), undefined);
    assert.equal(defaultExpiryFor("NATURALGAS", ["2026-11-20", "2026-12-23"], "2026-11-13", now), "2026-11-20");
    assert.equal(defaultExpiryFor("NATURALGAS", ["2026-11-20", "2026-12-23"], "2026-11-20", at("2026-11-20T20:00:00+05:30")), "2026-11-20");
  });

  it("values the leg to 23:30 on its expiry day when it is told the instrument, so there is time value at 20:00", () => {
    const leg: StrategyLeg = { id: "a", enabled: true, side: "buy", type: "PE", strike: 330, expiry: "2026-11-20", lots: 2, price: 29, chainIv: 77 };
    const evening = at("2026-11-20T20:00:00+05:30");
    const [mcx] = priceLegs([leg], 308, evening, 1250, "NATURALGAS");
    assert.equal(mcx.closeMs, at("2026-11-20T23:30:00+05:30"));
    assert.equal(mcx.qty, 2500);
    // Without the instrument it would be treated as expired at 15:30 - no time left at all.
    const [asIndex] = priceLegs([leg], 308, evening, 1250);
    assert.equal(asIndex.closeMs, at("2026-11-20T15:30:00+05:30"));
  });
});
