"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { lock } from "@/app/lock/actions";
import { thinScroll } from "@/components/averaging/ui";
import { LockIcon, MenuIcon, PencilIcon } from "@/components/icons";
import NavTabsDialog from "@/components/NavTabsDialog";
import { SETTINGS_LINK, withIcon } from "@/components/navLinks";
import ThemeToggle from "@/components/ThemeToggle";
import { dividerBefore, shownPages } from "@/lib/navPrefs";
import { useNavPrefs } from "@/lib/useNavPrefs";

/**
 * The desktop rail (1024px and up). On a phone there is no sidebar: the tab bar and top bar (MobileChrome.tsx) take its place.
 * Both list the pages this device has chosen (lib/navPrefs.ts - edited from the pencil below or on the Settings page); until it
 * chooses they are the app's own list (lib/navPages.ts): Live Portfolio, Watchlist, Heatmap and Important Links first (the tabs
 * checked most often through the day), then the workflow tabs, and Notes and Logs in their own group after a divider.
 *
 * Expanded and collapsed share one vertical rhythm — same header height, row
 * height, gap and divider — so every icon stays at the same height when the
 * rail is toggled and only the width changes.
 */

const COLLAPSE_STORAGE_KEY = "marketdesk:sidebar-collapsed";

/**
 * Shared timing for every piece of the collapse animation, so nothing drifts
 * out of sync. A plain deceleration curve (no overshoot) — an earlier
 * "back ease" version bounced past the target on both ends, which read as
 * more motion than the interaction warranted and made expand/collapse feel
 * asymmetric (bulging outward vs. dipping inward before settling). This
 * settles directly, the same way in both directions. Deliberately past the
 * usual "150-300ms micro-interaction" guidance: this toggle is a
 * once-in-a-while layout change, not a frequent hover/press response.
 */
const COLLAPSE_TRANSITION = "duration-[500ms] ease-[cubic-bezier(0.22,1,0.36,1)]";

/**
 * Fades and shrinks its content to zero width instead of the old `hidden`
 * (an instant `display:none` swap while the sidebar was still visibly
 * animating its width — the actual source of the "not smooth" feel).
 *
 * Uses `max-width` rather than a grid-template-columns `fr` trick: animating
 * `fr` tracks is only reliably reversible in some browsers — collapsing back
 * down from an already-resolved `1fr` didn't re-run the same interpolation
 * opening did, which is why closing looked instant while opening looked
 * fine. `max-width` has no such asymmetry. 180px comfortably fits the
 * longest label ("Important Links") without ever clipping it mid-transition.
 */
function CollapsibleLabel({
  collapsed,
  className,
  children,
}: {
  collapsed: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-block overflow-hidden whitespace-nowrap align-middle transition-[max-width,opacity] ${COLLAPSE_TRANSITION} ${
        collapsed ? "max-w-0 opacity-0" : "max-w-[180px] opacity-100"
      } ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

/** Where the collapsed rail's hover label goes (viewport pixels), and whether it is showing - it fades out with its text still in place. */
type Tip = { label: string; top: number; left: number; show: boolean };

type NavItemProps = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  /** Called with the label's anchor on hover and with null on leave; only used while collapsed. */
  onTip: (anchor: { label: string; top: number; left: number } | null) => void;
};

/** Shared by both the scrolling nav list and the pinned Settings item below it, so they stay visually identical. */
function NavItem({ href, label, icon: Icon, active, collapsed, onTip }: NavItemProps) {
  return (
    <Link
      href={href}
      title={collapsed ? undefined : label}
      aria-current={active ? "page" : undefined}
      onMouseEnter={
        collapsed
          ? (event) => {
              const box = event.currentTarget.getBoundingClientRect();
              onTip({ label, top: box.top + box.height / 2, left: box.right });
            }
          : undefined
      }
      onMouseLeave={collapsed ? () => onTip(null) : undefined}
      className={`relative flex items-center rounded-lg py-3 text-sm font-medium transition-colors ${
        active ? "text-accent" : "text-muted-foreground hover:bg-card hover:text-foreground"
      } ${collapsed ? "justify-center" : "gap-3 px-3.5"}`}
    >
      {active && (
        <motion.span
          layoutId="active-nav-pill"
          className={`absolute inset-0 rounded-lg ${collapsed ? "bg-accent/10" : "bg-card shadow-sm"}`}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
      <Icon className="relative z-10 size-5 shrink-0" />
      <CollapsibleLabel collapsed={collapsed} className="relative z-10">
        {label}
      </CollapsibleLabel>
    </Link>
  );
}

/** Hidden once collapsed — the collapse toggle button below takes over the same visual spot. */
function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/portfolio" className={`${collapsed ? "hidden" : "flex"} items-center gap-2`}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent-solid text-sm font-bold text-accent-foreground">
        M
      </span>
      <CollapsibleLabel collapsed={collapsed} className="font-semibold tracking-tight">
        MarketDesk
      </CollapsibleLabel>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [tip, setTip] = useState<Tip | null>(null);
  const [editingTabs, setEditingTabs] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const [navPrefs] = useNavPrefs();
  const pages = useMemo(() => shownPages(navPrefs).map(withIcon), [navPrefs]);

  function showTip(anchor: { label: string; top: number; left: number } | null) {
    setTip((prev) => (anchor ? { ...anchor, show: true } : prev && { ...prev, show: false }));
  }

  // On a short screen the list scrolls, so a page opened from a link or a reload can sit below the fold: bring it into view.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const room = nav.getBoundingClientRect();
    const row = active.getBoundingClientRect();
    if (row.top < room.top) nav.scrollTop += row.top - room.top - 8;
    else if (row.bottom > room.bottom) nav.scrollTop += row.bottom - room.bottom + 8;
  }, [pathname, pages]);

  useEffect(() => {
    // Defaulting to expanded and syncing from localStorage only after mount avoids a
    // server/client hydration mismatch — localStorage doesn't exist during SSR.
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSE_STORAGE_KEY) === "true");
    } catch {
      // localStorage may be unavailable (private browsing, disabled storage); default stays expanded.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
      } catch {
        // Nothing to recover — the toggle still applies for this load.
      }
      return next;
    });
  }

  // The PIN screen stands alone — no nav to wander into while locked.
  if (pathname === "/lock") return null;

  // z-20: the collapsed rail's hover label hangs out over the page, and without its own layer the page's cards (later in the
  // document, positioned) painted over it. Well under the dialogs (300+), the toasts and the skip link.
  return (
    <>
      <aside
        className={`sticky top-0 z-20 hidden h-screen flex-col border-r border-border bg-background transition-[width] duration-[500ms] ease-[cubic-bezier(0.22,1,0.36,1)] lg:flex ${
          collapsed ? "w-[76px]" : "w-64"
        }`}
      >
        {/* Fixed height: the collapse button (size-8) and the logo that replaces it (size-7) would otherwise give the two states different header heights, shifting every nav item below. */}
        <div
          className={`flex h-16 shrink-0 items-center gap-2 transition-[padding] duration-[500ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            collapsed ? "justify-center px-2" : "justify-between px-4"
          }`}
        >
          <Brand collapsed={collapsed} />
          {/* Collapsed only: the logo itself becomes the expand toggle, replacing the hamburger. */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className={`${collapsed ? "flex" : "hidden"} size-7 shrink-0 items-center justify-center rounded-md bg-accent-solid text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 active:scale-90`}
          >
            M
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className={`${collapsed ? "hidden" : "flex"} size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-card hover:text-foreground active:scale-90`}
          >
            <MenuIcon className="size-4" />
          </button>
        </div>

        {/*
          The list scrolls between the pinned header and footer: all 13 pages need about 780px, more than a laptop browser window
          often has, and without this Settings, the theme toggle and Lock were pushed off the bottom with no way to reach them.
          `min-h-0` lets a flex child shrink below its content so the overflow can scroll. Overflow clips the collapsed rail's
          hover labels, which is why those are drawn once, `fixed`, below (a fixed box isn't clipped by a scrolling ancestor).
          The scrollbar only exists while the list overflows; collapsed it is hidden (the wheel still scrolls) so the icons stay centred.
        */}
        <nav
          ref={navRef}
          onScroll={() => showTip(null)}
          className={`flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden overscroll-contain py-2 transition-[padding] duration-[500ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            collapsed ? "px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : `px-3 ${thinScroll}`
          }`}
        >
          {pages.flatMap((link, index) => {
            const item = (
              <NavItem
                key={link.href}
                href={link.href}
                label={link.label}
                icon={link.icon}
                active={pathname === link.href}
                collapsed={collapsed}
                onTip={showTip}
              />
            );

            if (dividerBefore(pages, index)) {
              return [<div key={`divider-${link.href}`} className="mx-1 my-1.5 border-t border-border/70" />, item];
            }
            return [item];
          })}
          {pages.length === 0 && !collapsed && (
            <p className="px-3.5 py-2 text-xs text-muted-foreground">No tabs shown. Use the pencil below to choose some.</p>
          )}
        </nav>

        {/* Pinned below the scrolling list — settings isn't a workflow tab, so it stays anchored at the bottom edge instead of scrolling with the rest. Theme toggle rides alongside it so switching themes never requires opening Settings first. */}
        {/*
          Collapsed, only Settings stays: the theme toggle and lock fold away
          with the labels (same max-width/opacity transition as
          CollapsibleLabel, so they slide in step with the rail's width), which
          keeps the footer one row high in both states. `invisible` takes them
          out of the tab order while folded; listed in the transition, it only
          flips once the fade-out has finished.
        */}
        <div
          className={`shrink-0 border-t border-border py-2 transition-[padding] duration-[500ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
            collapsed ? "px-2" : "px-3"
          }`}
        >
          <div className={`flex items-center ${collapsed ? "gap-0" : "gap-1"}`}>
            <div className="min-w-0 flex-1">
              <NavItem
                href={SETTINGS_LINK.href}
                label={SETTINGS_LINK.label}
                icon={SETTINGS_LINK.icon}
                active={pathname === SETTINGS_LINK.href}
                collapsed={collapsed}
                onTip={showTip}
              />
            </div>
            <div
              className={`flex shrink-0 items-center gap-1 overflow-hidden transition-[max-width,opacity,visibility] ${COLLAPSE_TRANSITION} ${
                collapsed ? "invisible max-w-0 opacity-0" : "max-w-28 opacity-100"
              }`}
            >
              <button
                type="button"
                onClick={() => setEditingTabs(true)}
                aria-label="Choose sidebar tabs"
                aria-haspopup="dialog"
                title="Choose tabs"
                className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <PencilIcon className="size-4" />
              </button>
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

        {/* The collapsed rail's hover label: one shared, fixed box (the nav scrolls, which would clip a label drawn inside each row). */}
        {collapsed && tip && (
          <span
            role="tooltip"
            style={{ top: tip.top, left: tip.left }}
            className={`pointer-events-none fixed z-50 ml-3 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground shadow-md transition-[opacity,transform] duration-150 ${
              tip.show ? "translate-x-0 opacity-100" : "-translate-x-1 opacity-0"
            }`}
          >
            {tip.label}
          </span>
        )}
      </aside>
      {/* Outside the aside: its own layer (z-20) would otherwise hold the dialog under anything above that in the page. */}
      <AnimatePresence>{editingTabs && <NavTabsDialog key="tabs" onClose={() => setEditingTabs(false)} />}</AnimatePresence>
    </>
  );
}
