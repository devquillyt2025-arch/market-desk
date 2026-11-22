import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { lockScroll } from "@/lib/scrollLock";

const el = (overflow = "") => ({ style: { overflow } });

describe("holding the page still behind a pop-up", () => {
  it("stops what scrolls, and puts back exactly what was there", () => {
    const html = el();
    const main = el("auto");
    const release = lockScroll(() => [html, main]);
    assert.equal(html.style.overflow, "hidden");
    assert.equal(main.style.overflow, "hidden");
    release();
    assert.equal(html.style.overflow, "");
    assert.equal(main.style.overflow, "auto");
  });

  it("stays held until the last of two pop-ups closes - a confirmation over an editor", () => {
    const page = el();
    const first = lockScroll(() => [page]);
    const second = lockScroll(() => [page]);
    first();
    assert.equal(page.style.overflow, "hidden");
    second();
    assert.equal(page.style.overflow, "");
  });

  it("releases only once per lock, however often it is called", () => {
    const page = el();
    const a = lockScroll(() => [page]);
    const b = lockScroll(() => [page]);
    a();
    a();
    a();
    assert.equal(page.style.overflow, "hidden"); // b still holds it
    b();
    assert.equal(page.style.overflow, "");
  });

  it("can be taken again after a full release", () => {
    const page = el("scroll");
    lockScroll(() => [page])();
    const again = lockScroll(() => [page]);
    assert.equal(page.style.overflow, "hidden");
    again();
    assert.equal(page.style.overflow, "scroll");
  });
});
