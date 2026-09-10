"use client";

import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { CheckIcon, CopyIcon, TrashIcon, XIcon } from "@/components/icons";
import { NOTE_COLOR_CLASSES, NOTE_COLOR_LABELS } from "@/lib/noteColors";
import type { Note, NoteColor } from "@/lib/notesStore";

const PICKABLE_COLORS = Object.keys(NOTE_COLOR_CLASSES) as Exclude<NoteColor, "default">[];

type NoteModalProps = {
  note: Note;
  isNew: boolean;
  onSave: (note: Note) => void;
  onClose: () => void;
  onDelete: (id: string) => void;
};

export default function NoteModal({ note, isNew, onSave, onClose, onDelete }: NoteModalProps) {
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [color, setColor] = useState<NoteColor>(note.color);
  const [pinned, setPinned] = useState(note.pinned);
  const [tags, setTags] = useState<string[]>(note.tags || []);
  const [tagInput, setTagInput] = useState("");
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [copied, setCopied] = useState(false);

  const colorBtnRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    contentRef.current?.focus();
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [content]);

  useEffect(() => {
    if (!showColorPicker) return;
    function close(e: MouseEvent) {
      if (colorBtnRef.current && !colorBtnRef.current.contains(e.target as Node)) {
        setShowColorPicker(false);
      }
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showColorPicker]);

  function handleSave() {
    if (!title.trim() && !content.trim()) {
      onClose();
      return;
    }
    onSave({ ...note, title: title.trim(), content, color, pinned, tags, updatedAt: new Date().toISOString() });
    onClose();
  }

  function addTag(e: React.KeyboardEvent<HTMLInputElement>) {
    if ((e.key === "Enter" || e.key === ",") && tagInput.trim()) {
      e.preventDefault();
      const t = tagInput.trim().replace(/^#/, "").toLowerCase();
      if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
      setTagInput("");
    }
    if (e.key === "Backspace" && !tagInput && tags.length) {
      setTags((prev) => prev.slice(0, -1));
    }
  }

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Clipboard access can be denied (embedded iframe, browser settings); nothing to recover.
    });
  }

  const colorClasses = color !== "default" ? NOTE_COLOR_CLASSES[color as Exclude<NoteColor, "default">] : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/60 p-5"
      onClick={handleSave}
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className={`flex max-h-[88vh] w-full max-w-2xl flex-col overflow-y-auto rounded-2xl border bg-card shadow-2xl ${
          colorClasses ? colorClasses.border : "border-border"
        }`}
      >
        {colorClasses && <div className={`h-1 shrink-0 rounded-t-2xl ${colorClasses.swatch}`} />}

        <div className="shrink-0 px-6 pt-6">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title"
            className="w-full bg-transparent text-lg font-bold text-foreground outline-none placeholder:text-muted-foreground/60"
          />
        </div>

        <hr className="mx-6 mt-4 shrink-0 border-border" />

        <div className="flex flex-1 flex-col">
          <textarea
            ref={contentRef}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Take a note…"
            spellCheck
            className="w-full flex-1 resize-none whitespace-pre-wrap bg-transparent p-6 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/60"
            style={{ minHeight: 150 }}
          />

          <div className="flex flex-wrap items-center gap-1.5 px-6 pb-6">
            {tags.map((t) => (
              <span
                key={t}
                className="flex items-center gap-1 rounded-full bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent"
              >
                #{t}
                <button
                  type="button"
                  onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                  aria-label={`Remove tag ${t}`}
                  className="ml-0.5 text-muted-foreground hover:text-foreground"
                >
                  <XIcon className="size-2.5" />
                </button>
              </span>
            ))}
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={addTag}
              placeholder={tags.length ? "" : "+ add tag"}
              aria-label="Add tag"
              className="min-w-[60px] flex-1 bg-transparent text-xs text-muted-foreground outline-none placeholder:text-muted-foreground/60"
            />
          </div>
        </div>

        <div className="sticky bottom-0 flex shrink-0 items-center justify-between border-t border-border bg-card p-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              title={copied ? "Copied!" : "Copy"}
              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {copied ? <CheckIcon className="size-4 text-profit" /> : <CopyIcon className="size-4" />}
            </button>

            <div ref={colorBtnRef} className="relative">
              <button
                type="button"
                onClick={() => setShowColorPicker((prev) => !prev)}
                title="Change color"
                className={`flex size-6 items-center justify-center rounded-full border ${
                  colorClasses ? `${colorClasses.swatch} border-transparent` : "border-muted-foreground/40 bg-card"
                }`}
              />

              {showColorPicker && (
                <div className="absolute bottom-10 left-0 z-10 flex items-center gap-2 rounded-xl border border-border bg-card p-3 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setColor("default");
                      setShowColorPicker(false);
                    }}
                    title={NOTE_COLOR_LABELS.default}
                    className={`size-6 shrink-0 rounded-full border bg-card ${
                      color === "default" ? "ring-2 ring-offset-2 ring-offset-card ring-accent" : "border-muted-foreground/40"
                    }`}
                  />
                  {PICKABLE_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => {
                        setColor(c);
                        setShowColorPicker(false);
                      }}
                      title={NOTE_COLOR_LABELS[c]}
                      className={`size-6 shrink-0 rounded-full ${NOTE_COLOR_CLASSES[c].swatch} ${
                        color === c ? "ring-2 ring-offset-2 ring-offset-card ring-accent" : ""
                      }`}
                    />
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setPinned((prev) => !prev)}
              aria-pressed={pinned}
              title={pinned ? "Unpin" : "Pin"}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                pinned ? "bg-accent/10 text-accent" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {pinned ? "Pinned" : "Pin"}
            </button>

            {!isNew && (
              <button
                type="button"
                onClick={() => {
                  onDelete(note.id);
                  onClose();
                }}
                title="Delete note"
                className="flex size-8 items-center justify-center rounded-md text-loss transition-colors hover:bg-loss/10"
              >
                <TrashIcon className="size-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-accent-foreground transition-opacity hover:opacity-90"
          >
            Done
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
