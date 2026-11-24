/** How the planner says how long ago something was. */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { agoText } from "@/app/commodities/plannerFormat";

describe("agoText", () => {
  it("says just now for the first moment, then counts seconds", () => {
    assert.equal(agoText(0), "just now");
    assert.equal(agoText(1999), "just now");
    assert.equal(agoText(2000), "2 sec ago");
    assert.equal(agoText(7400), "7 sec ago");
    assert.equal(agoText(59_999), "59 sec ago");
  });

  it("moves to minutes at a minute, and to hours and minutes at an hour", () => {
    assert.equal(agoText(60_000), "1 min ago");
    assert.equal(agoText(119_000), "1 min ago");
    assert.equal(agoText(5 * 60_000 + 20_000), "5 min ago");
    assert.equal(agoText(3_600_000), "1h 00m ago");
    assert.equal(agoText(2 * 3_600_000 + 5 * 60_000), "2h 05m ago");
  });

  it("never goes negative when the clock is a moment behind", () => {
    assert.equal(agoText(-5000), "just now");
  });
});
