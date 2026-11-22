"use client";

/**
 * The list for choosing the navigation tabs: every page, in the order this device wants, each with a switch to show or hide it and
 * a grip to move it (drag it, or focus it and use the arrow keys). Each change is saved at once, on this device (see useNavPrefs).
 * Used inside the pop-up the sidebar's pencil opens and inline on the Settings page.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";

import { GripVerticalIcon } from "@/components/icons";
import { withIcon } from "@/components/navLinks";
import Switch from "@/components/Switch";
import { navPage, TAB_BAR_SLOTS } from "@/lib/navPages";
import { defaultNavPrefs, isDefaultNavPrefs, moveNavPage, shownPages, toggleNavPage } from "@/lib/navPrefs";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { DESKTOP_NAV_QUERY, useNavPrefs } from "@/lib/useNavPrefs";

export default function NavTabsEditor() {
  const [prefs, save] = useNavPrefs();
  const wide = useMediaQuery(DESKTOP_NAV_QUERY, true);
  // A device that hasn't chosen yet starts from the default for its screen: a phone from the bar it already has.
  const current = prefs ?? defaultNavPrefs(!wide);
  const id = useId();
  const listRef = useRef<HTMLUListElement>(null);
  const handles = useRef(new Map<string, HTMLButtonElement>());
  /** The page whose grip should have the focus after the list is redrawn (moving a row in the DOM drops the focus). */
  const refocus = useRef<string | null>(null);
  const stopDrag = useRef<(() => void) | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // A drag in progress when the editor closes (or the page goes away) must not leave its listeners behind.
  useEffect(() => () => stopDrag.current?.(), []);

  useEffect(() => {
    const href = refocus.current;
    if (href === null) return;
    refocus.current = null;
    handles.current.get(href)?.focus();
  });

  /** Dragging a row: the row under the pointer is where the dragged one goes. Listens on the window, which a re-ordered row can't take with it. */
  function startDrag(e: ReactPointerEvent<HTMLButtonElement>, href: string) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    stopDrag.current?.();
    setDragging(href);
    const onMove = (event: PointerEvent) => {
      const rows = Array.from(listRef.current?.children ?? []);
      const hit = rows.findIndex((row) => {
        const box = row.getBoundingClientRect();
        return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
      });
      if (hit !== -1) save((now) => moveNavPage(now, href, hit));
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

  function onGripKeyDown(e: ReactKeyboardEvent<HTMLButtonElement>, href: string, label: string) {
    const step = e.key === "ArrowUp" || e.key === "ArrowLeft" ? -1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : e.key === "Home" ? -Infinity : e.key === "End" ? Infinity : 0;
    if (step === 0) return;
    e.preventDefault();
    const from = current.order.indexOf(href);
    const to = Math.min(current.order.length - 1, Math.max(0, from + step));
    if (to === from) return;
    refocus.current = href;
    save((now) => moveNavPage(now, href, to));
    setNote(`${label} moved to position ${to + 1} of ${current.order.length}`);
  }

  const hidden = new Set(current.hidden);
  const shown = shownPages(current);
  const onBar = new Set(shown.slice(0, TAB_BAR_SLOTS).map((page) => page.href));
  const rows = current.order.flatMap((href) => navPage(href) ?? []);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p id={`${id}-count`} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {shown.length} of {rows.length} shown
        </p>
        <button
          type="button"
          onClick={() => save(null)}
          disabled={isDefaultNavPrefs(prefs)}
          className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
        >
          Reset
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Switch a tab off to hide it. Drag a grip to reorder, or focus one and use the arrow keys.
        {!wide && " The first four shown are the bottom bar; the rest are under More."}
      </p>

      <ul ref={listRef} aria-describedby={`${id}-count`} className="mt-3 grid gap-1">
        {rows.map((page) => {
          const { icon: Icon } = withIcon(page);
          const off = hidden.has(page.href);
          const labelId = `${id}-${page.href.replace(/\W/g, "") || "home"}`;
          return (
            <li
              key={page.href}
              className={`flex min-w-0 select-none items-center gap-2 rounded-lg border bg-background py-0.5 pl-1 pr-3 transition-colors ${
                dragging === page.href ? "border-accent shadow-sm" : "border-border"
              }`}
            >
              <button
                type="button"
                ref={(el) => {
                  if (el) handles.current.set(page.href, el);
                  else handles.current.delete(page.href);
                }}
                onPointerDown={(e) => startDrag(e, page.href)}
                onKeyDown={(e) => onGripKeyDown(e, page.href, page.label)}
                aria-label={`Move ${page.label}`}
                title="Drag to reorder"
                className="flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing pointer-coarse:size-10"
              >
                <GripVerticalIcon className="size-4" />
              </button>
              <Icon className={`size-4 shrink-0 ${off ? "text-muted-foreground/50" : "text-muted-foreground"}`} />
              <span id={labelId} className={`min-w-0 flex-1 truncate text-sm font-medium ${off ? "text-muted-foreground" : "text-foreground"}`}>
                {page.label}
              </span>
              {!wide && !off && onBar.has(page.href) && (
                <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent">Bar</span>
              )}
              <Switch checked={!off} onChange={() => save((now) => toggleNavPage(now, page.href))} labelledBy={labelId} />
            </li>
          );
        })}
      </ul>

      <p role="status" aria-live="polite" className="sr-only">
        {note}
      </p>
      <p className="mt-3 text-xs text-muted-foreground">
        Settings is always shown, so this list can be edited again. A hidden page still opens from links and the address bar. Saved on this device only.
      </p>
    </div>
  );
}
