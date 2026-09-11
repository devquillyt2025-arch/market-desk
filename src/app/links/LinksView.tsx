"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState, type FormEvent } from "react";

import { CheckIcon, ExternalLinkIcon, InboxIcon, PencilIcon, PlusIcon, XIcon } from "@/components/icons";
import { logEvent } from "@/lib/activityLog";
import {
  addLink,
  deleteLink,
  getCachedLinks,
  getLinks,
  NECESSARY_LINK_GROUPS,
  subscribeToLinkChanges,
  type LinkItem,
} from "@/lib/linksStore";
import { showToast } from "@/lib/toast";

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";

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
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");
  const [group, setGroup] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

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

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const trimmedLabel = label.trim();
    const normalizedUrl = normalizeUrl(url);

    if (!trimmedLabel || !normalizedUrl) {
      setFormError(!trimmedLabel ? "Enter a name for the link." : "Enter a valid URL.");
      return;
    }

    setSaving(true);
    try {
      const newLink = await addLink({
        label: trimmedLabel,
        url: normalizedUrl,
        description: description.trim() || undefined,
        group: group.trim() || "My Links",
      });

      setLinks((prev) => (prev ? [...prev, newLink] : [newLink]));
      setLabel("");
      setUrl("");
      setDescription("");
      setGroup("");
      setFormError(null);
      setShowForm(false);
    } catch {
      setFormError("Couldn't save the link. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleDelete(link: LinkItem) {
    const previous = links;
    setLinks((prev) => (prev ? prev.filter((l) => l.id !== link.id) : prev));
    deleteLink(link.id).catch(() => {
      setLinks(previous);
      showToast("Couldn't delete the link. Try again.");
    });
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
            onClick={() => setShowForm((prev) => !prev)}
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
            onSubmit={handleAdd}
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="flex flex-col gap-4 overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6"
          >
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
                {saving ? "Saving…" : "Save Link"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setFormError(null);
                }}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
              >
                Cancel
              </button>
            </div>
          </motion.form>
        )}
      </AnimatePresence>

      {links === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-card" />
          ))}
        </div>
      ) : links.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No links yet. Add one above to get started.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {orderedGroupNames.map((groupName) => (
            <div key={groupName} className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-muted-foreground">{groupName}</h2>
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
                        className="relative rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-accent/50"
                      >
                        {editMode && (
                          <button
                            type="button"
                            onClick={() => handleDelete(link)}
                            aria-label={`Delete ${link.label}`}
                            className="absolute right-2 top-2 flex size-6 items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-loss/10 hover:text-loss active:scale-90"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        )}
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => logEvent(`Opened link: ${link.label}`)}
                          className={`flex flex-col gap-1 ${editMode ? "pr-6" : ""}`}
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
    </motion.div>
  );
}
