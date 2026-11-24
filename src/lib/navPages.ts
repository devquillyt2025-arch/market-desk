/**
 * The app's pages, in one place (no icons, so it is plain logic): the desktop sidebar lists them and the phone's tab bar shows the
 * first few and puts the rest under "More". This is the *default* list and order - navPrefs.ts lets each device hide pages and
 * reorder them. The Dashboard heads the sidebar; Live Portfolio, Watchlist, Heatmap and Important Links come next - the tabs checked most often through the day -
 * followed by the workflow tabs (Brokerage, Paper Trade, Analysis, Trade Entries, Reports, Payment). Notes and Logs are reference
 * utilities, so they sit in their own group after a divider (SECONDARY_GROUP_START).
 */

export type NavPage = {
  href: string;
  label: string;
  /** What fits a slot of the phone's tab bar (five across), where the full name doesn't. */
  short?: string;
};

export const NAV_PAGES: readonly NavPage[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/commodities", label: "Commodities" },
  { href: "/portfolio", label: "Live Portfolio", short: "Portfolio" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/links", label: "Important Links", short: "Links" },
  { href: "/", label: "Brokerage" },
  { href: "/paper-trade", label: "Paper Trade", short: "Paper" },
  { href: "/analysis", label: "Analysis" },
  { href: "/entries", label: "Trade Entries", short: "Entries" },
  { href: "/reports", label: "Reports" },
  { href: "/payment", label: "Payment" },
  { href: "/notes", label: "Notes" },
  { href: "/logs", label: "Logs" },
];

/** Pinned apart from the list - settings isn't a workflow tab, and is never hidden (it is how the list is edited). */
export const SETTINGS_PAGE: NavPage = { href: "/settings", label: "Settings" };

/** Everything from this index on (Notes/Logs) of the default order is the "secondary" group, set apart by a divider. */
export const SECONDARY_GROUP_START = 12;

const BY_HREF = new Map<string, NavPage>(NAV_PAGES.map((page) => [page.href, page]));

/** A page of the nav by its path, or undefined for one that isn't in it. */
export function navPage(href: string): NavPage | undefined {
  return BY_HREF.get(href);
}

/** Notes and Logs - the sidebar draws a divider wherever the list passes between these and the rest. */
export function isSecondaryPage(href: string): boolean {
  return NAV_PAGES.slice(SECONDARY_GROUP_START).some((page) => page.href === href);
}

/** How many pages the phone's tab bar holds, besides "More". */
export const TAB_BAR_SLOTS = 4;

/** A page as the tab bar labels it: the short name where there is one. */
export function tabBarPage(page: NavPage): NavPage {
  return { href: page.href, label: page.short ?? page.label };
}

/** The pages on a phone's tab bar until the device has chosen its own, in order; every other page is under "More". */
export const TAB_BAR: readonly NavPage[] = ["/portfolio", "/watchlist", "/heatmap", "/reports"].map((href) => tabBarPage(BY_HREF.get(href)!));

/** Whether `pathname` is on the page `href` - the home page by exact match, any other also for its sub-pages. */
export function isOnPage(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** What the phone's top bar calls the page: the nav's own name for it, Settings included - hidden pages too. */
export function pageTitle(pathname: string): string {
  const page = [...NAV_PAGES, SETTINGS_PAGE].find((p) => isOnPage(pathname, p.href));
  return page?.label ?? "MarketDesk";
}

/** The pages "More" lists until the device has chosen its own: all but the ones on the tab bar. */
export function morePages(): NavPage[] {
  const onBar = new Set(TAB_BAR.map((t) => t.href));
  return NAV_PAGES.filter((p) => !onBar.has(p.href));
}
