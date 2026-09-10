"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import ThemeToggle from "@/components/ThemeToggle";
import {
  ActivityIcon,
  CalculatorIcon,
  ClockIcon,
  LinkIcon,
  MenuIcon,
  XIcon,
} from "@/components/icons";

const LINKS = [
  { href: "/", label: "Calculator", icon: CalculatorIcon },
  { href: "/history", label: "History", icon: ClockIcon },
  { href: "/links", label: "Important Links", icon: LinkIcon },
  { href: "/logs", label: "Logs", icon: ActivityIcon },
] as const;

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-foreground">
        M
      </span>
      <span className="font-semibold tracking-tight">MarketDesk</span>
    </Link>
  );
}

export default function Sidebar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-border bg-card/80 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open menu"
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MenuIcon className="size-5" />
        </button>
      </div>

      {open && (
        <div
          onClick={() => setOpen(false)}
          aria-hidden="true"
          className="fixed inset-0 z-30 bg-black/40 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-border bg-muted transition-transform duration-200 lg:sticky lg:inset-auto lg:top-0 lg:h-screen lg:translate-x-0 lg:transition-none ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 py-4">
          <Brand />
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
          >
            <XIcon className="size-4" />
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
                className={
                  active
                    ? "flex items-center gap-2.5 rounded-lg bg-card px-3 py-2.5 text-sm font-medium text-accent shadow-sm"
                    : "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
                }
              >
                <Icon className="size-4 shrink-0" />
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center justify-between border-t border-border px-4 py-3">
          <span className="text-xs text-muted-foreground">Appearance</span>
          <ThemeToggle />
        </div>
      </aside>
    </>
  );
}
