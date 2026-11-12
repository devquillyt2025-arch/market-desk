"use client";

import type { Ref } from "react";

import { SearchIcon, XIcon } from "@/components/icons";

import { toneStyle } from "./LinkCard";

export type GroupChip = { name: string; count: number; tone: string };

type LinksToolbarProps = {
  query: string;
  onQuery: (value: string) => void;
  searchRef: Ref<HTMLInputElement>;
  chips: GroupChip[];
  total: number;
  /** The group filter, or null for all. */
  active: string | null;
  onActive: (name: string | null) => void;
  /** How many links the search and filter leave on screen. */
  shown: number;
};

function Chip({ on, tone, count, onClick, children }: { on: boolean; tone: string; count: number; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={toneStyle(tone)}
      className={`flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
        on
          ? "border-[color-mix(in_srgb,var(--tone)_55%,transparent)] bg-[color-mix(in_srgb,var(--tone)_14%,var(--card))] text-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
      }`}
    >
      <span aria-hidden="true" className="size-2 rounded-full bg-(--tone)" />
      {children}
      <span className="font-mono text-xs tabular-nums text-muted-foreground">{count}</span>
    </button>
  );
}

export function LinksToolbar({ query, onQuery, searchRef, chips, total, active, onActive, shown }: LinksToolbarProps) {
  const filtering = query.trim() !== "" || active !== null;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              onQuery("");
            }
          }}
          placeholder="Search links, sites and notes…"
          aria-label="Search links"
          autoComplete="off"
          className="w-full rounded-2xl border border-border bg-card py-3 pl-11 pr-14 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/70 focus:border-accent focus:ring-4 focus:ring-accent/15 [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            onClick={() => onQuery("")}
            aria-label="Clear search"
            className="absolute right-2.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
          >
            <XIcon className="size-4" />
          </button>
        ) : (
          <kbd
            aria-hidden="true"
            className="absolute right-3.5 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground sm:block pointer-coarse:hidden"
          >
            /
          </kbd>
        )}
      </div>

      {chips.length > 1 && (
        <div role="group" aria-label="Filter by group" className="flex flex-wrap gap-2">
          <Chip on={active === null} tone="var(--accent)" count={total} onClick={() => onActive(null)}>
            All
          </Chip>
          {chips.map((chip) => (
            <Chip key={chip.name} on={active === chip.name} tone={chip.tone} count={chip.count} onClick={() => onActive(active === chip.name ? null : chip.name)}>
              {chip.name}
            </Chip>
          ))}
        </div>
      )}

      {/* Always rendered so a screen reader hears the count change as you type. */}
      <p aria-live="polite" className={`text-sm text-muted-foreground ${filtering ? "" : "sr-only"}`}>
        {filtering ? `Showing ${shown} of ${total} link${total === 1 ? "" : "s"}` : `${total} link${total === 1 ? "" : "s"}`}
      </p>
    </div>
  );
}
