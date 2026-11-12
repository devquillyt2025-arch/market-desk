"use client";

import { CheckIcon, LinkIcon, PencilIcon, PlusIcon } from "@/components/icons";

type LinksHeroProps = {
  /** Null while the first load is still in flight. */
  linkCount: number | null;
  groupCount: number | null;
  editMode: boolean;
  onToggleEdit: () => void;
  onAdd: () => void;
};

/**
 * Three light sources over the card colour: a strong violet pool top-left, a magenta-leaning one top-right, and
 * a low wash bottom-centre that gives the panel depth. Tokens only, so it holds in light and dark.
 */
const GLOW =
  "radial-gradient(62% 135% at 0% 0%, color-mix(in srgb, var(--accent-solid) 34%, transparent), transparent 62%), radial-gradient(46% 120% at 100% 0%, color-mix(in srgb, var(--accent-soft) 22%, transparent), transparent 62%), radial-gradient(70% 70% at 50% 130%, color-mix(in srgb, var(--accent-solid) 16%, transparent), transparent 70%)";

/** A fine grid that fades out away from the top-left corner. Static on purpose - this app is stared at for hours. */
const GRID = "linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)";
const GRID_MASK = "radial-gradient(ellipse 75% 100% at 15% 0%, #000 15%, transparent 72%)";

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-background/55 px-4 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 flex items-center gap-2 font-mono text-2xl font-semibold tabular-nums leading-none">{children}</dd>
    </div>
  );
}

export function LinksHero({ linkCount, groupCount, editMode, onToggleEdit, onAdd }: LinksHeroProps) {
  return (
    <section aria-labelledby="links-heading" className="relative isolate overflow-hidden rounded-3xl border border-border bg-card p-6 sm:p-8">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10" style={{ background: GLOW }} />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 opacity-50"
        style={{ backgroundImage: GRID, backgroundSize: "36px 36px", maskImage: GRID_MASK, WebkitMaskImage: GRID_MASK }}
      />
      {/* A lit hairline along the top edge. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-accent/60 to-transparent" />

      <div className="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <span className="inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-xs font-medium text-accent">
            <LinkIcon className="size-3.5" />
            Quick access
          </span>
          <h1
            id="links-heading"
            className="mt-4 w-fit bg-gradient-to-r from-foreground from-30% via-accent to-accent-soft bg-clip-text pb-1 text-4xl font-semibold tracking-tight text-transparent sm:text-5xl"
          >
            Important Links
          </h1>
          <p className="mt-2 max-w-prose text-sm leading-relaxed text-muted-foreground sm:text-base">
            Market data and reference sites, one click away - synced across your devices. Add your own and sort them into groups.
          </p>
        </div>

        <div className="flex flex-col gap-4 lg:items-end">
          <dl className="grid grid-cols-3 gap-2.5">
            <Stat label="Links">{linkCount ?? "–"}</Stat>
            <Stat label="Groups">{groupCount ?? "–"}</Stat>
            <Stat label="Sync">
              <span aria-hidden="true" className="size-2 rounded-full bg-success shadow-[0_0_10px_var(--success)]" />
              <span className="font-sans text-sm font-semibold">Live</span>
            </Stat>
          </dl>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={onToggleEdit}
              aria-pressed={editMode}
              className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-[background-color,color,border-color,transform] active:scale-95 sm:min-h-10 ${
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
              aria-haspopup="dialog"
              className="flex min-h-11 items-center gap-2 rounded-xl bg-accent-solid px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--accent-solid)_85%,transparent),inset_0_1px_0_rgba(255,255,255,0.22)] transition-[filter,transform] hover:brightness-110 active:scale-95 sm:min-h-10"
            >
              <PlusIcon className="size-4" />
              Add link
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
