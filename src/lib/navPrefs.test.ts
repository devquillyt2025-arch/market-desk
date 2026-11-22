import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NAV_PAGES, SETTINGS_PAGE, TAB_BAR } from "@/lib/navPages";
import {
  defaultNavPrefs,
  DESKTOP_NAV_ORDER,
  dividerBefore,
  isDefaultNavPrefs,
  morePagesFor,
  moveNavPage,
  parseNavPrefs,
  PHONE_NAV_ORDER,
  serializeNavPrefs,
  shownPages,
  tabBarPages,
  toggleNavPage,
  type NavPrefs,
} from "@/lib/navPrefs";

const hrefs = (pages: readonly { href: string }[]) => pages.map((p) => p.href);
const ALL = NAV_PAGES.map((p) => p.href);

describe("reading the saved choice", () => {
  it("is null when nothing was saved or it can't be read - the app's own nav", () => {
    assert.equal(parseNavPrefs(null), null);
    assert.equal(parseNavPrefs(undefined), null);
    assert.equal(parseNavPrefs(""), null);
    assert.equal(parseNavPrefs("not json"), null);
    assert.equal(parseNavPrefs("42"), null);
    assert.equal(parseNavPrefs("null"), null);
  });

  it("round-trips a choice", () => {
    const prefs: NavPrefs = { order: [...ALL].reverse(), hidden: ["/payment", "/logs"] };
    assert.deepEqual(parseNavPrefs(serializeNavPrefs(prefs)), prefs);
  });

  it("drops paths the app doesn't have and repeats", () => {
    const parsed = parseNavPrefs(JSON.stringify({ order: ["/reports", "/gone", "/reports", "/heatmap"], hidden: ["/gone", "/logs", "/logs", 7] }));
    assert.deepEqual(parsed?.order.slice(0, 2), ["/reports", "/heatmap"]);
    assert.deepEqual(parsed?.hidden, ["/logs"]);
    assert.equal(new Set(parsed?.order).size, parsed?.order.length);
  });

  it("puts a page the app gained since the choice was saved at the end - it never goes missing", () => {
    const parsed = parseNavPrefs(JSON.stringify({ order: ["/reports", "/heatmap"], hidden: [] }));
    assert.equal(parsed?.order.length, ALL.length);
    assert.deepEqual(parsed?.order.slice(0, 2), ["/reports", "/heatmap"]);
    assert.ok(parsed?.order.includes("/commodities"));
  });

  it("keeps the hidden list when the order is damaged, and falls back to the default order", () => {
    const parsed = parseNavPrefs(JSON.stringify({ order: "oops", hidden: ["/notes"] }));
    assert.deepEqual(parsed?.order, ALL);
    assert.deepEqual(parsed?.hidden, ["/notes"]);
  });
});

describe("which pages are shown", () => {
  it("is every page, in the app's order, until the device chooses", () => {
    assert.deepEqual(hrefs(shownPages(null)), ALL);
  });

  it("follows the saved order and leaves hidden pages out", () => {
    const prefs: NavPrefs = { order: ["/reports", "/heatmap", "/portfolio", ...ALL.filter((h) => !["/reports", "/heatmap", "/portfolio"].includes(h))], hidden: ["/heatmap", "/logs"] };
    const shown = hrefs(shownPages(prefs));
    assert.deepEqual(shown.slice(0, 2), ["/reports", "/portfolio"]);
    assert.ok(!shown.includes("/heatmap") && !shown.includes("/logs"));
    assert.equal(shown.length, ALL.length - 2);
  });

  it("can be empty - Settings is pinned apart, so the list can always be edited again", () => {
    const prefs: NavPrefs = { order: ALL, hidden: ALL };
    assert.deepEqual(shownPages(prefs), []);
    assert.ok(!ALL.includes(SETTINGS_PAGE.href));
  });
});

describe("editing the list", () => {
  const start = defaultNavPrefs(false);

  it("hides a page and brings it back to the place it had", () => {
    const hidden = toggleNavPage(start, "/analysis");
    assert.ok(!hrefs(shownPages(hidden)).includes("/analysis"));
    const back = toggleNavPage(hidden, "/analysis");
    assert.deepEqual(hrefs(shownPages(back)), ALL);
  });

  it("ignores a path that isn't a page", () => {
    assert.equal(toggleNavPage(start, "/nowhere"), start);
    assert.equal(moveNavPage(start, "/nowhere", 0), start);
  });

  it("moves a page and keeps the rest in order", () => {
    const moved = moveNavPage(start, "/reports", 0);
    assert.equal(moved.order[0], "/reports");
    assert.deepEqual(moved.order.slice(1), ALL.filter((h) => h !== "/reports"));
    const down = moveNavPage(start, "/commodities", 2);
    assert.deepEqual(down.order.slice(0, 3), ["/portfolio", "/watchlist", "/commodities"]);
  });

  it("clamps a move past either end, and a move to where it is changes nothing", () => {
    assert.equal(moveNavPage(start, "/commodities", -5), start);
    assert.equal(moveNavPage(start, "/commodities", 0), start);
    assert.equal(moveNavPage(start, "/logs", 99), start);
    assert.equal(moveNavPage(start, "/commodities", 99).order.at(-1), "/commodities");
  });

  it("moving a hidden page keeps it hidden", () => {
    const prefs = moveNavPage(toggleNavPage(start, "/logs"), "/logs", 0);
    assert.equal(prefs.order[0], "/logs");
    assert.ok(!hrefs(shownPages(prefs)).includes("/logs"));
  });
});

describe("the default, and Reset", () => {
  it("lists every page exactly once in both default orders", () => {
    assert.deepEqual(DESKTOP_NAV_ORDER, ALL);
    assert.equal(PHONE_NAV_ORDER.length, ALL.length);
    assert.equal(new Set(PHONE_NAV_ORDER).size, ALL.length);
  });

  it("starts a phone from the bar it already has, so the first edit changes nothing by itself", () => {
    assert.deepEqual(PHONE_NAV_ORDER.slice(0, 4), TAB_BAR.map((t) => t.href));
    assert.deepEqual(hrefs(tabBarPages(defaultNavPrefs(true))), hrefs(TAB_BAR));
    assert.deepEqual(hrefs(tabBarPages(null)), hrefs(TAB_BAR));
  });

  it("calls only the untouched choices default", () => {
    assert.equal(isDefaultNavPrefs(null), true);
    assert.equal(isDefaultNavPrefs(defaultNavPrefs(false)), true);
    assert.equal(isDefaultNavPrefs(defaultNavPrefs(true)), true);
    assert.equal(isDefaultNavPrefs(toggleNavPage(defaultNavPrefs(false), "/notes")), false);
    assert.equal(isDefaultNavPrefs(moveNavPage(defaultNavPrefs(false), "/logs", 0)), false);
  });
});

describe("the phone's bar and More", () => {
  it("makes the first four shown pages the bar, with the short names the slots need", () => {
    const prefs: NavPrefs = { order: ["/links", "/entries", "/paper-trade", "/portfolio", ...ALL.filter((h) => !["/links", "/entries", "/paper-trade", "/portfolio"].includes(h))], hidden: [] };
    assert.deepEqual(tabBarPages(prefs).map((t) => t.label), ["Links", "Entries", "Paper", "Portfolio"]);
  });

  it("skips a hidden page rather than leaving a gap", () => {
    const prefs = toggleNavPage(defaultNavPrefs(true), "/portfolio");
    assert.deepEqual(hrefs(tabBarPages(prefs)), ["/watchlist", "/heatmap", "/reports", "/commodities"]);
  });

  it("lists on More everything shown that is not on the bar - every shown page once, hidden ones nowhere", () => {
    const prefs = toggleNavPage(defaultNavPrefs(true), "/notes");
    const bar = hrefs(tabBarPages(prefs));
    const more = hrefs(morePagesFor(prefs));
    assert.equal(bar.length + more.length, ALL.length - 1);
    assert.equal(new Set([...bar, ...more]).size, bar.length + more.length);
    assert.ok(!more.includes("/notes") && !bar.includes("/notes"));
  });

  it("is the old More list until the device chooses", () => {
    assert.deepEqual(hrefs(morePagesFor(null)), ALL.filter((h) => !TAB_BAR.some((t) => t.href === h)));
  });

  it("holds fewer than four when fewer are shown, and More is then empty", () => {
    const prefs: NavPrefs = { order: ALL, hidden: ALL.filter((h) => h !== "/reports" && h !== "/watchlist") };
    assert.deepEqual(hrefs(tabBarPages(prefs)), ["/watchlist", "/reports"]);
    assert.deepEqual(morePagesFor(prefs), []);
  });
});

describe("the sidebar's dividers", () => {
  const dividers = (pages: readonly { href: string }[]) => pages.flatMap((p, i) => (dividerBefore(pages as never, i) ? [p.href] : []));

  it("is one, above Notes, in the app's own order", () => {
    assert.deepEqual(dividers(shownPages(null)), ["/notes"]);
  });

  it("follows Notes and Logs wherever they are put", () => {
    const front = moveNavPage(moveNavPage(defaultNavPrefs(false), "/logs", 0), "/notes", 0);
    assert.deepEqual(dividers(shownPages(front)), ["/commodities"]);
  });

  it("has none when only one group is left, or the list is empty", () => {
    const onlyMain = { order: ALL, hidden: ["/notes", "/logs"] };
    assert.deepEqual(dividers(shownPages(onlyMain)), []);
    const onlySecondary = { order: ALL, hidden: ALL.filter((h) => h !== "/notes" && h !== "/logs") };
    assert.deepEqual(dividers(shownPages(onlySecondary)), []);
    assert.equal(dividerBefore([], 0), false);
  });
});
