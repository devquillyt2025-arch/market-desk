/**
 * Pop-ups on a phone. The popup case is the real one: the date picker opened from the right-hand "Expiry date" field of the
 * Add Trade Entry form on a 390px-wide screen put a 256px calendar at x = 201..457 - 67px off the edge.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { menuAlign, popupPosition, SHEET_DISMISS_DISTANCE, SHEET_DISMISS_VELOCITY, shouldDismissSheet, visibleArea } from "@/lib/sheet";

describe("closing a sheet by swiping it down", () => {
  it("closes once it has been dragged far enough", () => {
    assert.equal(shouldDismissSheet(SHEET_DISMISS_DISTANCE + 1, 0), true);
    assert.equal(shouldDismissSheet(SHEET_DISMISS_DISTANCE, 0), false);
  });

  it("closes on a quick flick, even a short one", () => {
    assert.equal(shouldDismissSheet(60, SHEET_DISMISS_VELOCITY + 1), true);
    assert.equal(shouldDismissSheet(60, SHEET_DISMISS_VELOCITY), false);
  });

  it("springs back from a tap or a jitter, however fast", () => {
    assert.equal(shouldDismissSheet(0, 5000), false);
    assert.equal(shouldDismissSheet(10, 5000), false);
    assert.equal(shouldDismissSheet(-80, 3000), false); // dragged up
  });
});

describe("where a popup opens", () => {
  const phone = { viewportWidth: 390, viewportHeight: 844, width: 256, height: 340 };

  it("sits under its field, lined up with the left edge, when there is room", () => {
    assert.deepEqual(popupPosition({ ...phone, triggerLeft: 24, triggerTop: 300, triggerBottom: 344 }), { left: 24, top: 348 });
  });

  it("is pulled in from the right edge - the calendar that hung off a 390px screen", () => {
    const p = popupPosition({ ...phone, triggerLeft: 201, triggerTop: 300, triggerBottom: 344 });
    assert.equal(p.left, 390 - 256 - 8);
    assert.ok(p.left + 256 <= 390 - 8);
  });

  it("flips above the field when the room below isn't enough", () => {
    const p = popupPosition({ ...phone, triggerLeft: 24, triggerTop: 700, triggerBottom: 744 });
    assert.equal(p.top, 700 - 4 - 340);
  });

  it("stays on screen when neither side has room, taking the roomier one", () => {
    const tall = { ...phone, height: 600, viewportHeight: 700 };
    const p = popupPosition({ ...tall, triggerLeft: 24, triggerTop: 350, triggerBottom: 394 });
    assert.ok(p.top >= 8 && p.top + 600 <= 700 - 8);
  });

  it("keeps a popup wider than the screen at the margin, not off to the left", () => {
    assert.equal(popupPosition({ ...phone, width: 500, triggerLeft: 100, triggerTop: 100, triggerBottom: 140 }).left, 8);
  });
});

describe("what is left of the screen once the keyboard is up", () => {
  it("is nothing to adjust while the visual and layout viewports agree", () => {
    assert.equal(visibleArea({ height: 844, offsetTop: 0 }, 844), null);
    assert.equal(visibleArea(null, 844), null);
  });

  it("ignores a viewport that reports no height - that is not a keyboard", () => {
    assert.equal(visibleArea({ height: 0, offsetTop: 0 }, 844), null);
    assert.equal(visibleArea({ height: Number.NaN, offsetTop: 0 }, 844), null);
    assert.equal(visibleArea({ height: -5, offsetTop: 0 }, 844), null);
  });

  it("is the part above the keyboard", () => {
    assert.deepEqual(visibleArea({ height: 508.4, offsetTop: 0 }, 844), { top: 0, height: 508 });
  });

  it("follows the page when the browser has scrolled the visual viewport down", () => {
    assert.deepEqual(visibleArea({ height: 508, offsetTop: 120.6 }, 844), { top: 121, height: 508 });
  });
});

describe("which edge a dropdown menu hangs from", () => {
  const screen = 390;

  it("keeps the usual right-aligned menu under a button at the right of the screen", () => {
    assert.equal(menuAlign({ triggerLeft: 300, triggerRight: 374, menuWidth: 288, viewportWidth: screen }), "right");
  });

  it("hangs from the left edge when the button is at the left - the Export menu that opened 157px off the screen", () => {
    // The Export button on the Portfolio page of a 390px phone: x = 16..131, menu 288px wide.
    assert.equal(menuAlign({ triggerLeft: 16, triggerRight: 131, menuWidth: 288, viewportWidth: screen }), "left");
    assert.equal(menuAlign({ triggerLeft: 16, triggerRight: 110, menuWidth: 224, viewportWidth: screen }), "left"); // the Analysis Import menu
  });

  it("keeps a menu on screen on a wide window, wherever the button is", () => {
    assert.equal(menuAlign({ triggerLeft: 24, triggerRight: 120, menuWidth: 288, viewportWidth: 1280 }), "left");
    assert.equal(menuAlign({ triggerLeft: 1100, triggerRight: 1200, menuWidth: 288, viewportWidth: 1280 }), "right");
  });

  it("takes the side with more room when the menu fits on neither", () => {
    assert.equal(menuAlign({ triggerLeft: 120, triggerRight: 220, menuWidth: 340, viewportWidth: 390 }), "left"); // 170px free on the right, 120 on the left
    assert.equal(menuAlign({ triggerLeft: 160, triggerRight: 260, menuWidth: 340, viewportWidth: 390 }), "right");
  });
});
