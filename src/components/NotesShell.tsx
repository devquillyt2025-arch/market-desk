"use client";

import { AnimatePresence } from "framer-motion";
import { useState } from "react";

import NoteModal from "@/components/NoteModal";
import NotesView, { type NoteEditorContext } from "@/components/NotesView";
import { deleteNote, saveNote } from "@/lib/notesStore";

/**
 * The editor modal is lifted out of NotesView so it survives the view
 * unmounting mid-edit and so anything else in the app could open a note
 * editor later without NotesView needing to be mounted.
 */
export default function NotesShell() {
  const [editorCtx, setEditorCtx] = useState<NoteEditorContext | null>(null);

  return (
    <>
      <NotesView onOpenNoteEditor={setEditorCtx} />
      <AnimatePresence>
        {editorCtx && (
          <NoteModal
            key={editorCtx.note.id}
            note={editorCtx.note}
            isNew={editorCtx.isNew}
            onSave={(note) => {
              void saveNote(note);
            }}
            onClose={() => setEditorCtx(null)}
            onDelete={(id) => {
              void deleteNote(id);
            }}
          />
        )}
      </AnimatePresence>
    </>
  );
}
