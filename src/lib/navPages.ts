/**
 * The app's pages, in one place (no icons, so it is plain logic): the desktop sidebar lists all of them, and the phone's tab bar
 * shows the first few and puts the rest under "More". Live Portfolio, Watchlist, Heatmap and Important Links come first - the
 * tabs checked most often through the day - followed by the workflow tabs (Brokerage, Paper Trade, Analysis, Trade Entries,
 * Reports, Payment). Notes and Logs are reference utilities, so they sit in their own group after a divider (SECONDARY_GROUP_START).
 */

export type NavPage = { href: string; label: string };

export const NAV_PAGES: readonly NavPage[] = [
  { href: "/commodities", label: "Commodities" },
  { href: "/portfolio", label: "Live Portfolio" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/links", label: "Important Links" },
  { href: "/", label: "Brokerage" },
  { href: "/paper-trade", label: "Paper Trade" },
  { href: "/analysis", label: "Analysis" },
  { href: "/entries", label: "Trade Entries" },
  { href: "/reports", label: "Reports" },
  { href: "/payment", label: "Payment" },
  { href: "/notes", label: "Notes" },
  { href: "/logs", label: "Logs" },
];

/** Pinned apart from the list - settings isn't a workflow tab. */
export const SETTINGS_PAGE: NavPage = { href: "/settings", label: "Settings" };

/** Everything from this index on (Notes/Logs) renders as a visually separate "secondary" group, below a divider. */
export const SECONDARY_GROUP_START = 11;

/** The pages on a phone's tab bar, in order; every other page is under "More". Short labels - the bar is five slots wide. */
export const TAB_BAR: readonly NavPage[] = [
  { href: "/portfolio", label: "Portfolio" },
  { href: "/watchlist", label: "Watchlist" },
  { href: "/heatmap", label: "Heatmap" },
  { href: "/reports", label: "Reports" },
];

/** Whether `pathname` is on the page `href` - the home page by exact match, any other also for its sub-pages. */
export function isOnPage(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** What the phone's top bar calls the page: the nav's own name for it, Settings included. */
export function pageTitle(pathname: string): string {
  const page = [...NAV_PAGES, SETTINGS_PAGE].find((p) => isOnPage(pathname, p.href));
  return page?.label ?? "MarketDesk";
}

/** The pages "More" lists: all but the ones on the tab bar. */
export function morePages(): NavPage[] {
  const onBar = new Set(TAB_BAR.map((t) => t.href));
  return NAV_PAGES.filter((p) => !onBar.has(p.href));
}
