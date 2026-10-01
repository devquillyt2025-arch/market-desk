"use client";

/**
 * "Import from Live Portfolio / Paper Trade" picker for the Analysis tab.
 * Lists the source's open option positions (one underlying at a time, since
 * a strategy has one), lets the user tick which to bring in, and whether to
 * replace or extend the legs already on screen.
 */

import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { XIcon } from "@/components/icons";
import LoadingState from "@/components/LoadingState";
import { getCachedLivePortfolioEntries, getLivePortfolioEntries } from "@/lib/livePortfolioEntriesStore";
import { getCachedPaperTradeEntries, getPaperTradeEntries } from "@/lib/paperTradeEntriesStore";
import { isImportableEntry, type PriceMode } from "@/lib/strategyTransfer";
import { INSTRUMENTS, INSTRUMENT_LABELS, type Instrument, type TradeEntry } from "@/lib/types";

export type ImportSource = "live" | "paper";
export type ImportMode = "replace" | "add";

const SOURCE_LABELS: Record<ImportSource, string> = { live: "Live Portfolio", paper: "Paper Trade" };

type Props = {
  source: ImportSource;
  currentInstrument: Instrument;
  /** ISO date in IST — positions already past expiry can't be analysed. */
  today: string;
  hasLegs: boolean;
  onImport: (instrument: Instrument, entries: TradeEntry[], options: { mode: ImportMode; priceMode: PriceMode }) => void;
  onClose: () => void;
};

function Radio<T extends string>({
  value,
  current,
  onChange,
  label,
  hint,
  disabled,
}: {
  value: T;
  current: T;
  onChange: (v: T) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-start gap-2 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <input
        type="radio"
        checked={current === value}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 size-4 accent-accent"
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  );
}

export default function ImportPositionsModal({ source, currentInstrument, today, hasLegs, onImport, onClose }: Props) {
  const [entries, setEntries] = useState<TradeEntry[] | null>(
    source === "live" ? getCachedLivePortfolioEntries() : getCachedPaperTradeEntries(),
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [pickedInstrument, setPickedInstrument] = useState<Instrument | null>(null);
  // Everything is selected until the user unticks it — kept as the exceptions
  // so the default survives the list arriving after the dialog opens.
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<ImportMode>("replace");
  const [priceMode, setPriceMode] = useState<PriceMode>("entry");

  useEffect(() => {
    let cancelled = false;
    (source === "live" ? getLivePortfolioEntries() : getPaperTradeEntries())
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const open = useMemo(
    () =>
      (entries ?? [])
        .filter(isImportableEntry)
        .sort((a, b) => (a.expiry_date! === b.expiry_date! ? a.strike_price! - b.strike_price! : a.expiry_date! < b.expiry_date! ? -1 : 1)),
    [entries],
  );
  const counts = useMemo(() => {
    const c: Partial<Record<Instrument, number>> = {};
    for (const e of open) c[e.instrument] = (c[e.instrument] ?? 0) + 1;
    return c;
  }, [open]);

  const instrument: Instrument =
    pickedInstrument ?? (counts[currentInstrument] ? currentInstrument : (INSTRUMENTS.find((i) => counts[i]) ?? currentInstrument));
  const rows = open.filter((e) => e.instrument === instrument);
  const isExpired = (e: TradeEntry) => e.expiry_date! < today;
  const chosen = rows.filter((e) => !deselected.has(e.id) && !isExpired(e));
  // Legs from another underlying can't sit next to the current ones.
  const switching = instrument !== currentInstrument && hasLegs;
  const effectiveMode: ImportMode = switching || !hasLegs ? "replace" : mode;

  function toggle(id: string) {
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const loading = entries === null && !loadFailed;

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
        initial={{ opacity: 0, scale: 0.97, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12, ease: "easeIn" } }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Import from ${SOURCE_LABELS[source]}`}
        className="glass-panel flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight">Import from {SOURCE_LABELS[source]}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {loading ? (
            <LoadingState className="h-32" label="Loading positions…" />
          ) : loadFailed && entries === null ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Couldn&apos;t load {SOURCE_LABELS[source]}. Check your connection and try again.
            </p>
          ) : open.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No open option positions in {SOURCE_LABELS[source]}. Positions need a strike, CE/PE, expiry and the
              &quot;Hold&quot; status.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {INSTRUMENTS.filter((i) => counts[i]).map((i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setPickedInstrument(i);
                      setDeselected(new Set());
                    }}
                    className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      i === instrument
                        ? "border-accent bg-accent/10 text-accent"
                        : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {INSTRUMENT_LABELS[i]} <span className="text-xs opacity-70">{counts[i]}</span>
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setDeselected(chosen.length === rows.filter((e) => !isExpired(e)).length ? new Set(rows.map((e) => e.id)) : new Set())
                  }
                  className="ml-auto text-sm font-medium text-accent hover:underline"
                >
                  {chosen.length === rows.filter((e) => !isExpired(e)).length ? "Select none" : "Select all"}
                </button>
              </div>

              <ul className="flex flex-col gap-1.5">
                {rows.map((e) => {
                  const expired = isExpired(e);
                  const price = e.side === "sell" ? e.sell_price : e.buy_price;
                  return (
                    <li key={e.id}>
                      <label
                        className={`flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm ${
                          expired ? "opacity-50" : "cursor-pointer hover:bg-muted"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={!expired && !deselected.has(e.id)}
                          disabled={expired}
                          onChange={() => toggle(e.id)}
                          className="size-4 accent-accent"
                        />
                        <span
                          className={`flex size-6 shrink-0 items-center justify-center rounded text-xs font-bold ${
                            e.side === "buy" ? "bg-info/20 text-info" : "bg-danger-fg/15 text-danger-fg"
                          }`}
                        >
                          {e.side === "buy" ? "B" : "S"}
                        </span>
                        <span className="font-medium">
                          {e.strike_price!.toFixed(0)} {e.option_type}
                        </span>
                        <span className="text-muted-foreground">
                          {new Date(`${e.expiry_date}T00:00:00Z`).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            timeZone: "UTC",
                          })}
                          {expired ? " · expired" : ""}
                        </span>
                        <span className="ml-auto text-right font-mono text-xs tabular-nums text-muted-foreground">
                          {e.lots} lot{e.lots === 1 ? "" : "s"} @ {price}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prices</span>
                  <Radio value="entry" current={priceMode} onChange={setPriceMode} label="Entry price" hint="What the position was opened at" />
                  <Radio value="live" current={priceMode} onChange={setPriceMode} label="Current market price" hint="Live LTP from the option chain" />
                </div>
                <div className="flex flex-col gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Legs on screen</span>
                  <Radio
                    value="replace"
                    current={effectiveMode}
                    onChange={setMode}
                    label="Replace current legs"
                    disabled={!hasLegs}
                  />
                  <Radio
                    value="add"
                    current={effectiveMode}
                    onChange={setMode}
                    label="Add to current legs"
                    hint={switching ? "Different underlying — will replace" : undefined}
                    disabled={!hasLegs || switching}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={chosen.length === 0}
            onClick={() => onImport(instrument, chosen, { mode: effectiveMode, priceMode })}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50 active:scale-95"
          >
            Import {chosen.length} leg{chosen.length === 1 ? "" : "s"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
