"use client";

import { useRef, type KeyboardEvent } from "react";

import { WATCH_TABS, type WatchTab } from "@/lib/watchlist";

const LABELS: Record<WatchTab, string> = { india: "Indian markets", global: "Global markets" };

/** The id of each tab's button and of the panel it controls - the page puts these on its panels. */
export const watchTabId = (tab: WatchTab) => `watch-tab-${tab}`;
export const watchPanelId = (tab: WatchTab) => `watch-panel-${tab}`;

/**
 * "Indian markets" and "Global markets", in the underlined style of the other tab strips (Portfolio insights, Analysis), with
 * the same keyboard use: arrow keys, Home and End move between the tabs, and only the selected one is a tab stop.
 */
export function WatchTabs({ tab, onChange }: { tab: WatchTab; onChange: (tab: WatchTab) => void }) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = WATCH_TABS.indexOf(tab);
    let next: number;
    if (e.key === "ArrowRight") next = (current + 1) % WATCH_TABS.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + WATCH_TABS.length) % WATCH_TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = WATCH_TABS.length - 1;
    else return;
    e.preventDefault();
    onChange(WATCH_TABS[next]);
    buttons.current[next]?.focus();
  }

  return (
    <div role="tablist" aria-label="Watchlist" onKeyDown={handleKeyDown} className="flex items-center gap-6 border-b border-border">
      {WATCH_TABS.map((id, i) => {
        const active = tab === id;
        return (
          <button
            key={id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            id={watchTabId(id)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={watchPanelId(id)}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(id)}
            className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm font-semibold uppercase tracking-wide transition-colors ${
              active ? "border-accent text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}
