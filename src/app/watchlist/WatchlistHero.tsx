"use client";

import { CheckIcon, EyeIcon, PencilIcon, PlusIcon } from "@/components/icons";

type WatchlistHeroProps = {
  /** Null while the list is still loading. */
  count: number | null;
  /** The list can't be changed yet (its table doesn't exist). */
  readOnly: boolean;
  editMode: boolean;
  onToggleEdit: () => void;
  onAdd: () => void;
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

export function WatchlistHero({ count, readOnly, editMode, onToggleEdit, onAdd }: WatchlistHeroProps) {
  return (
    <section aria-labelledby="watchlist-heading" className="relative isolate overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ background: GLOW }} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
        style={{ backgroundImage: GRID, backgroundSize: "36px 36px", maskImage: GRID_MASK, WebkitMaskImage: GRID_MASK }}
      />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <EyeIcon className="size-3.5" />
            Live markets
          </span>
          <h1
            id="watchlist-heading"
            className="mt-4 w-fit bg-gradient-to-r from-foreground from-30% via-accent to-accent-soft bg-clip-text pb-1 text-4xl font-semibold tracking-tight text-transparent sm:text-5xl"
          >
            Watchlist
          </h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
            {count === null ? "The instruments you follow" : `${count} instrument${count === 1 ? "" : "s"} you follow`} - live prices, today&apos;s move and range. Add, reorder and
            remove them; the list follows you across devices.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onToggleEdit}
            disabled={readOnly}
            aria-pressed={editMode}
            className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-[background-color,color,border-color,transform] active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-10 ${
              editMode
                ? "border-foreground bg-foreground text-background hover:opacity-90"
                : "border-border bg-background/60 text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {editMode ? <CheckIcon className="size-4" /> : <PencilIcon className="size-4" />}
            {editMode ? "Done" : "Edit"}
          </button>
          <button
            type="button"
            onClick={onAdd}
            disabled={readOnly}
            aria-haspopup="dialog"
            className="flex min-h-11 items-center gap-2 rounded-xl bg-accent-solid px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--accent-solid)_85%,transparent),inset_0_1px_0_rgba(255,255,255,0.22)] transition-[filter,transform] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 active:scale-95 sm:min-h-10"
          >
            <PlusIcon className="size-4" />
            Add
          </button>
        </div>
      </div>
    </section>
  );
}
