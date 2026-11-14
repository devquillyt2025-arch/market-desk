"use client";

import type { ReactNode } from "react";

import { RefreshIcon } from "@/components/icons";
import { formatAsOf } from "@/lib/format";

/** A small rounded status with a dot - an exchange being open or closed, or the state of a price feed. Said in words as well as a dot: colour alone is not a state. */
export function StatusPill({ dot, title, children }: { dot: string; title?: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-border bg-background/60 px-3 py-1 text-sm" title={title}>
      <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
      {children}
    </span>
  );
}

type PulseRefreshProps = {
  /** When the prices on screen were fetched, or null before the first. */
  lastPolledAt: number | null;
  /** The prices are the last ones seen, not live. */
  stale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
  label: string;
  /** What the time and the button say on hover - how often it syncs. */
  title?: string;
};

/** "Updated 1:41:25 am" (or, when the prices are old, "Last prices 13 Nov, 11:54 pm" in amber) and the button that refreshes now. */
export function PulseRefresh({ lastPolledAt, stale, refreshing, onRefresh, label, title }: PulseRefreshProps) {
  return (
    <div className="flex items-center gap-1.5">
      {lastPolledAt !== null &&
        (stale ? (
          <span className="whitespace-nowrap text-xs font-medium text-warning">Last prices {formatAsOf(lastPolledAt)}</span>
        ) : (
          <span className="whitespace-nowrap text-xs text-muted-foreground" title={title}>
            Updated {new Date(lastPolledAt).toLocaleTimeString("en-IN")}
          </span>
        ))}
      <button
        type="button"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label={label}
        title={title ? `${label} (${title.toLowerCase()})` : label}
        className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-60"
      >
        <RefreshIcon className={`size-4 ${refreshing ? "animate-spin" : ""}`} />
      </button>
    </div>
  );
}
