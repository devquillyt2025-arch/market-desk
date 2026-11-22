/**
 * Which pages a device's navigation shows, and in what order - pure, no React. The sidebar lists them top to bottom; on a phone the
 * first four are the bottom bar and the rest sit under "More". The choice is a per-device convenience, kept in localStorage like the
 * ticker list and the insight-tab switches; it never goes to Supabase, so there is nothing to migrate.
 *
 * A page is only ever hidden from the nav: it still opens from a link or the address bar. Settings is never in the list - it is
 * always there - so the list can always be edited again.
 *
 * `null` means "never customised": the nav is the app's own (navPages.ts), which on a phone keeps the four tabs it has always had.
 */

import {
  isSecondaryPage,
  NAV_PAGES,
  navPage,
  TAB_BAR,
  TAB_BAR_SLOTS,
  tabBarPage,
  type NavPage,
} from "@/lib/navPages";

export type NavPrefs = {
  /** Every page, in the order the device wants them (hidden ones keep their place, for when they come back). */
  order: readonly string[];
  /** The paths switched off. */
  hidden: readonly string[];
};

const ALL: readonly string[] = NAV_PAGES.map((page) => page.href);
const KNOWN = new Set(ALL);
const ON_BAR = new Set(TAB_BAR.map((tab) => tab.href));

/** The sidebar's default order. */
export const DESKTOP_NAV_ORDER: readonly string[] = ALL;
/** A phone's default: the four bar tabs first (so a first edit starts from what the bar already shows), then More in its usual order. */
export const PHONE_NAV_ORDER: readonly string[] = [...TAB_BAR.map((tab) => tab.href), ...ALL.filter((href) => !ON_BAR.has(href))];

/** What the editor starts from on a device that has chosen nothing yet. */
export function defaultNavPrefs(phone: boolean): NavPrefs {
  return { order: phone ? PHONE_NAV_ORDER : DESKTOP_NAV_ORDER, hidden: [] };
}

/**
 * Reads what was saved; null when there is nothing usable (never customised, or unreadable). Paths this version doesn't know and
 * repeats are dropped, and a page the app gained since the choice was saved joins at the end - a new tab never goes missing.
 */
export function parseNavPrefs(raw: string | null | undefined): NavPrefs | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { order, hidden } = value as Record<string, unknown>;
    const known = (list: unknown): string[] =>
      Array.isArray(list) ? [...new Set(list.filter((href): href is string => typeof href === "string" && KNOWN.has(href)))] : [];
    const saved = known(order);
    return { order: [...saved, ...ALL.filter((href) => !saved.includes(href))], hidden: known(hidden) };
  } catch {
    return null;
  }
}

export function serializeNavPrefs(prefs: NavPrefs): string {
  return JSON.stringify({ order: prefs.order, hidden: prefs.hidden });
}

/** The pages the nav shows, in order. */
export function shownPages(prefs: NavPrefs | null): NavPage[] {
  if (!prefs) return [...NAV_PAGES];
  const hidden = new Set(prefs.hidden);
  return prefs.order.filter((href) => !hidden.has(href)).flatMap((href) => navPage(href) ?? []);
}

/** Shows a hidden page or hides a shown one. A path that isn't in the nav changes nothing. */
export function toggleNavPage(prefs: NavPrefs, href: string): NavPrefs {
  if (!KNOWN.has(href)) return prefs;
  return { ...prefs, hidden: prefs.hidden.includes(href) ? prefs.hidden.filter((h) => h !== href) : [...prefs.hidden, href] };
}

/** Moves a page to `toIndex` (clamped to the list), the others keeping their order. */
export function moveNavPage(prefs: NavPrefs, href: string, toIndex: number): NavPrefs {
  const from = prefs.order.indexOf(href);
  if (from === -1) return prefs;
  const to = Math.min(prefs.order.length - 1, Math.max(0, toIndex));
  if (to === from) return prefs;
  const order = [...prefs.order];
  order.splice(from, 1);
  order.splice(to, 0, href);
  return { ...prefs, order };
}

/** Whether the device is on the app's own nav - the editor's Reset has nothing to do then. */
export function isDefaultNavPrefs(prefs: NavPrefs | null): boolean {
  if (!prefs) return true;
  const same = (order: readonly string[]) => order.length === prefs.order.length && order.every((href, i) => href === prefs.order[i]);
  return prefs.hidden.length === 0 && (same(DESKTOP_NAV_ORDER) || same(PHONE_NAV_ORDER));
}

/** The phone's bottom bar: its usual four until the device chooses, then the first four pages shown (fewer if fewer are). */
export function tabBarPages(prefs: NavPrefs | null): NavPage[] {
  if (!prefs) return [...TAB_BAR];
  return shownPages(prefs).slice(0, TAB_BAR_SLOTS).map(tabBarPage);
}

/** What "More" lists: every page shown that isn't on the bar (Settings is added by the sheet itself). */
export function morePagesFor(prefs: NavPrefs | null): NavPage[] {
  const onBar = new Set(tabBarPages(prefs).map((tab) => tab.href));
  return shownPages(prefs).filter((page) => !onBar.has(page.href));
}

/** Whether the sidebar draws a divider above `pages[index]`: wherever the list passes between Notes/Logs and the rest. */
export function dividerBefore(pages: readonly NavPage[], index: number): boolean {
  return index > 0 && isSecondaryPage(pages[index].href) !== isSecondaryPage(pages[index - 1].href);
}
