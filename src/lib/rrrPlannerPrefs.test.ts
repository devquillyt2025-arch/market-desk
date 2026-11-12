import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_PLANNER_PREFS, parsePlannerPrefs } from "@/lib/rrrPlannerPrefs";

describe("parsePlannerPrefs", () => {
  it("reads back what was saved", () => {
    const saved = { instrument: "BANKNIFTY", days: 10, intraday: true, intradayLeft: 0.56, window: 20, manualAnnualPct: 18.5, customStopPct: 2.5 };
    assert.deepEqual(parsePlannerPrefs(JSON.parse(JSON.stringify(saved))), saved);
  });

  it("falls back to the defaults for nothing, or for something that isn't prefs", () => {
    for (const raw of [null, undefined, "x", 7, []]) assert.deepEqual(parsePlannerPrefs(raw), DEFAULT_PLANNER_PREFS);
  });

  it("repairs one bad field without throwing away the others", () => {
    const p = parsePlannerPrefs({ instrument: "DOGE", days: 10, window: 7, manualAnnualPct: "18", customStopPct: 2 });
    assert.equal(p.instrument, DEFAULT_PLANNER_PREFS.instrument); // not an index this app trades
    assert.equal(p.days, 10);
    assert.equal(p.window, DEFAULT_PLANNER_PREFS.window); // not one of the look-backs on offer
    assert.equal(p.manualAnnualPct, null); // a string
    assert.equal(p.customStopPct, 2);
  });

  it("only accepts holding periods the planner offers", () => {
    assert.equal(parsePlannerPrefs({ days: 4 }).days, DEFAULT_PLANNER_PREFS.days);
    assert.equal(parsePlannerPrefs({ days: 20 }).days, 20);
  });

  it("only accepts an intraday flag that is true, and a start time the planner offers", () => {
    assert.equal(parsePlannerPrefs({ intraday: "yes" }).intraday, false);
    assert.equal(parsePlannerPrefs({ intraday: 1 }).intraday, false);
    assert.equal(parsePlannerPrefs({ intraday: true }).intraday, true);
    assert.equal(parsePlannerPrefs({ intradayLeft: 0.5 }).intradayLeft, DEFAULT_PLANNER_PREFS.intradayLeft);
    assert.equal(parsePlannerPrefs({ intradayLeft: 0.32 }).intradayLeft, 0.32);
  });

  it("drops a volatility or stop that is out of any sensible range instead of using it", () => {
    for (const bad of [0, -3, 500, NaN]) assert.equal(parsePlannerPrefs({ manualAnnualPct: bad }).manualAnnualPct, null);
    for (const bad of [0, -1, 80, NaN]) assert.equal(parsePlannerPrefs({ customStopPct: bad }).customStopPct, null);
  });
});
