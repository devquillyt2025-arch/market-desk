"use client";

import { MoonIcon, SunIcon } from "@/components/icons";
import { logEvent } from "@/lib/activityLog";

export default function ThemeToggle() {
  function toggleTheme() {
    const root = document.documentElement;
    const current =
      root.dataset.theme ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // localStorage may be unavailable (private browsing, disabled storage); theme still applies for this load.
    }
    logEvent(`Theme switched to ${next}`);
  }

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label="Toggle dark mode"
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <span className="relative block size-[18px]">
        <SunIcon className="theme-toggle-sun size-[18px]" />
        <MoonIcon className="theme-toggle-moon size-[18px]" />
      </span>
    </button>
  );
}
