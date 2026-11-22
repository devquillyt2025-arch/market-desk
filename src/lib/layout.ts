/**
 * Locks a page to the viewport on a desktop (1024px and up) so a page's own scrollable content can flex-fill the remaining
 * space and scroll internally instead of growing the whole page: <main> has 2.5rem of padding top and bottom there, and the ticker
 * strip above it takes --ticker-h (set by GlobalMarketsBar, 0 where there is none). Shared so
 * every height-locked page stays in sync if <main>'s padding ever changes — see src/app/page.tsx and
 * src/app/entries/TradeEntriesView.tsx.
 *
 * Not on a phone: there the app screen is already exactly the visible height with the content scrolling between the top bar and
 * the tab bar (the shell in layout.tsx), and a page pinned inside that - header fixed, a small window of content scrolling under
 * it - would leave little room for the content. The page just flows and the screen scrolls.
 */
export const PAGE_HEIGHT_LOCK_CLASS = "lg:h-[calc(100dvh_-_5rem_-_var(--ticker-h,0px))] lg:min-h-0";
