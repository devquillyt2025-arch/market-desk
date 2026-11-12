"use client";

import { motion } from "framer-motion";
import type { CSSProperties, DragEvent, PointerEvent, ReactNode, Ref } from "react";

import { CopyIcon, ExternalLinkIcon, GripVerticalIcon, PencilIcon, TrashIcon } from "@/components/icons";
import type { LinkItem } from "@/lib/linksStore";

import { LinkLogo } from "./LinkLogo";
import { hostOf, initialsOf } from "./linkMeta";

/**
 * Everything on a card that is coloured reads one custom property, `--tone`, set
 * from its group - so a group's cards, header and chip all share a colour, and
 * changing a group's tone is a one-line change.
 */
export function toneStyle(tone: string): CSSProperties {
  return { "--tone": tone } as CSSProperties;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** How much room the name leaves on the right for what the card puts there: the hover toolbar, the edit-mode buttons, or nothing (the preview). */
export type FaceReserve = "actions" | "edit" | "none";

const RESERVE_CLASS: Record<FaceReserve, string> = {
  actions: "pr-[6.5rem] pointer-coarse:pr-36",
  edit: "pr-24 pointer-coarse:pr-28",
  none: "pr-1",
};

/** Monogram tile + name + site + note. Shared by the real card and the popup's live preview, so the preview can't drift from the card. */
export function LinkCardFace({
  label,
  host,
  description,
  title,
  reserve = "actions",
  logoHost,
}: {
  label: string;
  host: string;
  description?: string;
  /** The name - a link on the real card, plain text in the preview. */
  title: ReactNode;
  reserve?: FaceReserve;
  /** The site to fetch an icon for, drawn over the monogram when it arrives. Null/empty: monogram only. */
  logoHost?: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className={`flex items-start gap-3.5 ${RESERVE_CLASS[reserve]}`}>
        <span
          aria-hidden="true"
          className="relative flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[image:linear-gradient(145deg,color-mix(in_srgb,var(--tone)_30%,var(--card)),color-mix(in_srgb,var(--tone)_8%,var(--card)))] text-sm font-semibold tracking-tight text-[color-mix(in_srgb,var(--tone)_70%,var(--foreground))] shadow-[inset_0_1px_0_color-mix(in_srgb,white_14%,transparent)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--tone)_32%,transparent)]"
        >
          {initialsOf(label)}
          {logoHost ? <LinkLogo key={logoHost} host={logoHost} /> : null}
        </span>
        <div className="min-w-0 flex-1">
          {title}
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={host}>
            {host || "—"}
          </p>
        </div>
      </div>
      {description && (
        <p className="line-clamp-2 text-sm leading-relaxed text-muted-foreground" title={description}>
          {description}
        </p>
      )}
    </div>
  );
}

type LinkCardProps = {
  /** React 19 passes `ref` as a plain prop - AnimatePresence's pop-out layout needs it forwarded to the element. */
  ref?: Ref<HTMLDivElement>;
  link: LinkItem;
  tone: string;
  /** Seconds before the card's entrance starts - 0 once the page has settled, so only the first paint staggers. */
  delay: number;
  editMode: boolean;
  dragging: boolean;
  onDragStart: (e: DragEvent<HTMLDivElement>, link: LinkItem) => void;
  onDragEnd: () => void;
  onOpen: (link: LinkItem) => void;
  onCopy: (link: LinkItem) => void;
  onEdit: (link: LinkItem) => void;
  onDelete: (link: LinkItem) => void;
};

/** Points the spotlight at the cursor. Written straight to the element: a re-render per mouse move would be wasted work. */
function trackPointer(e: PointerEvent<HTMLDivElement>) {
  const rect = e.currentTarget.getBoundingClientRect();
  e.currentTarget.style.setProperty("--mx", `${e.clientX - rect.left}px`);
  e.currentTarget.style.setProperty("--my", `${e.clientY - rect.top}px`);
}

export function LinkCard({ ref, link, tone, delay, editMode, dragging, onDragStart, onDragEnd, onOpen, onCopy, onEdit, onDelete }: LinkCardProps) {
  const host = hostOf(link.url);

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0, transition: { duration: 0.28, ease: EASE, delay } }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      transition={{ duration: 0.24, ease: EASE }}
      whileHover={editMode ? undefined : { y: -3 }}
      draggable={editMode}
      // Capture-phase native handlers - framer-motion's own `onDragStart`/`onDragEnd`
      // props are reserved for its pointer-based drag gesture (only active when the
      // `drag` prop is set), so they'd silently swallow these native HTML5 DnD events.
      onDragStartCapture={(e) => onDragStart(e, link)}
      onDragEndCapture={onDragEnd}
      onPointerMove={trackPointer}
      style={toneStyle(tone)}
      className={`group relative isolate flex flex-col overflow-hidden rounded-2xl border bg-card p-4 transition-[border-color,box-shadow] duration-200 ${
        editMode
          ? "cursor-grab border-dashed border-[color-mix(in_srgb,var(--tone)_40%,var(--border))] active:cursor-grabbing"
          : "border-border hover:border-[color-mix(in_srgb,var(--tone)_45%,var(--border))] hover:shadow-[0_14px_34px_-16px_color-mix(in_srgb,var(--tone)_65%,transparent)] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-accent has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-background"
      } ${dragging ? "opacity-40" : ""}`}
    >
      {/* Spotlight: a soft pool of the group's colour that follows the cursor. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[image:radial-gradient(280px_circle_at_var(--mx,50%)_var(--my,0%),color-mix(in_srgb,var(--tone)_15%,transparent),transparent_70%)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />
      {/* A lit top edge, so the card reads as a raised surface. */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--tone)_60%,transparent)] to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      />

      <LinkCardFace
        label={link.label}
        host={host}
        logoHost={host}
        description={link.description}
        reserve={editMode ? "edit" : "actions"}
        title={
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            draggable={false}
            onClick={(e) => {
              if (editMode) e.preventDefault();
              else onOpen(link);
            }}
            className={`block text-[15px] font-semibold leading-snug outline-none ${editMode ? "" : "after:absolute after:inset-0 after:rounded-2xl"}`}
          >
            {link.label}
            {!editMode && <span className="sr-only"> (opens in a new tab)</span>}
          </a>
        }
      />

      {editMode ? (
        <div className="absolute right-2 top-2 z-10 flex items-center">
          <GripVerticalIcon className="size-4 text-muted-foreground/50" />
          <button
            type="button"
            onClick={() => onEdit(link)}
            aria-label={`Edit ${link.label}`}
            title="Edit link"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent active:scale-90"
          >
            <PencilIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(link)}
            aria-label={`Delete ${link.label}`}
            title="Delete link"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-loss/10 hover:text-danger-fg active:scale-90"
          >
            <TrashIcon className="size-4" />
          </button>
        </div>
      ) : (
        // The container ignores the pointer so a click anywhere on the card still opens the link; only the
        // buttons take it back. They appear on hover, on keyboard focus anywhere in the card (so the whole
        // set shows, not just the one button focused), and are always there on touch, where there is no hover.
        // The arrow - the idle hint that this is a link - sits where the last button will be, and gives way to it.
        <div className="pointer-events-none absolute right-2.5 top-2.5 z-10 flex items-center gap-0.5">
          <span
            aria-hidden="true"
            className="absolute right-0 top-0 flex size-8 items-center justify-center rounded-lg text-muted-foreground/70 transition-opacity duration-150 group-hover:opacity-0 group-has-[:focus-visible]:opacity-0 pointer-coarse:hidden"
          >
            <ExternalLinkIcon className="size-4" />
          </span>
          <button
            type="button"
            onClick={() => onCopy(link)}
            aria-label={`Copy link to ${link.label}`}
            title="Copy link"
            className="pointer-events-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-muted hover:text-foreground group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100 active:scale-90"
          >
            <CopyIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onEdit(link)}
            aria-label={`Edit ${link.label}`}
            title="Edit link"
            className="pointer-events-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-accent/10 hover:text-accent group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100 active:scale-90"
          >
            <PencilIcon className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(link)}
            aria-label={`Delete ${link.label}`}
            title="Delete link"
            className="pointer-events-auto flex size-8 items-center justify-center rounded-lg text-muted-foreground opacity-0 transition-[opacity,color,background-color] duration-150 hover:bg-loss/10 hover:text-danger-fg group-hover:opacity-100 group-has-[:focus-visible]:opacity-100 pointer-coarse:opacity-100 active:scale-90"
          >
            <TrashIcon className="size-4" />
          </button>
        </div>
      )}
    </motion.div>
  );
}
