"use client";

import { AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { ChevronDownIcon, GridIcon, InboxIcon, ListIcon, PlusIcon, SearchIcon } from "@/components/icons";
import NoteCard from "@/components/NoteCard";
import { NOTE_COLOR_CLASSES, NOTE_COLOR_LABELS } from "@/lib/noteColors";
import {
  deleteNote,
  getNotes,
  newNote,
  NOTE_COLORS,
  setNoteColor,
  setNotePinned,
  subscribeToNoteChanges,
  type Note,
  type NoteColor,
} from "@/lib/notesStore";

const PICKABLE_COLORS = NOTE_COLORS.filter(
  (c): c is Exclude<NoteColor, "default"> => c !== "default",
);

type ViewMode = "grid" | "list";
type SortOrder = "updated" | "oldest" | "alpha";

export type NoteEditorContext = {
  note: Note;
  isNew: boolean;
};

type NotesViewProps = {
  onOpenNoteEditor: (ctx: NoteEditorContext) => void;
};

const gridClass = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";
const listClass = "flex flex-col gap-2.5";

export default function NotesView({ onOpenNoteEditor }: NotesViewProps) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [activeColor, setActiveColor] = useState<NoteColor | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>("updated");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");

  useEffect(() => {
    getNotes().then(setNotes);
    return subscribeToNoteChanges(() => {
      getNotes().then(setNotes);
    });
  }, []);

  function openNew() {
    onOpenNoteEditor({ note: newNote(), isNew: true });
  }

  function openEdit(note: Note) {
    onOpenNoteEditor({ note, isNew: false });
  }

  function handlePin(id: string) {
    const current = notes?.find((n) => n.id === id);
    const nextPinned = !(current?.pinned ?? false);
    setNotes((prev) => (prev ? prev.map((n) => (n.id === id ? { ...n, pinned: nextPinned } : n)) : prev));
    void setNotePinned(id, nextPinned);
  }

  function handleDelete(id: string) {
    setNotes((prev) => (prev ? prev.filter((n) => n.id !== id) : prev));
    void deleteNote(id);
  }

  function handleColorSelect(id: string, color: NoteColor) {
    setNotes((prev) => (prev ? prev.map((n) => (n.id === id ? { ...n, color } : n)) : prev));
    void setNoteColor(id, color);
  }

  const allTags = useMemo(() => {
    const set = new Set<string>();
    notes?.forEach((n) => n.tags.forEach((t) => set.add(t)));
    return [...set].sort();
  }, [notes]);

  const filtered = useMemo(() => {
    if (!notes) return [];
    let result = [...notes];
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (n) =>
          n.title.toLowerCase().includes(q) ||
          n.content.toLowerCase().includes(q) ||
          n.tags.some((t) => t.toLowerCase().includes(q)),
      );
    }
    if (activeTag) result = result.filter((n) => n.tags.includes(activeTag));
    if (activeColor) result = result.filter((n) => n.color === activeColor);

    if (sortOrder === "alpha") {
      result.sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortOrder === "oldest") {
      result.sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
    } else {
      result.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
    return result;
  }, [notes, search, activeTag, activeColor, sortOrder]);

  const pinned = filtered.filter((n) => n.pinned);
  const unpinned = filtered.filter((n) => !n.pinned);
  const isFiltered = Boolean(search.trim() || activeTag || activeColor);
  const containerClass = viewMode === "grid" ? gridClass : listClass;

  function clearFilters() {
    setSearch("");
    setActiveTag(null);
    setActiveColor(null);
  }

  function renderCards(list: Note[]) {
    return (
      <div className={containerClass}>
        <AnimatePresence mode="popLayout">
          {list.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              viewMode={viewMode}
              onOpen={openEdit}
              onPin={handlePin}
              onDelete={handleDelete}
              onColorSelect={handleColorSelect}
            />
          ))}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes..."
            className="w-full rounded-lg border border-border bg-background py-2 pl-8 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30"
          />
        </div>

        <button
          type="button"
          onClick={openNew}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
        >
          <PlusIcon className="size-4" />
          New Note
        </button>

        <div className="flex items-center gap-1 rounded-full border border-border bg-muted p-1">
          <button
            type="button"
            onClick={() => setActiveColor(null)}
            title="All colors"
            className={`flex size-6 items-center justify-center rounded-full bg-card text-accent transition-shadow ${
              !activeColor ? "ring-2 ring-accent" : ""
            }`}
          >
            {!activeColor && (
              <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth={3}>
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
          {PICKABLE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              title={NOTE_COLOR_LABELS[c]}
              onClick={() => setActiveColor((prev) => (prev === c ? null : c))}
              className={`size-6 rounded-full ${NOTE_COLOR_CLASSES[c].swatch} transition-transform ${
                activeColor === c ? "scale-110 ring-2 ring-offset-1 ring-offset-card ring-accent" : "opacity-80 hover:opacity-100"
              }`}
            />
          ))}
        </div>

        <div className="relative">
          <select
            value={activeTag ?? "all"}
            onChange={(e) => setActiveTag(e.target.value === "all" ? null : e.target.value)}
            className="h-9 appearance-none rounded-lg border border-border bg-background py-2 pl-3 pr-8 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          >
            <option value="all">All Tags</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </select>
          <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>

        <div className="relative">
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value as SortOrder)}
            className="h-9 appearance-none rounded-lg border border-border bg-background py-2 pl-3 pr-8 text-sm text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
          >
            <option value="updated">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="alpha">A–Z</option>
          </select>
          <ChevronDownIcon className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>

        <div className="flex overflow-hidden rounded-lg border border-border">
          <button
            type="button"
            onClick={() => setViewMode("grid")}
            title="Grid view"
            className={`flex size-8 items-center justify-center transition-colors ${
              viewMode === "grid" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <GridIcon className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("list")}
            title="List view"
            className={`flex size-8 items-center justify-center transition-colors ${
              viewMode === "list" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            <ListIcon className="size-3.5" />
          </button>
        </div>

        <span className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
          {notes === null ? "" : isFiltered ? `${filtered.length} of ${notes.length} entries` : `${notes.length} entries`}
        </span>
      </div>

      {notes === null ? (
        <div className={containerClass}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-[182px] animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <div>
            <p className="font-semibold text-foreground">Capture your first note</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Ideas, reminders, and things worth remembering — all in one place.
            </p>
          </div>
          <button
            type="button"
            onClick={openNew}
            className="mt-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
          >
            New Note
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-12 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <p className="font-medium text-foreground">No notes match your search</p>
          <button
            type="button"
            onClick={clearFilters}
            className="text-sm font-medium text-accent underline underline-offset-2"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {pinned.length > 0 && (
            <div className="flex flex-col gap-3">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pinned</h2>
              {renderCards(pinned)}
            </div>
          )}
          {unpinned.length > 0 && (
            <div className="flex flex-col gap-3">
              {pinned.length > 0 && (
                <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {isFiltered ? "Results" : "Others"}
                </h2>
              )}
              {renderCards(unpinned)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
