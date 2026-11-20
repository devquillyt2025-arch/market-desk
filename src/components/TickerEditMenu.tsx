"use client";

/**
 * "Edit ticker list": the pencil button at the right end of the ticker across the top of every page, and the panel it opens.
 *
 * The panel has what is shown now, in order (drag a row by its grip, or focus the grip and use the arrow keys), then every price
 * that can be shown, grouped, to tick or untick - and the two things about how the ticker moves: whether it loops, and how fast.
 * It hangs from the strip at the right edge, so it opens inward and stays on screen however narrow the page is. The choice is kept
 * on this device (see useTickerPrefs).
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { GripVerticalIcon, PencilIcon, XIcon } from "@/components/icons";
import Switch from "@/components/Switch";
import {
  clampSpeed,
  DEFAULT_TICKER_PREFS,
  isDefaultTickerPrefs,
  moveTickerItem,
  tickerItemDef,
  tickerSections,
  toggleTickerItem,
  TICKER_SPEED_MAX,
  TICKER_SPEED_MIN,
  TICKER_SPEED_STEP,
  type TickerPrefs,
} from "@/lib/tickerPrefs";
import type { SaveTickerPrefs } from "@/lib/useTickerPrefs";

export default function TickerEditMenu({ prefs, save }: { prefs: TickerPrefs; save: SaveTickerPrefs }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  /** The price whose grip should have the focus after the list is redrawn (moving a row in the DOM drops the focus). */
  const refocus = useRef<string | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // A drag in progress when the panel closes (or the page goes away) must not leave its listeners behind.
  useEffect(() => () => stopDrag.current?.(), []);

  useEffect(() => {
    const id = refocus.current;
    if (id === null) return;
    refocus.current = null;
    handles.current.get(id)?.focus();
  });

  /** Dragging a row: the row under the pointer is where the dragged one goes. Listens on the window, which a re-ordered row can't take with it. */
  function startDrag(e: ReactPointerEvent<HTMLButtonElement>, id: string) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    stopDrag.current?.();
    setDragging(id);
    const onMove = (event: PointerEvent) => {
      const rows = Array.from(listRef.current?.children ?? []);
      const hit = rows.findIndex((row) => {
        const box = row.getBoundingClientRect();
        return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      });
      if (hit !== -1) save((current) => moveTickerItem(current, id, hit));
    };
    const end = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      stopDrag.current = null;
      setDragging(null);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    stopDrag.current = end;
  }

  function onGripKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, id: string, label: string) {
    const step = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "Home" ? -Infinity : e.key === "End" ? Infinity : 0;
    if (step === 0) return;
    e.preventDefault();
    const from = prefs.ids.indexOf(id);
    const to = Math.min(prefs.ids.length - 1, Math.max(0, from + step));
    if (to === from) return;
    refocus.current = id;
    save((current) => moveTickerItem(current, id, to));
    setNote(`${label} moved to position ${to + 1} of ${prefs.ids.length}`);
  }

  function remove(id: string) {
    save((current) => (current.ids.includes(id) ? toggleTickerItem(current, id) : current));
    // The row the focus was on is gone; the panel keeps it, so the keyboard stays inside.
    panelRef.current?.focus();
  }

  const shown = prefs.ids.flatMap((id) => tickerItemDef(id) ?? []);
  const looping = prefs.loop;

  return (
    <div ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label="Edit ticker list"
        title="Edit ticker list"
        className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground pointer-coarse:size-9"
      >
        <PencilIcon className="size-4" />
      </button>

      {open && (
        <div
          ref={panelRef}
          id={panelId}
          role="group"
          aria-labelledby={`${panelId}-title`}
          tabIndex={-1}
          // Hangs from the strip (the nearest positioned ancestor), right-aligned to its padding, so it never runs off the left of a phone.
          className="absolute right-4 top-full z-50 mt-1.5 flex max-h-[min(80vh,42rem)] w-[36rem] max-w-[calc(100vw-2rem)] flex-col rounded-lg border border-border bg-card text-sm shadow-lg outline-none sm:right-6 lg:right-10"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h2 id={`${panelId}-title`} className="text-sm font-semibold text-foreground">
              Edit ticker list
            </h2>
            <button
              type="button"
              onClick={() => save(DEFAULT_TICKER_PREFS)}
              disabled={isDefaultTickerPrefs(prefs)}
              className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              Reset
            </button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-3">
            <section aria-labelledby={`${panelId}-shown`}>
              <h3 id={`${panelId}-shown`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                In your ticker · {shown.length}
              </h3>
              {shown.length === 0 ? (
                <p className="mt-2 text-muted-foreground">Nothing chosen. Tick some prices below.</p>
              ) : (
                <>
                  <p className="mt-1 text-xs text-muted-foreground">Drag a grip to reorder, or focus one and use the arrow keys.</p>
                  <ul ref={listRef} className="mt-2 grid gap-2 sm:grid-cols-2">
                    {shown.map((def) => (
                      <li
                        key={def.id}
                        className={`flex min-w-0 select-none items-center gap-1 rounded-md border bg-background py-1 pl-1 pr-1 ${
                          dragging === def.id ? "border-accent shadow-sm" : "border-border"
                        }`}
                      >
                        <button
                          type="button"
                          ref={(el) => {
                            if (el) handles.current.set(def.id, el);
                            else handles.current.delete(def.id);
                          }}
                          onPointerDown={(e) => startDrag(e, def.id)}
                          onKeyDown={(e) => onGripKeyDown(e, def.id, def.label)}
                          aria-label={`Move ${def.label}`}
                          title="Drag to reorder"
                          className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing pointer-coarse:size-9"
                        >
                          <GripVerticalIcon className="size-4" />
                        </button>
                        <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={def.title}>
                          {def.label}
                        </span>
                        <button
                          type="button"
                          onClick={() => remove(def.id)}
                          aria-label={`Remove ${def.label}`}
                          title="Remove"
                          className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground pointer-coarse:size-9"
                        >
                          <XIcon className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p role="status" aria-live="polite" className="sr-only">
                {note}
              </p>
            </section>

            <section aria-label="Add or remove prices">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add or remove</h3>
              <div className="mt-2 flex flex-col gap-4">
                {tickerSections().map((section) => (
                  <fieldset key={section.id} className="min-w-0">
                    <legend className="mb-1 text-xs font-medium text-muted-foreground">{section.label}</legend>
                    <div className="grid gap-x-3 gap-y-0.5 sm:grid-cols-2">
                      {section.items.map((item) => (
                        <label key={item.id} title={item.title} className="flex min-w-0 cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-muted">
                          <input
                            type="checkbox"
                            checked={prefs.ids.includes(item.id)}
                            onChange={() => save((current) => toggleTickerItem(current, item.id))}
                            className="size-4 shrink-0 accent-accent-solid"
                          />
                          <span className="min-w-0 truncate text-foreground">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                ))}
              </div>
            </section>
          </div>

          <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p id={`${panelId}-loop`} className="font-medium text-foreground">
                  Infinite loop
                </p>
                <p id={`${panelId}-loop-hint`} className="text-xs text-muted-foreground">
                  Slides endlessly when there are more prices than fit. Off, it stays still and scrolls by hand.
                </p>
              </div>
              <Switch
                checked={looping}
                onChange={(next) => save((current) => ({ ...current, loop: next }))}
                labelledBy={`${panelId}-loop`}
                describedBy={`${panelId}-loop-hint`}
              />
            </div>
            <div className={`flex items-center gap-3 ${looping ? "" : "opacity-50"}`}>
              <label htmlFor={`${panelId}-speed`} className="shrink-0 font-medium text-foreground">
                Ticker speed
              </label>
              <span aria-hidden="true" className="text-xs text-muted-foreground">
                Slow
              </span>
              <input
                id={`${panelId}-speed`}
                type="range"
                min={TICKER_SPEED_MIN}
                max={TICKER_SPEED_MAX}
                step={TICKER_SPEED_STEP}
                value={prefs.speed}
                disabled={!looping}
                aria-valuetext={`${prefs.speed} pixels a second`}
                onChange={(e) => save((current) => ({ ...current, speed: clampSpeed(Number(e.target.value)) }))}
                className="min-w-0 flex-1 accent-accent-solid"
              />
              <span aria-hidden="true" className="text-xs text-muted-foreground">
                Fast
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              Yahoo Finance prices run 10–15 minutes behind; the Upstox ones (Nifty, Bank Nifty, Sensex, GIFT Nifty, Dow futures) at most a
              minute. A hollow ring marks a closed market. Saved on this device.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
