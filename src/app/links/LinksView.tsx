"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";

import {
  CheckIcon,
  ExternalLinkIcon,
  GripVerticalIcon,
  InboxIcon,
  PencilIcon,
  PlusIcon,
  XIcon,
} from "@/components/icons";
import ConfirmDialog from "@/components/ConfirmDialog";
import LoadingState from "@/components/LoadingState";
import { logEvent } from "@/lib/activityLog";
import {
  addLink,
  deleteLink,
  getCachedLinks,
  getLinks,
  moveLink,
  NECESSARY_LINK_GROUPS,
  renameLinkGroup,
  subscribeToLinkChanges,
  updateLink,
  type LinkItem,
} from "@/lib/linksStore";
import { showToast } from "@/lib/toast";

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";

const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

function normalizeUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const withScheme = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    return new URL(withScheme).toString();
  } catch {
    return null;
  }
}

export default function LinksView() {
  const [links, setLinks] = useState<LinkItem[] | null>(getCachedLinks);
  const [showForm, setShowForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  /** null = the form (if open) is adding a new link; otherwise the link being edited. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [group, setGroup] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pendingDelete, setPendingDelete] = useState<LinkItem | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [renamingGroup, setRenamingGroup] = useState<string | null>(null);
  const [groupRenameValue, setGroupRenameValue] = useState("");
  const groupRenameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      try {
        setLinks(await getLinks());
      } catch {
        showToast("Couldn't load links. Check your connection.");
      }
    }
    load();
    return subscribeToLinkChanges(load);
  }, []);

  const groupNames = links ? Array.from(new Set(links.map((link) => link.group))) : [];
  // Custom groups first, built-in/necessary groups (Market Data, Exchange & Regulatory) last.
  const orderedGroupNames = [
    ...groupNames.filter((g) => !NECESSARY_LINK_GROUPS.includes(g)),
    ...groupNames.filter((g) => NECESSARY_LINK_GROUPS.includes(g)),
  ];

  function resetForm() {
    setLabel("");
    setUrl("");
    setDescription("");
    setGroup("");
    setFormError(null);
    setEditingId(null);
    setShowForm(false);
  }

  function handleStartEdit(link: LinkItem) {
    setEditingId(link.id);
    setLabel(link.label);
    setUrl(link.url);
    setDescription(link.description ?? "");
    setGroup(link.group);
    setFormError(null);
    setShowForm(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedLabel = label.trim();
    const normalizedUrl = normalizeUrl(url);

    if (!trimmedLabel || !normalizedUrl) {
      setFormError(!trimmedLabel ? "Enter a name for the link." : "Enter a valid URL.");
      return;
    }

    const input = {
      label: trimmedLabel,
      url: normalizedUrl,
      description: description.trim() || undefined,
      group: group.trim() || "My Links",
    };

    setSaving(true);
    try {
      if (editingId) {
        const updated = await updateLink(editingId, input);
        setLinks((prev) => (prev ? prev.map((l) => (l.id === editingId ? updated : l)) : prev));
      } else {
        const newLink = await addLink(input);
        setLinks((prev) => (prev ? [...prev, newLink] : [newLink]));
      }
      resetForm();
    } catch {
      setFormError(editingId ? "Couldn't save changes. Try again." : "Couldn't save the link. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function requestDelete(link: LinkItem) {
    setPendingDelete(link);
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const link = pendingDelete;
    setPendingDelete(null);
    if (editingId === link.id) resetForm();

    const previous = links;
    setLinks((prev) => (prev ? prev.filter((l) => l.id !== link.id) : prev));
    deleteLink(link.id).catch(() => {
      setLinks(previous);
      showToast("Couldn't delete the link. Try again.");
    });
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>, link: LinkItem) {
    setDraggedId(link.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", link.id);
  }

  function handleDragEnd() {
    setDraggedId(null);
    setDragOverGroup(null);
  }

  function handleDragOverGroup(e: DragEvent<HTMLDivElement>, groupName: string) {
    if (!draggedId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverGroup !== groupName) setDragOverGroup(groupName);
  }

  function handleDropOnGroup(e: DragEvent<HTMLDivElement>, groupName: string) {
    e.preventDefault();
    const id = draggedId ?? e.dataTransfer.getData("text/plain");
    setDraggedId(null);
    setDragOverGroup(null);
    if (!id) return;

    const link = links?.find((l) => l.id === id);
    if (!link || link.group === groupName) return;

    const previous = links;
    setLinks((prev) => (prev ? prev.map((l) => (l.id === id ? { ...l, group: groupName } : l)) : prev));
    moveLink(id, groupName).catch(() => {
      setLinks(previous);
      showToast("Couldn't move the link. Try again.");
    });
  }

  function handleStartRenameGroup(groupName: string) {
    setRenamingGroup(groupName);
    setGroupRenameValue(groupName);
    requestAnimationFrame(() => groupRenameInputRef.current?.select());
  }

  function commitGroupRename() {
    const oldName = renamingGroup;
    const newName = groupRenameValue.trim();
    setRenamingGroup(null);
    if (!oldName || !newName || newName === oldName) return;

    const previous = links;
    setLinks((prev) => (prev ? prev.map((l) => (l.group === oldName ? { ...l, group: newName } : l)) : prev));
    renameLinkGroup(oldName, newName).catch(() => {
      setLinks(previous);
      showToast("Couldn't rename the group. Try again.");
    });
  }

  function handleGroupRenameKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") commitGroupRename();
    if (e.key === "Escape") setRenamingGroup(null);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Important Links</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quick access to market data and reference sites, synced across devices — add your own below.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditMode((prev) => !prev)}
            className={
              editMode
                ? "flex items-center gap-1.5 rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 active:scale-95"
                : "flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            }
          >
            {editMode ? <CheckIcon className="size-4" /> : <PencilIcon className="size-4" />}
            {editMode ? "Done" : "Edit"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (showForm) {
                resetForm();
              } else {
                setEditingId(null);
                setShowForm(true);
              }
            }}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 active:scale-95"
          >
            <PlusIcon className="size-4" />
            Add Link
          </button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {showForm && (
          <motion.form
            key="link-form"
            onSubmit={handleSubmit}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-4 overflow-hidden rounded-xl border border-border bg-background p-5 sm:p-6"
          >
            <h2 className="text-sm font-medium">{editingId ? "Edit Link" : "New Link"}</h2>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <label htmlFor="link-label" className={labelClass}>
                  Name
                </label>
                <input
                  id="link-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="e.g. Sensibull"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="link-url" className={labelClass}>
                  URL
                </label>
                <input
                  id="link-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="example.com"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="link-description" className={labelClass}>
                  Description (optional)
                </label>
                <input
                  id="link-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this link is for"
                  className={inputClass}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="link-group" className={labelClass}>
                  Group (optional)
                </label>
                <input
                  id="link-group"
                  value={group}
                  onChange={(e) => setGroup(e.target.value)}
                  placeholder="My Links"
                  list="link-groups"
                  className={inputClass}
                />
                <datalist id="link-groups">
                  {groupNames.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </div>
            </div>

            {formError && <p className="text-sm text-loss">{formError}</p>}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60 active:scale-95"
              >
                {saving ? "Saving…" : editingId ? "Save Changes" : "Save Link"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                Cancel
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {links === null ? (
        <LoadingState className="h-48" label="Loading links…" />
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-10 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No links yet. Add one above to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {orderedGroupNames.map((groupName) => (
            <div
              key={groupName}
              onDragOver={(e) => handleDragOverGroup(e, groupName)}
              onDragLeave={() => setDragOverGroup((prev) => (prev === groupName ? null : prev))}
              onDrop={(e) => handleDropOnGroup(e, groupName)}
              className={`flex flex-col gap-3 rounded-xl border border-dashed p-2 transition-colors ${
                dragOverGroup === groupName ? "border-accent bg-accent/5" : "border-transparent"
              }`}
            >
              {renamingGroup === groupName ? (
                <input
                  ref={groupRenameInputRef}
                  value={groupRenameValue}
                  onChange={(e) => setGroupRenameValue(e.target.value)}
                  onBlur={commitGroupRename}
                  onKeyDown={handleGroupRenameKeyDown}
                  autoFocus
                  className="w-fit max-w-xs rounded-md border border-accent bg-card px-2 py-0.5 text-sm font-medium outline-none"
                />
              ) : (
                <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  {groupName}
                  {editMode && (
                    <button
                      type="button"
                      onClick={() => handleStartRenameGroup(groupName)}
                      aria-label={`Rename ${groupName}`}
                      className="flex size-5 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent/10 hover:text-accent active:scale-90"
                    >
                      <PencilIcon className="size-3" />
                    </button>
                  )}
                </h2>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <AnimatePresence initial={false} mode="popLayout">
                  {links
                    .filter((link) => link.group === groupName)
                    .map((link) => (
                      <motion.div
                        key={link.id}
                        layout
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                        whileHover={{ y: -2 }}
                        draggable={editMode}
                        // Capture-phase native handlers — framer-motion's own `onDragStart`/`onDragEnd`
                        // props are reserved for its pointer-based drag gesture (only active when the
                        // `drag` prop is set), so they'd silently swallow these native HTML5 DnD events.
                        onDragStartCapture={(e) => handleDragStart(e, link)}
                        onDragEndCapture={handleDragEnd}
                        className={`relative rounded-xl border border-border bg-background p-4 transition-colors hover:border-accent/50 ${
                          editMode ? "cursor-grab active:cursor-grabbing" : ""
                        } ${draggedId === link.id ? "opacity-40" : ""}`}
                      >
                        {editMode && (
                          <div className="absolute right-2 top-2 flex items-center gap-1">
                            <GripVerticalIcon className="size-3.5 text-muted-foreground/40" />
                            <button
                              type="button"
                              onClick={() => handleStartEdit(link)}
                              aria-label={`Edit ${link.label}`}
                              className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-accent/10 hover:text-accent active:scale-90"
                            >
                              <PencilIcon className="size-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => requestDelete(link)}
                              aria-label={`Delete ${link.label}`}
                              className="flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-loss/10 hover:text-loss active:scale-90"
                            >
                              <XIcon className="size-3.5" />
                            </button>
                          </div>
                        )}
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => {
                            if (editMode) e.preventDefault();
                            else logEvent(`Opened link: ${link.label}`);
                          }}
                          className={`flex flex-col gap-1 ${editMode ? "pr-16" : ""}`}
                        >
                          <span className="flex items-center gap-1.5 font-medium">
                            {link.label}
                            <ExternalLinkIcon className="size-3.5 shrink-0 text-muted-foreground" />
                          </span>
                          {link.description && (
                            <span className="text-sm text-muted-foreground">{link.description}</span>
                          )}
                        </a>
                      </motion.div>
                    ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {pendingDelete && (
          <ConfirmDialog
            title="Delete this link?"
            message={`"${pendingDelete.label}" will be removed for every device — this can't be undone.`}
            onConfirm={confirmDelete}
            onCancel={() => setPendingDelete(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
