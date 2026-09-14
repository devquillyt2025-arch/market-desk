"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  ActivityIcon,
  BarChartIcon,
  CalendarIcon,
  LinkIcon,
  MenuIcon,
  NoteIcon,
  ReceiptIcon,
  SettingsIcon,
  TrendingUpIcon,
  WalletIcon,
  XIcon,
} from "@/components/icons";

const LINKS = [
  { href: "/", label: "Brokerage", icon: ReceiptIcon },
  { href: "/notes", label: "Notes", icon: NoteIcon },
  { href: "/entries", label: "Trade Entries", icon: CalendarIcon },
  { href: "/reports", label: "Reports", icon: BarChartIcon },
  { href: "/portfolio", label: "Live Portfolio", icon: TrendingUpIcon },
  { href: "/payment", label: "Payment", icon: WalletIcon },
  { href: "/links", label: "Important Links", icon: LinkIcon },
  { href: "/logs", label: "Logs", icon: ActivityIcon },
] as const;

/** Pinned below the scrolling list, not part of it — settings isn't a workflow tab. */
const SETTINGS_LINK = { href: "/settings", label: "Settings", icon: SettingsIcon } as const;

/** Everything from this index on renders as a visually separate "secondary" group when collapsed. */
const SECONDARY_GROUP_START = 5;

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
        collapsed ? "lg:max-w-0 lg:opacity-0" : "max-w-[180px] opacity-100"
      } ${className ?? ""}`}
    >
      {children}
    </span>
  );
}

type NavItemProps = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
};

/** Shared by both the scrolling nav list and the pinned Settings item below it, so they stay visually identical. */
function NavItem({ href, label, icon: Icon, active, collapsed, onClick }: NavItemProps) {
  return (
    <Link
      href={href}
      onClick={onClick}
      title={collapsed ? undefined : label}
      className={`group relative flex items-center gap-3 rounded-lg px-3.5 py-3 text-sm font-medium transition-colors ${
        active ? "text-accent" : "text-muted-foreground hover:bg-card hover:text-foreground"
      } ${collapsed ? "lg:justify-center lg:gap-0 lg:px-0 lg:py-3" : ""}`}
    >
      {active && (
        <motion.span
          layoutId="active-nav-pill"
          className={`absolute inset-0 rounded-lg bg-card shadow-sm ${collapsed ? "lg:bg-accent/10 lg:shadow-none" : ""}`}
          transition={{ type: "spring", stiffness: 500, damping: 35 }}
        />
      )}
      <Icon className={`relative z-10 size-5 shrink-0 ${collapsed ? "lg:size-6" : ""}`} />
      <CollapsibleLabel collapsed={collapsed} className="relative z-10">
        {label}
      </CollapsibleLabel>

      {/* Hover tooltip — only meaningful once the inline label is gone (collapsed, desktop only). */}
      {collapsed && (
        <span
          role="tooltip"
          className="pointer-events-none absolute left-full top-1/2 z-50 ml-3 hidden -translate-x-1 -translate-y-1/2 whitespace-nowrap rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground opacity-0 shadow-md transition-[opacity,transform] duration-150 group-hover:translate-x-0 group-hover:opacity-100 lg:block"
        >
          {label}
        </span>
      )}
    </Link>
  );
}

/**
 * Hidden at lg+ once collapsed (never on mobile, where the drawer always
 * shows the full brand regardless of the desktop-only collapsed flag) —
 * the collapse toggle button below takes over the same visual spot.
 */
function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className={`flex items-center gap-2 ${collapsed ? "lg:hidden" : ""}`}>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-foreground">
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
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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

  return (
    <>
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur lg:hidden">
        <Brand collapsed={false} />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
        >
          <MenuIcon className="size-5" />
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
            className="fixed inset-0 z-30 bg-black/40 lg:hidden"
          />
        )}
      </AnimatePresence>

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-muted transition-transform duration-200 lg:sticky lg:inset-auto lg:top-0 lg:h-screen lg:translate-x-0 lg:transition-[width] lg:duration-[500ms] lg:ease-[cubic-bezier(0.22,1,0.36,1)] ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-[76px]" : "lg:w-64"}`}
      >
        <div
          className={`flex shrink-0 items-center justify-between gap-2 px-4 py-4 transition-[padding] lg:duration-[500ms] lg:ease-[cubic-bezier(0.22,1,0.36,1)] ${
            collapsed ? "lg:justify-center lg:px-2" : ""
          }`}
        >
          <Brand collapsed={collapsed} />
          {/* Collapsed-desktop only: the logo itself becomes the expand toggle, replacing the hamburger. */}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className={`hidden size-7 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-foreground transition-opacity hover:opacity-90 active:scale-90 ${
              collapsed ? "lg:flex" : ""
            }`}
          >
            M
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden active:scale-90"
          >
            <XIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className={`hidden size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-card hover:text-foreground active:scale-90 ${
              collapsed ? "" : "lg:flex"
            }`}
          >
            <MenuIcon className="size-4" />
          </button>
        </div>

        {/*
          No overflow-y-auto here (unlike before this redesign): the hover
          tooltips below are absolutely positioned to escape the rail to the
          right, and any ancestor overflow clipping — including overflow-y
          alone, since an unset overflow-x computes to auto rather than
          visible once overflow-y isn't visible — would cut them off. Safe
          today because 8 items comfortably fit any realistic viewport
          height; revisit (portal the tooltip, or scroll only when needed)
          if the nav list grows enough to risk overflowing vertically.
        */}
        <nav
          className={`flex flex-1 flex-col gap-1 px-3 py-2 transition-[padding] lg:duration-[500ms] lg:ease-[cubic-bezier(0.22,1,0.36,1)] ${
            collapsed ? "lg:gap-1.5 lg:px-2" : ""
          }`}
        >
          {LINKS.flatMap((link, index) => {
            const item = (
              <NavItem
                key={link.href}
                href={link.href}
                label={link.label}
                icon={link.icon}
                active={pathname === link.href}
                collapsed={collapsed}
                onClick={() => setOpen(false)}
              />
            );

            if (collapsed && index === SECONDARY_GROUP_START) {
              return [
                <div key={`divider-${link.href}`} className="mx-1 my-1.5 hidden border-t border-border/70 lg:block" />,
                item,
              ];
            }
            return [item];
          })}
        </nav>

        {/* Pinned below the scrolling list — settings isn't a workflow tab, so it stays anchored at the bottom edge instead of scrolling with the rest. */}
        <div
          className={`shrink-0 border-t border-border px-3 py-2 transition-[padding] lg:duration-[500ms] lg:ease-[cubic-bezier(0.22,1,0.36,1)] ${
            collapsed ? "lg:px-2" : ""
          }`}
        >
          <NavItem
            href={SETTINGS_LINK.href}
            label={SETTINGS_LINK.label}
            icon={SETTINGS_LINK.icon}
            active={pathname === SETTINGS_LINK.href}
            collapsed={collapsed}
            onClick={() => setOpen(false)}
          />
        </div>
      </aside>
    </>
  );
}
