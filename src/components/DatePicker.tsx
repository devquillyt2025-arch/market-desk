"use client";

/**
 * Custom date field, not a native `<input type="date">`. Same rationale as
 * Select.tsx: the native date input's calendar *popup* is rendered by the
 * OS/browser and can't be reached by CSS at all, so it always looked out of
 * place next to every other themed control in a modal. This renders the
 * whole calendar itself, so it picks up the same tokens as everything else.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CalendarIcon, ChevronDownIcon } from "@/components/icons";

type DatePickerProps = {
  /** ISO `yyyy-mm-dd`, matching what the native date input produced. */
  value: string;
  onChange: (value: string) => void;
  id?: string;
  triggerClassName?: string;
};

const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const DEFAULT_TRIGGER_CLASS =
  "flex w-full items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";

/** Parsed as local midnight, not UTC — so the day-of-month never shifts by timezone. */
function parseISODate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

type Coords = { top: number; left: number };

export default function DatePicker({ value, onChange, id, triggerClassName }: DatePickerProps) {
  const selected = parseISODate(value);
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState(() => selected ?? new Date());
  const [coords, setCoords] = useState<Coords | null>(null);
  // The portal target (document.body) doesn't exist during server rendering
  // — this flips true only after mounting in the browser, so the portal is
  // skipped for the SSR/hydration pass and rendered only on the client.
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Unlike the `open`-driven state below, there's no user event to hook
    // this off of — detecting "now running in the browser, past the
    // SSR/hydration pass" is exactly what an effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function updateCoords() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setCoords({ top: rect.bottom + 4, left: rect.left });
    }
    updateCoords();

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    // Capture phase: `scroll` doesn't bubble, so this is the only way to
    // notice the *modal's own* inner scroll container moving, not just the
    // window itself — keeps the popup glued to the field either way instead
    // of drifting off or (as a portal, now unclipped) staying stuck in place.
    window.addEventListener("scroll", updateCoords, true);
    window.addEventListener("resize", updateCoords);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("scroll", updateCoords, true);
      window.removeEventListener("resize", updateCoords);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const year = viewMonth.getFullYear();
  const month = viewMonth.getMonth();
  const startOffset = new Date(year, month, 1).getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  // Based on gridStart's own year/month (not the displayed month) so the
  // day-overflow arithmetic rolls forward correctly — e.g. Aug 30 + 3 must
  // land on Sept 2, which only happens when August is the base month.
  // Basing it on the *displayed* month instead (a bug caught by testing:
  // clicking the visible "15" selected Oct 15 while showing "September")
  // reinterpreted every leading/trailing day as if it were still in the
  // displayed month, silently skipping it forward a month or more.
  const cells = Array.from(
    { length: 42 },
    (_, i) => new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i),
  );
  const today = new Date();

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      // Re-sync the visible month to the current value each time it opens,
      // from the click handler rather than an effect watching `open` — a
      // plain state update in response to the event itself, not a
      // React-recommended-against setState-in-effect. Skipping this when
      // `selected` changes while already open means browsing to a different
      // month doesn't get yanked back by an unrelated value update.
      if (next) {
        setViewMonth(selected ?? new Date());
        // Computed here (not left to the effect below) so `open` and
        // `coords` land in the same render — otherwise the popup would
        // render once at its stale position (or 0,0) before the effect
        // catches up a frame later.
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) setCoords({ top: rect.bottom + 4, left: rect.left });
      }
      return next;
    });
  }

  function selectDate(date: Date) {
    onChange(toISODate(date));
    setOpen(false);
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={triggerClassName ?? DEFAULT_TRIGGER_CLASS}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="flex-1 truncate text-left font-mono tabular-nums">
          {selected
            ? selected.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" })
            : "Select date"}
        </span>
      </button>

      {mounted &&
        createPortal(
          // Portaled to <body> and positioned by viewport coordinates rather
          // than a plain `absolute` child of the trigger: a `motion.div`
          // ancestor (the modal card) carries an inline `transform` from its
          // own entrance animation even at rest, which makes it a containing
          // block for any ordinary `position: absolute`/`fixed` descendant —
          // so the popup stayed trapped inside the modal's box, and the
          // modal's own `overflow-y-auto` grew a scrollbar to fit it instead
          // of letting it float freely above everything.
          //
          // AnimatePresence itself stays mounted unconditionally (portaled
          // every render) so it can see the calendar go from present to
          // absent and actually run the exit transition — nesting it inside
          // an `open &&` here instead would unmount the whole subtree
          // (AnimatePresence included) the instant `open` flips, before it
          // gets a chance to animate anything out.
          <AnimatePresence>
            {open && coords && (
              <motion.div
                ref={popupRef}
                initial={{ opacity: 0, y: -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                style={{ position: "fixed", top: coords.top, left: coords.left }}
                className="z-[500] w-64 rounded-lg border border-border bg-card p-3 shadow-lg"
              >
              <div className="flex items-center justify-between pb-2">
                <button
                  type="button"
                  onClick={() => setViewMonth(new Date(year, month - 1, 1))}
                  aria-label="Previous month"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronDownIcon className="size-3.5 rotate-90" />
                </button>
                <span className="text-sm font-medium">
                  {MONTH_LABELS[month]} {year}
                </span>
                <button
                  type="button"
                  onClick={() => setViewMonth(new Date(year, month + 1, 1))}
                  aria-label="Next month"
                  className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronDownIcon className="size-3.5 -rotate-90" />
                </button>
              </div>

              <div className="grid grid-cols-7 gap-y-1 text-center">
                {WEEKDAY_LABELS.map((label, i) => (
                  <span key={i} className="text-[11px] font-medium text-muted-foreground">
                    {label}
                  </span>
                ))}
                {cells.map((date) => {
                  const inMonth = date.getMonth() === month;
                  const isSelected = selected ? isSameDay(date, selected) : false;
                  const isToday = isSameDay(date, today);
                  return (
                    <button
                      key={toISODate(date)}
                      type="button"
                      onClick={() => selectDate(date)}
                      className={`mx-auto flex size-8 items-center justify-center rounded-md text-sm transition-colors ${
                        isSelected
                          ? "bg-accent font-medium text-accent-foreground"
                          : inMonth
                            ? `text-foreground hover:bg-muted ${isToday ? "font-semibold text-accent" : ""}`
                            : "text-muted-foreground/40 hover:bg-muted"
                      }`}
                    >
                      {date.getDate()}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => selectDate(new Date())}
                className="mt-2 w-full rounded-md py-1.5 text-center text-xs font-medium text-accent transition-colors hover:bg-accent/10"
              >
                Today
              </button>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </>
  );
}
