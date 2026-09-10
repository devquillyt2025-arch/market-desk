/**
 * Local-only persistence for notes. Same shape as tradeStore.ts/linksStore.ts:
 * async API over localStorage so a real backend can replace the body later
 * without touching call sites, plus activity logging on every mutation since
 * this app already has a Logs tab that expects to see everything.
 */

import { logEvent } from "@/lib/activityLog";

const STORAGE_KEY = "marketdesk:notes";
const CHANGE_EVENT = "marketdesk-notes-changed";

export const NOTE_COLORS = [
  "default",
  "red",
  "orange",
  "yellow",
  "green",
  "teal",
  "blue",
  "purple",
  "pink",
] as const;

export type NoteColor = (typeof NOTE_COLORS)[number];

export type Note = {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
};

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `note_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function readAll(): Note[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(notes: Note[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(notes));
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // window.dispatchEvent can throw in locked-down embeds; the write itself already succeeded.
  }
}

export function newNote(overrides: Partial<Note> = {}): Note {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    title: "",
    content: "",
    color: "default",
    pinned: false,
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export async function getNotes(): Promise<Note[]> {
  return readAll();
}

export async function saveNote(note: Note): Promise<Note[]> {
  const prev = readAll();
  const exists = prev.some((n) => n.id === note.id);
  const updated = exists ? prev.map((n) => (n.id === note.id ? note : n)) : [note, ...prev];
  writeAll(updated);
  logEvent(`${exists ? "Updated" : "Created"} note: ${note.title || "Untitled"}`);
  return updated;
}

export async function deleteNote(id: string): Promise<void> {
  const prev = readAll();
  const note = prev.find((n) => n.id === id);
  writeAll(prev.filter((n) => n.id !== id));
  if (note) logEvent(`Deleted note: ${note.title || "Untitled"}`);
}

export async function setNotePinned(id: string, pinned: boolean): Promise<Note[]> {
  const prev = readAll();
  const note = prev.find((n) => n.id === id);
  const updated = prev.map((n) =>
    n.id === id ? { ...n, pinned, updatedAt: new Date().toISOString() } : n,
  );
  writeAll(updated);
  if (note) logEvent(`${pinned ? "Pinned" : "Unpinned"} note: ${note.title || "Untitled"}`);
  return updated;
}

export async function setNoteColor(id: string, color: NoteColor): Promise<Note[]> {
  const prev = readAll();
  const updated = prev.map((n) =>
    n.id === id ? { ...n, color, updatedAt: new Date().toISOString() } : n,
  );
  writeAll(updated);
  return updated;
}

/** Keeps multiple open tabs/windows in sync — cheap and safe to always include. */
export function subscribeToNoteChanges(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, callback);
  return () => window.removeEventListener(CHANGE_EVENT, callback);
}
