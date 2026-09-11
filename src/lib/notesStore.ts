/**
 * Supabase-backed persistence for notes. `Note` (app-facing, camelCase) and
 * `NoteRow` (the `notes` table, snake_case like every other table) differ in
 * shape because `Note` predates the Supabase-backed table — fromRow/toRow
 * translate between them so the rest of the app never has to know.
 */

import { logEvent } from "@/lib/activityLog";
import { createClient } from "@/lib/supabase/client";
import { NOTE_COLORS, type Note, type NoteColor, type NoteRow } from "@/lib/types";

export { NOTE_COLORS, type Note, type NoteColor };

const supabase = createClient();

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `note_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function fromRow(row: NoteRow): Note {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    color: row.color,
    pinned: row.pinned,
    tags: row.tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRow(note: Note): Omit<NoteRow, "user_id"> {
  return {
    id: note.id,
    title: note.title,
    content: note.content,
    color: note.color,
    pinned: note.pinned,
    tags: note.tags,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  };
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
  const { data, error } = await supabase
    .from("notes")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export async function saveNote(note: Note): Promise<void> {
  const { data: existing } = await supabase.from("notes").select("id").eq("id", note.id).maybeSingle();
  const { error } = await supabase.from("notes").upsert(toRow(note), { onConflict: "id" });
  if (error) throw error;
  logEvent(`${existing ? "Updated" : "Created"} note: ${note.title || "Untitled"}`);
}

export async function deleteNote(id: string): Promise<void> {
  const { data: note, error } = await supabase.from("notes").delete().eq("id", id).select().maybeSingle();
  if (error) throw error;
  if (note) logEvent(`Deleted note: ${note.title || "Untitled"}`);
}

export async function setNotePinned(id: string, pinned: boolean): Promise<void> {
  const { data: note, error } = await supabase
    .from("notes")
    .update({ pinned, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (note) logEvent(`${pinned ? "Pinned" : "Unpinned"} note: ${note.title || "Untitled"}`);
}

export async function setNoteColor(id: string, color: NoteColor): Promise<void> {
  const { error } = await supabase
    .from("notes")
    .update({ color, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Keeps every open session in sync — other tabs, other devices — via
 * Supabase Realtime instead of the localStorage-era same-tab change event.
 */
export function subscribeToNoteChanges(callback: () => void): () => void {
  const channel = supabase
    .channel("notes-changes")
    .on("postgres_changes", { event: "*", schema: "public", table: "notes" }, () => {
      callback();
    })
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
