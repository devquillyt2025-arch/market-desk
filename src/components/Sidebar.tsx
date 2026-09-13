"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import {
  ActivityIcon,
  BarChartIcon,
  CalendarIcon,
  ClockIcon,
  LinkIcon,
  MenuIcon,
  NoteIcon,
  ReceiptIcon,
  XIcon,
} from "@/components/icons";

const LINKS = [
  { href: "/", label: "Brokerage", icon: ReceiptIcon },
  { href: "/notes", label: "Notes", icon: NoteIcon },
  { href: "/entries", label: "Trade Entries", icon: CalendarIcon },
  { href: "/reports", label: "Reports", icon: BarChartIcon },
  { href: "/history", label: "History", icon: ClockIcon },
  { href: "/links", label: "Important Links", icon: LinkIcon },
  { href: "/logs", label: "Logs", icon: ActivityIcon },
] as const;

const COLLAPSE_STORAGE_KEY = "marketdesk:sidebar-collapsed";

function Brand({ collapsed }: { collapsed: boolean }) {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-foreground">
        M
      </span>
      <span className={collapsed ? "font-semibold tracking-tight lg:hidden" : "font-semibold tracking-tight"}>
        MarketDesk
      </span>
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
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-muted transition-transform duration-200 lg:sticky lg:inset-auto lg:top-0 lg:h-screen lg:translate-x-0 lg:transition-[width] lg:duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        } ${collapsed ? "lg:w-[76px]" : "lg:w-64"}`}
      >
        <div
          className={`flex items-center justify-between px-4 py-4 ${
            collapsed ? "lg:flex-col lg:justify-center lg:gap-3 lg:px-2" : ""
          }`}
        >
          <Brand collapsed={collapsed} />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden active:scale-90"
          >
            <XIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-card hover:text-foreground active:scale-90 lg:flex"
          >
            <MenuIcon className="size-4" />
          </button>
        </div>

        <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-2">
          {LINKS.map((link) => {
            const active = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                title={link.label}
                className={`relative flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                  active ? "text-accent" : "text-muted-foreground hover:bg-card hover:text-foreground"
                } ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
              >
                {active && (
                  <motion.span
                    layoutId="active-nav-pill"
                    className="absolute inset-0 rounded-lg bg-card shadow-sm"
                    transition={{ type: "spring", stiffness: 500, damping: 35 }}
                  />
                )}
                <Icon className="relative z-10 size-4 shrink-0" />
                <span className={collapsed ? "relative z-10 lg:hidden" : "relative z-10"}>{link.label}</span>
              </Link>
            );
          })}
        </nav>

        <div
          className={`flex items-center justify-between border-t border-border px-4 py-3 ${
            collapsed ? "lg:flex-col lg:justify-center lg:gap-2" : ""
          }`}
        >
          <span className={collapsed ? "text-xs text-muted-foreground lg:hidden" : "text-xs text-muted-foreground"}>
            Appearance
          </span>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
