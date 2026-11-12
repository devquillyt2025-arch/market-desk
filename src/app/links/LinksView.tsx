"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import { GripVerticalIcon, LinkIcon, PencilIcon, PlusIcon, ReceiptIcon, SearchIcon, TrendingUpIcon } from "@/components/icons";
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

import { LinkCard, toneStyle } from "./LinkCard";
import { LinkModal } from "./LinkModal";
import { isFormDirty, matchesQuery, normalizeUrl, orderGroupNames, toneForGroup, type LinkFormValues } from "./linkMeta";
import { LinksHero } from "./LinksHero";
import { LinksToolbar } from "./LinksToolbar";

const EMPTY_FORM: LinkFormValues = { label: "", url: "", description: "", group: "" };

/** How long the first paint's staggered entrance is allowed to run before cards stop waiting their turn. */
const SETTLE_MS = 900;

function GroupIcon({ name, className }: { name: string; className?: string }) {
  if (name === "Market Data") return <TrendingUpIcon className={className} />;
  if (name === "Exchange & Regulatory") return <ReceiptIcon className={className} />;
  return <LinkIcon className={className} />;
}

export default function LinksView() {
  const [links, setLinks] = useState<LinkItem[] | null>(getCachedLinks);
  /** The add / edit popup. */
  const [modalOpen, setModalOpen] = useState(false);
  const [editMode, setEditMode] = useState(false);
  /** null = the popup (if open) is adding a new link; otherwise the link being edited. */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<LinkFormValues>(EMPTY_FORM);
  /** What the popup opened with - to tell whether closing it would lose anything typed. */
  const [formBaseline, setFormBaseline] = useState<LinkFormValues>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [query, setQuery] = useState("");
  const [activeGroup, setActiveGroup] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  /** Flips true shortly after the first paint, so later arrivals (a filter change, a new link) don't wait for a stagger delay. */
  const [settled, setSettled] = useState(false);

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

  const loaded = links !== null;
  useEffect(() => {
    if (!loaded || settled) return;
    const id = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(id);
  }, [loaded, settled]);

  // "/" jumps to the search box, the way it does on GitHub and most docs sites - unless you're already typing somewhere.
  useEffect(() => {
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const groupNames = useMemo(() => (links ? Array.from(new Set(links.map((link) => link.group))) : []), [links]);
  const orderedGroupNames = useMemo(() => orderGroupNames(groupNames, NECESSARY_LINK_GROUPS), [groupNames]);

  // A filter on a group that has since been renamed or emptied quietly stops applying.
  const effectiveGroup = activeGroup !== null && groupNames.includes(activeGroup) ? activeGroup : null;
  const visibleLinks = useMemo(
    () => (links ?? []).filter((link) => (effectiveGroup === null || link.group === effectiveGroup) && matchesQuery(link, query)),
    [links, effectiveGroup, query],
  );
  const visibleGroupNames = orderedGroupNames.filter((name) => visibleLinks.some((link) => link.group === name));
  const filtering = query.trim() !== "" || effectiveGroup !== null;

  const chips = orderedGroupNames.map((name) => ({
    name,
    tone: toneForGroup(name),
    count: (links ?? []).filter((link) => link.group === name).length,
  }));

  function resetForm() {
    setForm(EMPTY_FORM);
    setFormBaseline(EMPTY_FORM);
    setFormError(null);
    setEditingId(null);
    setModalOpen(false);
  }

  function handleOpenAdd() {
    setForm(EMPTY_FORM);
    setFormBaseline(EMPTY_FORM);
    setFormError(null);
    setEditingId(null);
    setModalOpen(true);
  }

  function handleStartEdit(link: LinkItem) {
    const values = { label: link.label, url: link.url, description: link.description ?? "", group: link.group };
    setEditingId(link.id);
    setForm(values);
    setFormBaseline(values);
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedLabel = form.label.trim();
    const normalizedUrl = normalizeUrl(form.url);

    if (!trimmedLabel || !normalizedUrl) {
      setFormError(!trimmedLabel ? "Enter a name for the link." : "Enter a valid URL.");
      // Put the cursor where the problem is, so it can be fixed without hunting for it.
      document.getElementById(!trimmedLabel ? "link-label" : "link-url")?.focus();
      return;
    }

    const input = {
      label: trimmedLabel,
      url: normalizedUrl,
      description: form.description.trim() || undefined,
      group: form.group.trim() || "My Links",
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

  async function handleCopy(link: LinkItem) {
    try {
      await navigator.clipboard.writeText(link.url);
      showToast(`Copied ${link.label}`, "success");
    } catch {
      showToast("Couldn't copy the link.");
    }
  }

  function clearFilters() {
    setQuery("");
    setActiveGroup(null);
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

  function handleDragOverGroup(e: DragEvent<HTMLElement>, groupName: string) {
    if (!draggedId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (dragOverGroup !== groupName) setDragOverGroup(groupName);
  }

  function handleDropOnGroup(e: DragEvent<HTMLElement>, groupName: string) {
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
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-7"
    >
      <LinksHero
        linkCount={links ? links.length : null}
        groupCount={links ? groupNames.length : null}
        editMode={editMode}
        onToggleEdit={() => setEditMode((prev) => !prev)}
        onAdd={handleOpenAdd}
      />

      {links === null ? (
        <LoadingState className="h-56" label="Loading links…" />
      ) : links.length === 0 ? (
        <div className="relative isolate flex flex-col items-center gap-5 overflow-hidden rounded-3xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 -z-10 bg-[image:radial-gradient(50%_70%_at_50%_0%,color-mix(in_srgb,var(--accent-solid)_16%,transparent),transparent_70%)]"
          />
          {/* Three tiles fanned out, the middle one lifted - the same monogram language as the cards. */}
          <div aria-hidden="true" className="flex items-end">
            <span className="-mr-2 flex size-12 -rotate-6 items-center justify-center rounded-2xl border border-border bg-card text-(--info) shadow-lg">
              <ReceiptIcon className="size-5" />
            </span>
            <span className="relative z-10 flex size-16 items-center justify-center rounded-2xl bg-[image:linear-gradient(145deg,color-mix(in_srgb,var(--accent)_32%,var(--card)),color-mix(in_srgb,var(--accent)_10%,var(--card)))] text-accent shadow-xl ring-1 ring-inset ring-accent/35">
              <LinkIcon className="size-7" />
            </span>
            <span className="-ml-2 flex size-12 rotate-6 items-center justify-center rounded-2xl border border-border bg-card text-(--success) shadow-lg">
              <TrendingUpIcon className="size-5" />
            </span>
          </div>
          <div className="max-w-sm">
            <p className="text-lg font-semibold tracking-tight">Your link library is empty</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Save the sites you check every day - option chains, brokers, news - and they&apos;ll be one click away on every device.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenAdd}
            className="flex min-h-11 items-center gap-2 rounded-xl bg-accent-solid px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--accent-solid)_85%,transparent),inset_0_1px_0_rgba(255,255,255,0.22)] transition-[filter,transform] hover:brightness-110 active:scale-95 sm:min-h-10"
          >
            <PlusIcon className="size-4" />
            Add your first link
          </button>
        </div>
      ) : (
        <>
          <LinksToolbar
            query={query}
            onQuery={setQuery}
            searchRef={searchRef}
            chips={chips}
            total={links.length}
            active={effectiveGroup}
            onActive={setActiveGroup}
            shown={visibleLinks.length}
          />

          {editMode && (
            <p
              role="status"
              className="flex items-start gap-3 rounded-2xl border border-dashed border-accent/40 bg-accent/5 px-4 py-3 text-sm text-muted-foreground"
            >
              <GripVerticalIcon className="mt-0.5 size-4 shrink-0 text-accent" />
              <span>
                <span className="font-medium text-foreground">Edit mode.</span> Drag a card onto another group to move it, or use the pencil to change a link or
                rename a group.
              </span>
            </p>
          )}

          {visibleLinks.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
              <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
                <SearchIcon className="size-5" />
              </span>
              <p className="font-medium">{query.trim() ? `Nothing matches “${query.trim()}”` : "No links in this group"}</p>
              <p className="text-sm text-muted-foreground">Try a different word, or show everything again.</p>
              <button
                type="button"
                onClick={clearFilters}
                className="mt-1 min-h-10 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-10">
              {visibleGroupNames.map((groupName, groupIndex) => {
                const tone = toneForGroup(groupName);
                const items = visibleLinks.filter((link) => link.group === groupName);
                const total = links.filter((link) => link.group === groupName).length;
                const builtIn = NECESSARY_LINK_GROUPS.includes(groupName);
                const headingId = `links-group-${groupIndex}`;

                return (
                  <section
                    key={groupName}
                    aria-labelledby={headingId}
                    style={toneStyle(tone)}
                    onDragOver={(e) => handleDragOverGroup(e, groupName)}
                    onDragLeave={() => setDragOverGroup((prev) => (prev === groupName ? null : prev))}
                    onDrop={(e) => handleDropOnGroup(e, groupName)}
                    className={`-m-3 flex flex-col gap-4 rounded-3xl border border-dashed p-3 transition-colors ${
                      dragOverGroup === groupName ? "border-accent bg-accent/5" : draggedId ? "border-border" : "border-transparent"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--tone)_14%,var(--card))] text-(--tone) ring-1 ring-inset ring-[color-mix(in_srgb,var(--tone)_28%,transparent)]"
                      >
                        <GroupIcon name={groupName} className="size-[18px]" />
                      </span>

                      {renamingGroup === groupName ? (
                        <input
                          ref={groupRenameInputRef}
                          value={groupRenameValue}
                          onChange={(e) => setGroupRenameValue(e.target.value)}
                          onBlur={commitGroupRename}
                          onKeyDown={handleGroupRenameKeyDown}
                          aria-label={`Rename ${groupName}`}
                          autoFocus
                          className="w-full max-w-xs rounded-lg border border-accent bg-card px-3 py-1.5 text-base font-semibold outline-none ring-4 ring-accent/15"
                        />
                      ) : (
                        <h2 id={headingId} className="text-base font-semibold tracking-tight">
                          {groupName}
                        </h2>
                      )}

                      {builtIn && renamingGroup !== groupName && (
                        <span className="rounded-full border border-border px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Built-in</span>
                      )}
                      <span className="font-mono text-xs tabular-nums text-muted-foreground">
                        {items.length === total ? total : `${items.length} of ${total}`}
                      </span>
                      <span
                        aria-hidden="true"
                        className="h-px flex-1 bg-gradient-to-r from-[color-mix(in_srgb,var(--tone)_38%,var(--border))] to-transparent"
                      />

                      {editMode && renamingGroup !== groupName && (
                        <button
                          type="button"
                          onClick={() => handleStartRenameGroup(groupName)}
                          aria-label={`Rename ${groupName}`}
                          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent active:scale-90"
                        >
                          <PencilIcon className="size-4" />
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
                      <AnimatePresence initial={false} mode="popLayout">
                        {items.map((link, index) => (
                          <LinkCard
                            key={link.id}
                            link={link}
                            tone={tone}
                            delay={settled ? 0 : Math.min(groupIndex * 3 + index, 12) * 0.04}
                            editMode={editMode}
                            dragging={draggedId === link.id}
                            onDragStart={handleDragStart}
                            onDragEnd={handleDragEnd}
                            onOpen={(l) => logEvent(`Opened link: ${l.label}`)}
                            onCopy={handleCopy}
                            onEdit={handleStartEdit}
                            onDelete={setPendingDelete}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {filtering && visibleLinks.length > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="self-center rounded-xl px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              Clear filters
            </button>
          )}
        </>
      )}

      <AnimatePresence>
        {modalOpen && (
          <LinkModal
            key="link-modal"
            editing={editingId !== null}
            values={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            groupNames={groupNames}
            error={formError}
            saving={saving}
            dirty={isFormDirty(form, formBaseline)}
            onSubmit={handleSubmit}
            onClose={resetForm}
          />
        )}
      </AnimatePresence>

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
