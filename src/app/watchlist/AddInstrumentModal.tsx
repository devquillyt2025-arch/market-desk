"use client";

/**
 * The Watchlist's "Add" popup: search stocks, indices and commodities and add any of them with one click. Same frame
 * as the app's other modals (frosted backdrop, opaque panel, focus held inside, Escape to close). It stays open
 * after an add, since adding several at once is the usual job; a row you have added reads "Added" and can't be
 * added twice. Before anything is typed it offers a short set of suggestions, so it is useful on first open.
 */

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";

import { AlertCircleIcon, CheckIcon, PlusIcon, SearchIcon, XIcon } from "@/components/icons";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { useSettled } from "@/lib/useSettled";
import { searchInstruments } from "@/lib/upstox/client";
import type { InstrumentSearchResult } from "@/lib/upstox/types";
import { itemGlyph, KIND_LABELS, type WatchSearchResult } from "@/lib/watchlist";
import { suggestedInstruments, type Suggestions } from "@/lib/watchlistSuggestions";

import { toneStyle } from "./watchTone";

type AddInstrumentModalProps = {
  /** `itemKey`s already on the list - those show "Added". Live, so a row flips as soon as its add lands. */
  listedKeys: ReadonlySet<string>;
  /** Adds one; rejects if it couldn't be saved. */
  onAdd: (result: WatchSearchResult) => Promise<void>;
  onClose: () => void;
};

const SECTIONS: { id: keyof Suggestions; kind: "index" | "commodity" | "equity" }[] = [
  { id: "indices", kind: "index" },
  { id: "commodities", kind: "commodity" },
  { id: "stocks", kind: "equity" },
];

function ResultRow({ result, listed, pending, onAdd }: { result: WatchSearchResult; listed: boolean; pending: boolean; onAdd: () => void }) {
  return (
    <li style={toneStyle(result.kind)} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-muted/50">
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[image:linear-gradient(145deg,color-mix(in_srgb,var(--tone)_28%,var(--card)),color-mix(in_srgb,var(--tone)_8%,var(--card)))] text-sm font-semibold text-[color-mix(in_srgb,var(--tone)_70%,var(--foreground))] ring-1 ring-inset ring-[color-mix(in_srgb,var(--tone)_30%,transparent)]"
      >
        {itemGlyph(result)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{result.name}</p>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {result.symbol} · {result.detail}
        </p>
      </div>
      {listed ? (
        <span className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-profit">
          <CheckIcon className="size-4" />
          Added
        </span>
      ) : (
        <button
          type="button"
          onClick={onAdd}
          disabled={pending}
          aria-label={`Add ${result.name} to the watchlist`}
          className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60 active:scale-95"
        >
          {pending ? (
            <svg className="size-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
          ) : (
            <PlusIcon className="size-4" />
          )}
          {pending ? "Adding…" : "Add"}
        </button>
      )}
    </li>
  );
}

export function AddInstrumentModal({ listedKeys, onAdd, onClose }: AddInstrumentModalProps) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const [query, setQuery] = useState("");
  const settled = useSettled(query.trim(), 250);
  const [outcome, setOutcome] = useState<{ query: string; result: InstrumentSearchResult } | null>(null);
  // Suggestions are worked out from what was listed when the popup opened, so a row you add stays put and flips to "Added"
  // - which is how you know it worked - instead of vanishing from under your cursor.
  const [openedWith] = useState<ReadonlySet<string>>(() => new Set(listedKeys));
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);

  const searching = settled.length >= 2;
  useEffect(() => {
    if (!searching) return;
    // A newer query aborts the one before it, so a slow answer can't land over a fresher one.
    const controller = new AbortController();
    void searchInstruments(settled, controller.signal).then((result) => {
      if (!controller.signal.aborted) setOutcome({ query: settled, result });
    });
    return () => controller.abort();
  }, [searching, settled]);

  const current = searching && outcome?.query === settled ? outcome.result : null;
  const error = current && "error" in current ? current.error : null;
  const sections: Suggestions | null = !searching ? suggestedInstruments(openedWith) : current && "results" in current ? current.results : null;
  const loading = searching && current === null;
  const total = sections ? sections.indices.length + sections.commodities.length + sections.stocks.length : 0;

  async function handleAdd(result: WatchSearchResult) {
    setAddError(null);
    setPending((prev) => new Set(prev).add(result.itemKey));
    try {
      await onAdd(result);
    } catch {
      setAddError(`Couldn't add ${result.name}. Try again.`);
    } finally {
      setPending((prev) => {
        const next = new Set(prev);
        next.delete(result.itemKey);
        return next;
      });
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="glass-backdrop fixed inset-0 z-[300] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-instrument-title"
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.97, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12, ease: "easeIn" } }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        className="glass-panel flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-accent/70 to-transparent" />

        <div className="flex items-center gap-3 px-5 pb-3 pt-5">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent/12 text-accent ring-1 ring-inset ring-accent/25">
            <PlusIcon className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="add-instrument-title" className="text-base font-semibold tracking-tight">
              Add to watchlist
            </h2>
            <p className="text-sm text-muted-foreground">Stocks, indices and commodities - add as many as you like.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-90"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="px-5 pb-3">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search - try “reliance”, “gold” or “nifty bank”"
              aria-label="Search instruments"
              autoComplete="off"
              spellCheck={false}
              // The dialog hook's own marker: focused once the popup is in place.
              data-autofocus=""
              className="w-full rounded-xl border border-border bg-background/60 py-2.5 pl-10 pr-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/60 focus:border-accent focus:ring-4 focus:ring-accent/15 [&::-webkit-search-cancel-button]:hidden"
            />
          </div>
        </div>

        <div className="min-h-[14rem] flex-1 overflow-y-auto px-3 pb-4">
          {/* Always rendered, so a screen reader hears how many matches came back. */}
          <p aria-live="polite" className="sr-only">
            {loading ? "Searching" : searching && sections ? `${total} result${total === 1 ? "" : "s"}` : ""}
          </p>

          {addError && (
            <p role="alert" className="mx-2 mb-2 flex items-center gap-2 rounded-xl border border-danger-fg/30 bg-danger-fg/10 px-3.5 py-2.5 text-sm text-danger-fg">
              <AlertCircleIcon className="size-4 shrink-0" />
              {addError}
            </p>
          )}

          {error ? (
            <div role="alert" className="mx-2 flex items-start gap-2.5 rounded-xl border border-danger-fg/30 bg-danger-fg/10 px-3.5 py-3 text-sm text-danger-fg">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <span>
                {error === "token_expired" ? (
                  <>
                    Your Upstox token has expired - search needs it.{" "}
                    <Link href="/settings" className="font-medium underline underline-offset-2">
                      Add a new one
                    </Link>
                    .
                  </>
                ) : error === "network_error" ? (
                  "Couldn't reach the server. Check your connection and try again."
                ) : (
                  `Search failed: ${error}`
                )}
              </span>
            </div>
          ) : loading ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">Searching…</p>
          ) : sections && total === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              {searching ? <>Nothing matches “{settled}”. Try a company name or its NSE symbol.</> : "Everything suggested is already on your watchlist."}
            </p>
          ) : (
            sections && (
              <div className="flex flex-col gap-3">
                {!searching && <p className="px-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Suggestions</p>}
                {SECTIONS.map(({ id, kind }) =>
                  sections[id].length === 0 ? null : (
                    <section key={id} aria-label={KIND_LABELS[kind]}>
                      <h3 className="px-2 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{KIND_LABELS[kind]}</h3>
                      <ul className="flex flex-col">
                        {sections[id].map((result) => (
                          <ResultRow key={result.itemKey} result={result} listed={listedKeys.has(result.itemKey)} pending={pending.has(result.itemKey)} onAdd={() => void handleAdd(result)} />
                        ))}
                      </ul>
                    </section>
                  ),
                )}
              </div>
            )
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
