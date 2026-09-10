"use client";

import { motion } from "framer-motion";
import { useState } from "react";

import { PinIcon, TrashIcon } from "@/components/icons";
import { NOTE_COLOR_CLASSES, NOTE_COLOR_LABELS } from "@/lib/noteColors";
import type { Note, NoteColor } from "@/lib/notesStore";

const PICKABLE_COLORS = Object.keys(NOTE_COLOR_CLASSES) as Exclude<NoteColor, "default">[];

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

type NoteCardProps = {
  note: Note;
  viewMode: "grid" | "list";
  onOpen: (note: Note) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onColorSelect: (id: string, color: NoteColor) => void;
};

export default function NoteCard({ note, viewMode, onOpen, onPin, onDelete, onColorSelect }: NoteCardProps) {
  const [showColors, setShowColors] = useState(false);

  const colored = note.color !== "default";
  const colorClasses = colored ? NOTE_COLOR_CLASSES[note.color as Exclude<NoteColor, "default">] : null;
  const isList = viewMode === "list";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      onClick={() => onOpen(note)}
      className={`group relative cursor-pointer overflow-hidden rounded-xl border p-3.5 shadow-sm transition-shadow hover:shadow-md ${
        colorClasses ? `${colorClasses.bg} ${colorClasses.border}` : "border-border bg-card"
      } ${isList ? "flex flex-row items-center gap-4" : `flex h-[182px] flex-col`}`}
    >
      <span
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-[3px] opacity-70 transition-opacity group-hover:opacity-100 ${
          colorClasses ? colorClasses.swatch : "bg-accent"
        }`}
      />

      {note.pinned && (
        <PinIcon filled className="absolute right-2.5 top-2.5 size-3.5 text-accent/70" />
      )}

      <div className={`flex min-h-0 flex-1 flex-col gap-1.5 ${isList ? "" : "pt-1"}`}>
        <div
          className={`line-clamp-1 text-sm font-semibold text-foreground ${note.pinned ? "pr-5" : ""}`}
        >
          {note.title || "Untitled"}
        </div>
        {note.content && (
          <div
            className={`min-h-0 flex-1 whitespace-pre-wrap break-words text-[0.81rem] leading-relaxed text-muted-foreground ${
              isList ? "line-clamp-1" : "line-clamp-4"
            }`}
          >
            {note.content}
          </div>
        )}
      </div>

      <div
        className={`flex shrink-0 items-center justify-between gap-2 border-t pt-1.5 ${
          colorClasses ? colorClasses.border : "border-border"
        } ${isList ? "w-auto border-t-0 pt-0" : "mt-1.5"}`}
      >
        <span className="text-[0.67rem] text-muted-foreground">{timeAgo(note.updatedAt)}</span>

        <div
          className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100"
          onMouseLeave={() => setShowColors(false)}
        >
          {!showColors ? (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onPin(note.id);
                }}
                aria-label={note.pinned ? "Unpin note" : "Pin note"}
                className={`flex size-7 items-center justify-center rounded-md transition-colors hover:bg-muted ${
                  note.pinned ? "text-accent" : "text-muted-foreground"
                }`}
              >
                <PinIcon filled={note.pinned} className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowColors(true);
                }}
                aria-label="Change color"
                className="flex size-7 items-center justify-center rounded-md transition-colors hover:bg-muted"
              >
                <span
                  className={`block size-3.5 rounded-full border ${
                    colorClasses ? `${colorClasses.swatch} border-black/10` : "border-muted-foreground/40 bg-card"
                  }`}
                />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(note.id);
                }}
                aria-label="Delete note"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-loss/10 hover:text-loss"
              >
                <TrashIcon className="size-3.5" />
              </button>
            </>
          ) : (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => {
                  onColorSelect(note.id, "default");
                  setShowColors(false);
                }}
                title={NOTE_COLOR_LABELS.default}
                className={`size-3.5 rounded-full border bg-card ${
                  !colored ? "ring-2 ring-accent" : "border-muted-foreground/40"
                }`}
              />
              {PICKABLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    onColorSelect(note.id, c);
                    setShowColors(false);
                  }}
                  title={NOTE_COLOR_LABELS[c]}
                  className={`size-3.5 rounded-full ${NOTE_COLOR_CLASSES[c].swatch} ${
                    note.color === c ? "ring-2 ring-offset-1 ring-offset-card ring-accent" : ""
                  }`}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
