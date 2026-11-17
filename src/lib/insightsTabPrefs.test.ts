/**
 * Which of Live Portfolio's insight tabs are shown. Only the What-if lab and the RRR planner can be switched off;
 * the other three are always there, and the strip is never left empty.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_INSIGHTS_TAB_PREFS,
  isInsightsTabShown,
  parseInsightsTabPrefs,
  serializeInsightsTabPrefs,
} from "@/lib/insightsTabPrefs";

const ALL = ["risk", "simulate", "whatif", "planner", "rrr"];
const shown = (hasPositions: boolean, prefs: { whatif: boolean; planner: boolean }) =>
  ALL.filter((id) => isInsightsTabShown(id, hasPositions, prefs));

describe("which insight tabs show", () => {
  it("shows all five by default", () => {
    assert.deepEqual(shown(true, DEFAULT_INSIGHTS_TAB_PREFS), ALL);
  });

  it("drops the What-if lab, or the RRR planner, or both - and only those", () => {
    assert.deepEqual(shown(true, { whatif: false, planner: true }), ["risk", "simulate", "planner", "rrr"]);
    assert.deepEqual(shown(true, { whatif: true, planner: false }), ["risk", "simulate", "whatif", "rrr"]);
    assert.deepEqual(shown(true, { whatif: false, planner: false }), ["risk", "simulate", "rrr"]);
  });

  it("offers only the planner while nothing is priced, whatever was chosen - the strip is never empty", () => {
    assert.deepEqual(shown(false, DEFAULT_INSIGHTS_TAB_PREFS), ["planner"]);
    assert.deepEqual(shown(false, { whatif: false, planner: false }), ["planner"]);
  });
});

describe("the saved choice", () => {
  it("reads back what was written", () => {
    for (const prefs of [
      { whatif: true, planner: true },
      { whatif: false, planner: true },
      { whatif: true, planner: false },
      { whatif: false, planner: false },
    ]) {
      assert.deepEqual(parseInsightsTabPrefs(serializeInsightsTabPrefs(prefs)), prefs);
    }
  });

  it("keeps every tab on when nothing, or nothing usable, was saved", () => {
    for (const raw of [null, undefined, "", "not json", "null", "5", '"x"', "[]", "{}"]) {
      assert.deepEqual(parseInsightsTabPrefs(raw), DEFAULT_INSIGHTS_TAB_PREFS, `for ${String(raw)}`);
    }
  });

  it("only hides a tab on an explicit false - a half-written or odd value leaves it on", () => {
    assert.deepEqual(parseInsightsTabPrefs('{"whatif":false}'), { whatif: false, planner: true });
    assert.deepEqual(parseInsightsTabPrefs('{"planner":false}'), { whatif: true, planner: false });
    assert.deepEqual(parseInsightsTabPrefs('{"whatif":0,"planner":"no"}'), DEFAULT_INSIGHTS_TAB_PREFS);
  });

  it("has no say over the three tabs that are always shown", () => {
    const parsed = parseInsightsTabPrefs('{"risk":false,"simulate":false,"rrr":false,"whatif":true,"planner":true}');
    assert.deepEqual(Object.keys(parsed).sort(), ["planner", "whatif"]);
    assert.deepEqual(shown(true, parsed), ALL);
  });
});
