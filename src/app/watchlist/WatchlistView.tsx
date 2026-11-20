"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";

import ConfirmDialog from "@/components/ConfirmDialog";
import { AlertCircleIcon, ArrowUpDownIcon, ChevronDownIcon, EyeIcon, PlusIcon } from "@/components/icons";
import LivePricingBanners from "@/components/LivePricingBanners";
import LoadingState from "@/components/LoadingState";
import { isMarketOpen } from "@/lib/averaging";
import { GLOBAL_TOP_YAHOO_IDS } from "@/lib/globalIndicesTable";
import { showToast } from "@/lib/toast";
import { useWatchlistQuotes } from "@/lib/useWatchlistQuotes";
import { useWorldIndices } from "@/lib/useWorldIndices";
import {
  DEFAULT_WATCHLIST,
  KIND_LABELS,
  SORT_LABELS,
  WATCHLIST_KINDS,
  changedPositions,
  describeSort,
  marketBreadth,
  matchesView,
  moveDirection,
  moveItem,
  nextSort,
  nextSortOrder,
  parseSort,
  parseWatchTab,
  sortItems,
  withSortOrder,
  type Mover,
  type SortKey,
  type SortState,
  type WatchSearchResult,
  type WatchTab,
  type WatchlistItem,
  type WatchlistKind,
} from "@/lib/watchlist";
import {
  WATCHLIST_MIGRATION,
  WatchlistStorageMissingError,
  addWatchlistItem,
  getCachedWatchlist,
  getWatchlist,
  removeWatchlistItem,
  saveWatchlistOrder,
  subscribeToWatchlistChanges,
} from "@/lib/watchlistStore";

import { AddInstrumentModal } from "./AddInstrumentModal";
import { GlobalPulse } from "./GlobalPulse";
import { GlobalTab } from "./GlobalTab";
import { MarketPulse } from "./MarketPulse";
import { WATCH_COLUMNS, WatchRow } from "./WatchRow";
import { WatchTabs, watchPanelId, watchTabId } from "./WatchTabs";
import { WatchToolbar, type KindChip } from "./WatchToolbar";
import { WatchlistHero } from "./WatchlistHero";

/** Where this device remembers how the list is sorted. A preference about the view, so it stays on the device, like the other tabs' prefs. */
const SORT_STORAGE_KEY = "marketdesk:watchlist-sort";
/** Where this device remembers which tab the page was last on. */
const TAB_STORAGE_KEY = "marketdesk:watchlist-tab";
/** The only world indices this page shows (the Global indices table's Yahoo eight) - asked for by name, rather than the whole world's. */
const HEADLINE_WORLD_IDS = [...GLOBAL_TOP_YAHOO_IDS];

/** A column header that sorts: click for its natural order, again to reverse, again to go back to your own order. */
function SortHeader({ sortKey, sort, onSort }: { sortKey: SortKey; sort: SortState | null; onSort: (next: SortState | null) => void }) {
  const active = sort?.key === sortKey ? sort : null;
  return (
    <button
      type="button"
      onClick={() => onSort(nextSort(sort, sortKey))}
      aria-pressed={active !== null}
      aria-label={active ? `Sort by ${SORT_LABELS[sortKey]}. Now: ${describeSort(active)}. Click to change.` : `Sort by ${SORT_LABELS[sortKey]}`}
      className={`group/header -mx-1.5 flex w-fit items-center gap-1.5 rounded-md px-1.5 py-0.5 uppercase tracking-wide transition-colors hover:text-foreground ${active ? "text-foreground" : ""}`}
    >
      {SORT_LABELS[sortKey]}
      {active ? (
        <ChevronDownIcon className={`size-3.5 transition-transform duration-200 ${active.dir === "asc" ? "rotate-180" : ""}`} />
      ) : (
        <ArrowUpDownIcon className="size-3.5 opacity-0 transition-opacity group-hover/header:opacity-60 group-focus-visible/header:opacity-60" />
      )}
    </button>
  );
}

/** The starting list with throwaway ids - what shows, read-only, before the watchlist table exists. */
function startingList(): WatchlistItem[] {
  return DEFAULT_WATCHLIST.map((seed, i) => ({ ...seed, id: `starting-${i}` }));
}

/** The picked instrument, as the row to save - at the end of the list. */
function seedFor(result: WatchSearchResult, items: readonly WatchlistItem[]) {
  return { kind: result.kind, itemKey: result.itemKey, symbol: result.symbol, name: result.name, sortOrder: nextSortOrder(items) };
}

export default function WatchlistView() {
  const [items, setItems] = useState<WatchlistItem[] | null>(getCachedWatchlist);
  /** The table isn't there (the migration hasn't been run): the starting list shows, but can't be changed. */
  const [storageMissing, setStorageMissing] = useState(false);
  const [filter, setFilter] = useState<WatchlistKind | null>(null);
  /** What is typed in the filter box, and the gainers / losers chip. */
  const [text, setText] = useState("");
  const [mover, setMover] = useState<Mover | null>(null);
  /** How the rows are ordered on screen; null is the saved order. Only a view - the saved order is never touched by it. */
  const [sort, setSort] = useState<SortState | null>(null);
  const [sortLoaded, setSortLoaded] = useState(false);
  /** Indian markets (the saved list) or Global markets (the headline indices, and the prices MCX follows). */
  const [tab, setTab] = useState<WatchTab>("india");
  const [tabLoaded, setTabLoaded] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [editMode, setEditMode] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<WatchlistItem | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  /** Said to a screen reader after a reorder - the list moving is not otherwise announced. */
  const [announcement, setAnnouncement] = useState("");
  const [now, setNow] = useState(() => Date.now());
  /** After a move, the control that had focus (`<item id>:<grip|up|down>`) - re-focused once the rows have been reordered. */
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const next = await getWatchlist();
        if (!active) return;
        setItems(next);
        setStorageMissing(false);
      } catch (e) {
        if (!active) return;
        if (e instanceof WatchlistStorageMissingError) {
          setStorageMissing(true);
          setItems((prev) => prev ?? startingList());
        } else {
          showToast("Couldn't load the watchlist. Check your connection.");
        }
      }
    }
    void load();
    const unsubscribe = subscribeToWatchlistChanges(() => void load());
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // The remembered sort is read after mount rather than in the state initialiser: localStorage doesn't exist while the
  // page is rendered on the server, and reading it there would hydrate with a mismatch.
  useEffect(() => {
    try {
      const saved = parseSort(JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? "null"));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setSort(saved);
    } catch {
      // Storage unavailable or holding something else: start in the saved order.
    }
    setSortLoaded(true);
  }, []);

  useEffect(() => {
    if (!sortLoaded) return; // don't overwrite what's saved with the empty default before it has been read
    try {
      if (sort) localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify(sort));
      else localStorage.removeItem(SORT_STORAGE_KEY);
    } catch {
      // Storage may be unavailable or full; the sort just won't be remembered.
    }
  }, [sort, sortLoaded]);

  // The tab last used is remembered on this device. Read after mount for the same reason as the sort: no localStorage while rendering on the server.
  useEffect(() => {
    try {
      const saved = parseWatchTab(localStorage.getItem(TAB_STORAGE_KEY));
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setTab(saved);
    } catch {
      // Storage unavailable: start on the Indian markets.
    }
    setTabLoaded(true);
  }, []);

  useEffect(() => {
    if (!tabLoaded) return; // don't overwrite what's saved with the default before it has been read
    try {
      localStorage.setItem(TAB_STORAGE_KEY, tab);
    } catch {
      // Storage may be unavailable or full; the tab just won't be remembered.
    }
  }, [tab, tabLoaded]);

  // "/" jumps to the filter box, as it does on the Important Links page - unless you are already typing somewhere, or the box isn't on screen.
  useEffect(() => {
    function handleKey(e: globalThis.KeyboardEvent) {
      if (tab !== "india") return;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [tab]);

  // The session pills need the time, but only to the minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Upstox quotes are only polled while the Indian markets tab is showing - the global prices run on their own feeds.
  const live = useWatchlistQuotes(tab === "india" ? items : null);
  const stale = live.tokenExpired || live.offline || live.loadError !== null;
  // The world index levels (Yahoo) feed the headline table on Global markets, so they are polled only while that tab shows.
  const world = useWorldIndices(undefined, tab === "global", { ids: HEADLINE_WORLD_IDS });

  const kindsPresent = WATCHLIST_KINDS.filter((kind) => items?.some((item) => item.kind === kind));
  // A filter on a kind that has since been emptied quietly stops applying.
  const activeFilter = filter !== null && kindsPresent.includes(filter) ? filter : null;
  // What the kind chips and the filter box leave - before the gainers / losers chip, so that chip can show how many of each there are.
  const afterKindAndText = useMemo(
    () => (items ?? []).filter((item) => (activeFilter === null || item.kind === activeFilter) && matchesView(item, live.quotes[item.itemKey], { text, mover: null })),
    [items, activeFilter, text, live.quotes],
  );
  const moverCounts = useMemo(() => {
    const counts = { up: 0, down: 0 };
    for (const item of afterKindAndText) {
      const quote = live.quotes[item.itemKey];
      const direction = quote ? moveDirection(quote.changePct) : "flat";
      if (direction === "up") counts.up++;
      else if (direction === "down") counts.down++;
    }
    return counts;
  }, [afterKindAndText, live.quotes]);
  /** The rows on screen: filtered, then sorted. A sort reorders only this - never `items`. */
  const visible = useMemo(
    () =>
      sortItems(
        afterKindAndText.filter((item) => matchesView(item, live.quotes[item.itemKey], { text: "", mover })),
        live.quotes,
        sort,
      ),
    [afterKindAndText, live.quotes, mover, sort],
  );
  const reorderLocked = sort !== null;
  const kindChips: KindChip[] = [
    { kind: null, label: "All", count: items?.length ?? 0 },
    ...kindsPresent.map((kind) => ({ kind, label: KIND_LABELS[kind], count: (items ?? []).filter((item) => item.kind === kind).length })),
  ];
  const listedKeys = useMemo(() => new Set((items ?? []).map((item) => item.itemKey)), [items]);
  const breadth = marketBreadth((items ?? []).map((item) => live.quotes[item.itemKey]));

  // --- Order -----------------------------------------------------------------

  function commitOrder(next: WatchlistItem[], message: string) {
    if (!items) return;
    const renumbered = withSortOrder(next);
    const changed = changedPositions(items, renumbered);
    if (changed.length === 0) return;
    const previous = items;
    setItems(renumbered);
    setAnnouncement(message);
    saveWatchlistOrder(changed).catch(() => {
      setItems(previous);
      showToast("Couldn't save the new order. Try again.");
    });
  }

  function applySort(next: SortState | null) {
    setSort(next);
    setAnnouncement(next ? `Sorted by ${describeSort(next)}.` : "Back to your own order.");
  }

  function clearFilters() {
    setText("");
    setMover(null);
    setFilter(null);
  }

  function handleMove(item: WatchlistItem, direction: -1 | 1, via: "grip" | "up" | "down") {
    if (!items || reorderLocked) return;
    // With a filter on, "up" means past the previous row *shown* - which may not be the previous in the full list.
    const neighbour = visible[visible.findIndex((v) => v.id === item.id) + direction];
    if (!neighbour) return;
    const next = moveItem(items, items.findIndex((i) => i.id === item.id), items.findIndex((i) => i.id === neighbour.id));
    pendingFocus.current = `${item.id}:${via}`;
    commitOrder(next, `${item.name} moved to position ${next.findIndex((i) => i.id === item.id) + 1} of ${next.length}.`);
  }

  // Moving a row re-inserts its DOM node, which drops keyboard focus - hand it back to the control that had it, or to its
  // sibling if that one is now disabled (a row at the very top has no "up").
  useEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    pendingFocus.current = null;
    const [id, via] = key.split(":");
    const find = (which: string) => document.querySelector<HTMLButtonElement>(`[data-focus-id="${id}:${which}"]`);
    const target = [find(via), find(via === "up" ? "down" : "up"), find("grip")].find((el) => el && !el.disabled);
    target?.focus();
  }, [items]);

  function handleDragStart(e: DragEvent<HTMLLIElement>, item: WatchlistItem) {
    if (reorderLocked) {
      e.preventDefault();
      return;
    }
    setDraggedId(item.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", item.id);
  }

  function handleDragOver(e: DragEvent<HTMLLIElement>, item: WatchlistItem) {
    if (!draggedId || draggedId === item.id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (overId !== item.id) setOverId(item.id);
  }

  function handleDrop(e: DragEvent<HTMLLIElement>, target: WatchlistItem) {
    e.preventDefault();
    const id = draggedId ?? e.dataTransfer.getData("text/plain");
    setDraggedId(null);
    setOverId(null);
    if (!id || id === target.id || !items) return;
    const moved = items.find((i) => i.id === id);
    if (!moved) return;
    const next = moveItem(items, items.findIndex((i) => i.id === id), items.findIndex((i) => i.id === target.id));
    commitOrder(next, `${moved.name} moved to position ${next.findIndex((i) => i.id === id) + 1} of ${next.length}.`);
  }

  function handleDragEnd() {
    setDraggedId(null);
    setOverId(null);
  }

  /** The line that shows where a dragged row would land: below the row you are over if you are dragging down, above it if up. */
  function dropEdgeFor(item: WatchlistItem): "before" | "after" | null {
    if (!draggedId || overId !== item.id || !items) return null;
    return items.findIndex((i) => i.id === draggedId) < items.findIndex((i) => i.id === item.id) ? "after" : "before";
  }

  // --- Add and remove ----------------------------------------------------------

  async function handleAdd(result: WatchSearchResult) {
    if (!items) return;
    const saved = await addWatchlistItem(seedFor(result, items));
    setItems((prev) => (prev ? (prev.some((i) => i.id === saved.id) ? prev : [...prev, saved]) : [saved]));
  }

  function confirmRemove() {
    if (!pendingRemove) return;
    const item = pendingRemove;
    setPendingRemove(null);
    const previous = items;
    setItems((prev) => (prev ? prev.filter((i) => i.id !== item.id) : prev));
    setAnnouncement(`${item.name} removed.`);
    removeWatchlistItem(item).catch(() => {
      setItems(previous);
      showToast("Couldn't remove it. Try again.");
    });
  }

  const nseOpen = isMarketOpen(now);
  const mcxOpen = isMarketOpen(now, "CRUDEOIL");

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="flex flex-col gap-6">
      <WatchlistHero
        tab={tab}
        count={items ? items.length : null}
        readOnly={storageMissing}
        editMode={editMode}
        onToggleEdit={() => setEditMode((prev) => !prev)}
        onAdd={() => setAddOpen(true)}
      >
        {tab === "india" ? (
          <MarketPulse nseOpen={nseOpen} mcxOpen={mcxOpen} breadth={breadth} lastPolledAt={live.lastPolledAt} stale={stale} refreshing={live.manualRefreshing} onRefresh={() => void live.refresh()} />
        ) : (
          <GlobalPulse />
        )}
      </WatchlistHero>

      <WatchTabs tab={tab} onChange={setTab} />

      {tab === "global" ? (
        <div role="tabpanel" id={watchPanelId("global")} aria-labelledby={watchTabId("global")} className="flex flex-col gap-6">
          <GlobalTab world={world} />
        </div>
      ) : (
        <div role="tabpanel" id={watchPanelId("india")} aria-labelledby={watchTabId("india")} className="flex flex-col gap-6">
          {storageMissing && (
            <div role="status" className="flex items-start gap-3 rounded-2xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-warning" />
              <p className="min-w-0 text-muted-foreground">
                <span className="font-medium text-foreground">This is the starting watchlist, and it can&apos;t be changed yet.</span> To add, remove and reorder - and keep the list across
                devices - run <code className="break-all rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{WATCHLIST_MIGRATION}</code> in your Supabase SQL editor (or
                with <code className="break-words rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">supabase db push</code>), then reload this page.
              </p>
            </div>
          )}

          <LivePricingBanners tokenExpired={live.tokenExpired} offline={live.offline} lastPricesAt={live.lastPolledAt} />

          {live.loadError && !live.tokenExpired && !live.offline && (
            <div className="flex items-center gap-3 rounded-xl border border-loss/30 bg-loss/10 px-4 py-3 text-sm text-danger-fg">
              <AlertCircleIcon className="size-4 shrink-0" />
              <span className="flex-1">Couldn&apos;t refresh prices - {live.loadError}. Retrying automatically.</span>
            </div>
          )}

          {items === null ? (
            <LoadingState className="h-64" label="Loading watchlist…" />
          ) : items.length === 0 ? (
            <div className="relative isolate flex flex-col items-center gap-5 overflow-hidden rounded-3xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 -z-10 bg-[image:radial-gradient(50%_70%_at_50%_0%,color-mix(in_srgb,var(--accent-solid)_16%,transparent),transparent_70%)]"
              />
              <span aria-hidden="true" className="flex size-16 items-center justify-center rounded-2xl bg-[image:linear-gradient(145deg,color-mix(in_srgb,var(--accent)_32%,var(--card)),color-mix(in_srgb,var(--accent)_10%,var(--card)))] text-accent shadow-xl ring-1 ring-inset ring-accent/35">
                <EyeIcon className="size-7" />
              </span>
              <div className="max-w-sm">
                <p className="text-lg font-semibold tracking-tight">Your watchlist is empty</p>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">Add the indices, stocks and commodities you follow to see their live price, move and range in one place.</p>
              </div>
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className="flex min-h-11 items-center gap-2 rounded-xl bg-accent-solid px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-[0_10px_28px_-10px_color-mix(in_srgb,var(--accent-solid)_85%,transparent),inset_0_1px_0_rgba(255,255,255,0.22)] transition-[filter,transform] hover:brightness-110 active:scale-95 sm:min-h-10"
              >
                <PlusIcon className="size-4" />
                Add your first instrument
              </button>
            </div>
          ) : (
            <>
              <WatchToolbar
                text={text}
                onText={setText}
                searchRef={searchRef}
                sort={sort}
                onSort={applySort}
                mover={mover}
                onMover={setMover}
                moverCounts={moverCounts}
                kinds={kindChips}
                activeKind={activeFilter}
                onKind={setFilter}
                shown={visible.length}
                total={items.length}
                onClearFilters={clearFilters}
              />

              {visible.length === 0 ? (
                <div className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-border bg-card/50 px-6 py-14 text-center">
                  <p className="font-medium">Nothing on your watchlist matches</p>
                  <p className="text-sm text-muted-foreground">
                    {mover && !text.trim() && activeFilter === null ? `None of your instruments is ${mover === "up" ? "up" : "down"} today.` : "Try fewer words, or show everything again."}
                  </p>
                  <button
                    type="button"
                    onClick={clearFilters}
                    className="mt-1 min-h-10 rounded-xl border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted active:scale-95"
                  >
                    Clear filters
                  </button>
                </div>
              ) : (
                <div className="overflow-hidden rounded-3xl border border-border bg-card">
                  {/* The column headers sort, on the wide layout (1280px and up); below that the Sort control in the toolbar does the same. */}
                  <div className={`hidden gap-x-4 border-b border-border bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground xl:grid ${WATCH_COLUMNS}`}>
                    <span />
                    <SortHeader sortKey="name" sort={sort} onSort={applySort} />
                    <SortHeader sortKey="price" sort={sort} onSort={applySort} />
                    <SortHeader sortKey="change" sort={sort} onSort={applySort} />
                    <SortHeader sortKey="range" sort={sort} onSort={applySort} />
                    <span />
                  </div>
                  <ol aria-label="Watchlist" className="divide-y divide-border">
                    {visible.map((item, index) => (
                      <WatchRow
                        key={item.id}
                        item={item}
                        quote={live.quotes[item.itemKey]}
                        unavailable={live.missing.has(item.itemKey)}
                        stale={stale}
                        index={index}
                        count={visible.length}
                        readOnly={storageMissing}
                        reorderLocked={reorderLocked}
                        editMode={editMode}
                        dragging={draggedId === item.id}
                        dropEdge={dropEdgeFor(item)}
                        onMove={handleMove}
                        onRemove={setPendingRemove}
                        onDragStart={handleDragStart}
                        onDragOver={handleDragOver}
                        onDrop={handleDrop}
                        onDragEnd={handleDragEnd}
                      />
                    ))}
                  </ol>
                </div>
              )}

              {live.loading && <p className="text-center text-sm text-muted-foreground">Fetching live prices…</p>}
            </>
          )}
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <AnimatePresence>
        {addOpen && <AddInstrumentModal key="add-instrument" listedKeys={listedKeys} onAdd={handleAdd} onClose={() => setAddOpen(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {pendingRemove && (
          <ConfirmDialog
            title="Remove from watchlist?"
            message={`"${pendingRemove.name}" will be removed from the watchlist on every device. You can add it back any time.`}
            confirmLabel="Remove"
            onConfirm={confirmRemove}
            onCancel={() => setPendingRemove(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
