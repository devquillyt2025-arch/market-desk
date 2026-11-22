import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isOnPage, morePages, NAV_PAGES, pageTitle, SECONDARY_GROUP_START, SETTINGS_PAGE, TAB_BAR } from "@/lib/navPages";

describe("which page is open", () => {
  it("matches the home page only exactly - every path starts with a slash", () => {
    assert.equal(isOnPage("/", "/"), true);
    assert.equal(isOnPage("/reports", "/"), false);
  });

  it("matches a page and its sub-pages, but not a page that merely starts with the same letters", () => {
    assert.equal(isOnPage("/reports", "/reports"), true);
    assert.equal(isOnPage("/reports/2026", "/reports"), true);
    assert.equal(isOnPage("/reports-old", "/reports"), false);
    assert.equal(isOnPage("/paper-trade", "/payment"), false);
  });
});

describe("the phone's top bar and tab bar", () => {
  it("names each page as the nav does, and an unknown one as the app", () => {
    assert.equal(pageTitle("/portfolio"), "Live Portfolio");
    assert.equal(pageTitle("/"), "Brokerage");
    assert.equal(pageTitle("/settings"), SETTINGS_PAGE.label);
    assert.equal(pageTitle("/entries"), "Trade Entries");
    assert.equal(pageTitle("/nowhere"), "MarketDesk");
  });

  it("puts four pages on the bar, each a real page, leaving the fifth slot to More", () => {
    assert.equal(TAB_BAR.length, 4);
    for (const tab of TAB_BAR) assert.ok(NAV_PAGES.some((p) => p.href === tab.href), tab.href);
  });

  it("lists everything else under More - every page is reachable, none twice", () => {
    const more = morePages().map((p) => p.href);
    const onBar = TAB_BAR.map((t) => t.href);
    assert.equal(more.length + onBar.length, NAV_PAGES.length);
    assert.equal(new Set([...more, ...onBar]).size, NAV_PAGES.length);
    assert.ok(more.includes("/entries") && more.includes("/notes") && more.includes("/"));
  });

  it("keeps Notes and Logs as the secondary group the sidebar splits off", () => {
    assert.deepEqual(NAV_PAGES.slice(SECONDARY_GROUP_START).map((p) => p.href), ["/notes", "/logs"]);
  });
});
