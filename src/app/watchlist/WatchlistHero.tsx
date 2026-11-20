"use client";

import type { ReactNode } from "react";

import { CheckIcon, EyeIcon, PencilIcon, PlusIcon } from "@/components/icons";
import type { WatchTab } from "@/lib/watchlist";

type WatchlistHeroProps = {
  /** Which part of the page is showing: the Edit and Add buttons belong to the saved list, so the global prices and indices don't get them. */
  tab: WatchTab;
  /** Null while the list is still loading. */
  count: number | null;
  /** The list can't be changed yet (its table doesn't exist). */
  readOnly: boolean;
  editMode: boolean;
  onToggleEdit: () => void;
  onAdd: () => void;
  /** The status line along the bottom of the card. */
  children?: ReactNode;
};

/**
 * Violet pool top-left, a magenta-leaning one top-right, a low wash underneath - over the card colour, tokens only.
 * The same look as the Important Links hero, so the two pages read as one family.
 */
const GLOW =
  "radial-gradient(62% 135% at 0% 0%, color-mix(in srgb, var(--accent-solid) 30%, transparent), transparent 62%), radial-gradient(46% 120% at 100% 0%, color-mix(in srgb, var(--accent-soft) 18%, transparent), transparent 62%), radial-gradient(70% 70% at 50% 130%, color-mix(in srgb, var(--accent-solid) 12%, transparent), transparent 70%)";

/** A fine grid fading out from the top-left. Static on purpose - this page is looked at all day. */
const GRID = "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)";
const GRID_MASK = "radial-gradient(ellipse 75% 100% at 15% 0%, #000 15%, transparent 72%)";

export function WatchlistHero({ tab, count, readOnly, editMode, onToggleEdit, onAdd, children }: WatchlistHeroProps) {
  return (
    <section aria-labelledby="watchlist-heading" className="relative isolate overflow-hidden rounded-2xl border border-border bg-card px-4 py-4 sm:px-6 sm:py-5">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ background: GLOW }} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
        style={{ backgroundImage: GRID, backgroundSize: "36px 36px", maskImage: GRID_MASK, WebkitMaskImage: GRID_MASK }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      {/* Title and badge on the left, the buttons on the right, the description on a line of its own under them, then the status line - all in this one card. */}
      <div className="flex min-h-[2.625rem] items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <h1
            id="watchlist-heading"
            className="w-fit bg-gradient-to-r from-foreground from-30% via-accent to-accent-soft bg-clip-text pb-0.5 text-2xl font-semibold tracking-tight text-transparent sm:text-3xl"
          >
            Watchlist
          </h1>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">
            <EyeIcon className="size-3.5" />
            Live markets
          </span>
        </div>

        {/* The buttons belong to the saved list. On a phone they shrink to their icons so they fit beside the title. */}
        <div className={`shrink-0 items-center gap-2 ${tab === "india" ? "flex" : "hidden"}`}>
          <button
            type="button"
            onClick={onToggleEdit}
            disabled={readOnly}
            aria-pressed={editMode}
            aria-label={editMode ? "Done editing" : "Edit the list"}
            title={editMode ? "Done editing" : "Edit the list"}
            className={`flex min-h-11 items-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition-[background-color,color,border-color,transform] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 sm:px-4 ${
              editMode
                ? "border-foreground bg-foreground text-background hover:opacity-90"
                : "border-border bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {editMode ? <CheckIcon className="size-4" /> : <PencilIcon className="size-4" />}
            <span className="hidden sm:inline">{editMode ? "Done" : "Edit"}</span>
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={readOnly}
            aria-haspopup="dialog"
            aria-label="Add an instrument"
            title="Add an instrument"
            className="flex min-h-11 items-center gap-2 rounded-xl bg-accent-solid px-3 py-2.5 text-sm font-semibold text-accent-foreground shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--accent-solid)_85%,transparent),inset_0_1px_0_rgba(255,255,255,0.22)] transition-[filter,transform] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95 sm:min-h-10 sm:px-5"
          >
            <PlusIcon className="size-4" />
            <span className="hidden sm:inline">Add</span>
          </button>
        </div>
      </div>

      <p className="mt-1 text-sm text-muted-foreground">
        {tab === "global" ? (
          "The headline world indices, then crude oil, the rupee, natural gas and gold - the prices behind your MCX positions, and where MCX is expected to open."
        ) : (
          <>
            {count === null ? "The instruments you follow" : `${count} instrument${count === 1 ? "" : "s"} you follow`} - live prices, today&apos;s move and range. Add, reorder and
            remove them; the list follows you across devices.
          </>
        )}
      </p>

      {/* The status line - sessions and breadth, or the state of the global feed - inside the same card, under a hairline. */}
      {children && <div className="mt-3 border-t border-border/70 pt-3">{children}</div>}
    </section>
  );
}
