/**
 * Locks a page to the viewport (three tiers because Sidebar's mobile top bar
 * only exists below `lg`, and <main>'s own padding changes at `sm`) so a
 * page's own scrollable content can flex-fill the remaining space and scroll
 * internally instead of growing the whole page. Shared so every height-locked
 * page stays in sync if <main>'s padding or Sidebar's mobile bar height ever
 * changes — see src/app/page.tsx and src/app/entries/TradeEntriesView.tsx.
 */
export const PAGE_HEIGHT_LOCK_CLASS = "h-[calc(100dvh-125px)] min-h-0 sm:h-[calc(100dvh-141px)] lg:h-[calc(100dvh-5rem)]";
