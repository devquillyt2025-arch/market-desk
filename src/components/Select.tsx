"use client";

/**
 * Custom dropdown, not a native <select>. Native select popups can only be
 * themed via `color-scheme` (a rough browser dark/light approximation) —
 * there's no CSS that reaches the actual popup chrome in any browser, so it
 * always looked out of place against this app's own theme. This renders the
 * options list itself, so it picks up the same tokens as everything else.
 *
 * The list is portaled to <body> and placed by viewport coordinates, the same
 * as DatePicker's calendar (see its comment for the full story). As a plain
 * `absolute` child of the trigger it was clipped by — or grew a scrollbar on —
 * whatever scrolling box it sat in: every modal's body, Reports' scroll area.
 * It opens upward when there isn't room below, and follows the trigger if
 * anything scrolls while it's open.
 *
 * Focus stays on the trigger the whole time (a listbox button, with
 * aria-activedescendant), so the keyboard works without moving focus into
 * the list: arrows / Home / End move, Enter or Space picks, Escape or Tab closes.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { CheckIcon, ChevronDownIcon } from "@/components/icons";

export type SelectOption<T extends string> = {
  value: T;
  label: string;
};

type SelectProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: readonly SelectOption<T>[];
  id?: string;
  /** Replaces the whole trigger style — for the rare spot that needs its own (e.g. Notes' fixed-height toolbar). */
  triggerClassName?: string;
  /**
   * "md" (default) matches the app's buttons and search fields, for toolbars
   * and headers; "sm" matches form inputs, for use inside forms and modals.
   */
  size?: "sm" | "md";
  align?: "left" | "right";
};

const TRIGGER_CLASS =
  "flex w-full items-center justify-between gap-2 rounded-lg border bg-card px-3 text-sm text-foreground outline-none transition-colors hover:border-border-strong focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/30";
const TRIGGER_SIZE_CLASS = { sm: "py-1.5", md: "py-2" } as const;

/** Matches the list's own max-h-60 — used to decide whether it fits below the trigger. */
const LIST_MAX_HEIGHT = 240;
/** One option row (py-1.5 + a text-sm line) — for estimating a short list's height before it renders. */
const OPTION_HEIGHT = 32;
const GAP = 4;

type Placement = { top?: number; bottom?: number; left?: number; right?: number; minWidth: number };

/** Where the list goes for the trigger as it sits on screen right now — below it, or above when below is short of room. */
function placementFor(trigger: HTMLElement, optionCount: number, align: "left" | "right"): Placement {
  const rect = trigger.getBoundingClientRect();
  const listHeight = Math.min(LIST_MAX_HEIGHT, optionCount * OPTION_HEIGHT + 2 * GAP);
  const spaceBelow = window.innerHeight - rect.bottom - GAP;
  const openUp = spaceBelow < listHeight && rect.top > spaceBelow;
  return {
    ...(openUp ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
    ...(align === "right" ? { right: window.innerWidth - rect.right } : { left: rect.left }),
    minWidth: rect.width,
  };
}

const noopSubscribe = () => () => {};

export default function Select<T extends string>({
  value,
  onChange,
  options,
  id,
  triggerClassName,
  size = "md",
  align = "left",
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();
  // False on the server and through hydration, true after — <body> only exists for the portal from then on.
  const inBrowser = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex === -1 ? undefined : options[selectedIndex];

  function openList() {
    // Measured here, in the same update that opens it — left to the effect
    // below, the list's first frame would sit wherever it was last time,
    // stale by however far the page has scrolled since.
    if (triggerRef.current) setPlacement(placementFor(triggerRef.current, options.length, align));
    setActiveIndex(selectedIndex === -1 ? 0 : selectedIndex);
    setOpen(true);
  }

  function choose(index: number) {
    const option = options[index];
    if (option) onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;

    function updatePlacement() {
      if (triggerRef.current) setPlacement(placementFor(triggerRef.current, options.length, align));
    }

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    }
    // Capture phase: `scroll` doesn't bubble, and the scrolling box is usually
    // an inner one (a modal body, Reports' content), not the window.
    window.addEventListener("scroll", updatePlacement, true);
    window.addEventListener("resize", updatePlacement);
    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("scroll", updatePlacement, true);
      window.removeEventListener("resize", updatePlacement);
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open, align, options.length]);

  // Keeps the highlighted option in view as the arrow keys walk a long list.
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    listRef.current?.querySelector(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, placement]);

  function handleKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openList();
      }
      return;
    }
    const last = options.length - 1;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((i) => Math.min(last, i + 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((i) => Math.max(0, i - 1));
        break;
      case "Home":
        e.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIndex(last);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        choose(activeIndex);
        break;
      case "Escape":
        // Only this dropdown — not the modal it may be sitting in.
        e.preventDefault();
        e.stopPropagation();
        e.nativeEvent.stopImmediatePropagation();
        setOpen(false);
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        id={id}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        className={
          triggerClassName ??
          `${TRIGGER_CLASS} ${TRIGGER_SIZE_CLASS[size]} ${open ? "border-accent ring-2 ring-accent/30" : "border-border"}`
        }
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronDownIcon
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {inBrowser &&
        createPortal(
          // AnimatePresence stays mounted (portaled every render) so it can play the exit — same reason as DatePicker.
          <AnimatePresence>
            {open && placement && (
              <motion.ul
                ref={listRef}
                id={listId}
                role="listbox"
                initial={{ opacity: 0, y: placement.bottom === undefined ? -4 : 4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: placement.bottom === undefined ? -4 : 4, scale: 0.98, transition: { duration: 0.1 } }}
                transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
                style={{ position: "fixed", ...placement }}
                className="z-[500] max-h-60 max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg"
              >
                {options.map((option, index) => {
                  const isSelected = option.value === value;
                  return (
                    <li
                      key={option.value}
                      id={`${listId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(index)}
                      // mousedown, not click: picks before the trigger loses focus, so focus lands back on it cleanly.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(index);
                      }}
                      className={`flex cursor-pointer items-center justify-between gap-3 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                        isSelected ? "text-accent" : "text-foreground"
                      } ${index === activeIndex ? (isSelected ? "bg-accent/15" : "bg-muted") : isSelected ? "bg-accent/10" : ""}`}
                    >
                      {option.label}
                      {isSelected && <CheckIcon className="size-3.5 shrink-0" />}
                    </li>
                  );
                })}
              </motion.ul>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
