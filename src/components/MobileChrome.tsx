"use client";

/**
 * What frames the app on a phone (under 1024px, where the desktop sidebar is gone): a slim top bar with the page's name,
 * and a tab bar along the bottom edge, where a thumb rests - the four pages checked most often, and "More" for the rest.
 * Both are fixed pieces of the screen: the page scrolls between them (see the shell in layout.tsx), so neither jumps when the
 * browser's own toolbar slides away. Each keeps clear of the notch and the home indicator (needs viewport-fit=cover).
 */

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { lock } from "@/app/lock/actions";
import { DotsIcon, LockIcon } from "@/components/icons";
import Modal from "@/components/Modal";
import { SETTINGS_LINK, withIcon } from "@/components/navLinks";
import ThemeToggle from "@/components/ThemeToggle";
import { isOnPage, morePages, pageTitle, TAB_BAR } from "@/lib/navPages";

/** The PIN screen stands alone: nothing to navigate to while locked. */
const LOCK_PATH = "/lock";

export function MobileTopBar() {
  const pathname = usePathname();
  if (pathname === LOCK_PATH) return null;

  return (
    <header className="shrink-0 border-b border-border bg-card/80 px-4 pt-[env(safe-area-inset-top)] backdrop-blur lg:hidden print:hidden">
      <div className="flex h-12 items-center gap-2.5">
        <Link
          href="/portfolio"
          aria-label="MarketDesk home"
          className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-solid text-sm font-bold text-accent-foreground active:scale-90"
        >
          M
        </Link>
        {/* Not a heading: the page has its own h1 just below. */}
        <span className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{pageTitle(pathname)}</span>
      </div>
    </header>
  );
}

const TAB_CLASS =
  "relative flex h-14 w-full flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors active:scale-95 select-none";

function MoreSheet({ onClose }: { onClose: () => void }) {
  const pathname = usePathname();
  const pages = [...morePages().map(withIcon), SETTINGS_LINK];

  return (
    <Modal onClose={onClose} ariaLabel="More pages" className="sm:max-w-md">
      <div className="px-4 pb-4 pt-1">
        <p className="px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">More</p>
        <ul className="grid grid-cols-3 gap-2">
          {pages.map(({ href, label, icon: Icon }) => {
            const active = isOnPage(pathname, href);
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onClose}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-20 flex-col items-center justify-center gap-1.5 rounded-xl border px-1 py-3 text-center text-xs font-medium transition-colors active:scale-95 ${
                    active ? "border-accent/40 bg-accent/10 text-accent" : "border-border bg-card text-foreground hover:bg-muted"
                  }`}
                >
                  <Icon className="size-6" />
                  <span className="leading-tight">{label}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-card px-3 py-1.5">
          <span className="text-sm text-muted-foreground">Theme</span>
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <form action={lock}>
              <button
                type="submit"
                aria-label="Lock MarketDesk"
                title="Lock"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LockIcon className="size-[18px]" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function MobileTabBar() {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  if (pathname === LOCK_PATH) return null;

  // "More" reads as the open tab on any page that isn't one of the four.
  const onMore = !TAB_BAR.some((tab) => isOnPage(pathname, tab.href));

  return (
    <>
      <nav
        aria-label="Main"
        className="shrink-0 border-t border-border bg-card/90 pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] backdrop-blur lg:hidden print:hidden"
      >
        <ul className="grid grid-cols-5">
          {TAB_BAR.map((tab) => {
            const { icon: Icon } = withIcon(tab);
            const active = isOnPage(pathname, tab.href);
            return (
              <li key={tab.href}>
                <Link
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`${TAB_CLASS} ${active ? "text-accent" : "text-muted-foreground"}`}
                >
                  {active && <motion.span layoutId="tab-indicator" className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
                  <Icon className="size-6" />
                  {tab.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`${TAB_CLASS} ${onMore ? "text-accent" : "text-muted-foreground"}`}
            >
              {onMore && <motion.span layoutId="tab-indicator" className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-accent" transition={{ type: "spring", stiffness: 500, damping: 36 }} />}
              <DotsIcon className="size-6" />
              More
            </button>
          </li>
        </ul>
      </nav>

      <AnimatePresence>{moreOpen && <MoreSheet key="more" onClose={() => setMoreOpen(false)} />}</AnimatePresence>
    </>
  );
}
