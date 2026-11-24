/** What the planner remembers: anything unreadable or out of range falls back to the default, and a contract is only ever an Upstox key. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_PREFS, parsePrefs } from "@/app/commodities/usePlannerPrefs";

describe("parsePrefs", () => {
  it("is the defaults for nothing, junk or a non-object - and opens on the default contract", () => {
    for (const raw of [null, "", "not json", "42", "[]", "null"]) assert.deepEqual(parsePrefs(raw), DEFAULT_PREFS, String(raw));
    assert.equal(DEFAULT_PREFS.contract, "default");
  });

  it("keeps a contract that is an Upstox key, 'auto' or 'default'", () => {
    assert.equal(parsePrefs(JSON.stringify({ contract: "MCX_FO|578249" })).contract, "MCX_FO|578249");
    assert.equal(parsePrefs(JSON.stringify({ contract: "auto" })).contract, "auto");
    assert.equal(parsePrefs(JSON.stringify({ contract: "default" })).contract, "default");
  });

  it("refuses a contract that is anything else", () => {
    for (const bad of ["dec", "MCX_FO|", "MCX_FO|abc", "NSE_FO|123", "MCX_FO|123; drop table", 5, null, {}]) {
      assert.equal(parsePrefs(JSON.stringify({ contract: bad })).contract, "default", JSON.stringify(bad));
    }
  });

  it("reads each field on its own, so one bad value does not lose the rest", () => {
    assert.deepEqual(parsePrefs(JSON.stringify({ contract: "MCX_FO|581135", tf: 15 })), { contract: "MCX_FO|581135", tf: 15 });
    const mixed = parsePrefs(JSON.stringify({ contract: "MCX_FO|581135", tf: 7 }));
    assert.equal(mixed.contract, "MCX_FO|581135");
    assert.equal(mixed.tf, DEFAULT_PREFS.tf);
    assert.equal(parsePrefs(JSON.stringify({ contract: "dec", tf: 60 })).tf, 60);
  });

  it("ignores the settings of the old plan card that older saves still carry", () => {
    const old = parsePrefs(JSON.stringify({ contract: "auto", tf: 10, side: "short", ratio: 3, atrMult: 2, stopMode: "pct", stopValue: 0.75, riskBudget: 20000 }));
    assert.deepEqual(old, { contract: "auto", tf: 10 });
  });
});
