"use client";

/**
 * From / To dates for a "Custom" range, floating under the control that asked
 * for it. It's a popover rather than fields in the header row because the
 * header can't afford the width: inserting two date pickers there pushed the
 * toolbar sideways on wide screens and wrapped it onto an extra row on narrow
 * ones, shaking everything beneath. Absolutely positioned, it takes no part
 * in layout at all — the parent just needs a `relative` box to anchor it to.
 *
 * It closes on Done, Escape, or a click anywhere else. The calendars it opens
 * are portaled to <body> (see DatePicker), so a click inside one is told apart
 * by its `data-picker-popup` marker instead of by containment.
 */

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";

import DatePicker from "@/components/DatePicker";

const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

type CustomRangePanelProps = {
  from: string;
  to: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  onClose: () => void;
};

export default function CustomRangePanel({ from, to, onFromChange, onToChange, onClose }: CustomRangePanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Element;
      if (panelRef.current?.contains(target) || target.closest?.("[data-picker-popup]")) return;
      onClose();
    }
    function handleKeyDown(e: KeyboardEvent) {
      // With a calendar open, Escape belongs to the calendar (it closes itself) — only a second press closes this.
      if (e.key === "Escape" && !document.querySelector("[data-picker-popup]")) onClose();
    }
    // Capture phase on purpose: choosing "Custom" again from the range dropdown
    // fires that option's own handler (which reopens this panel) before a
    // bubbling listener here would run, and this would then close it straight
    // after. Running first, the reopen wins.
    document.addEventListener("mousedown", handlePointerDown, true);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  return (
    <motion.div
      ref={panelRef}
      role="group"
      aria-label="Custom date range"
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
      transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="absolute right-0 top-full z-30 mt-2 flex w-max max-w-[calc(100vw-2rem)] flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3 shadow-lg"
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="reports-range-from" className={labelClass}>
          From
        </label>
        <div className="w-36">
          <DatePicker id="reports-range-from" value={from} onChange={onFromChange} clearable />
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="reports-range-to" className={labelClass}>
          To
        </label>
        <div className="w-36">
          <DatePicker id="reports-range-to" value={to} onChange={onToChange} clearable />
        </div>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="rounded-lg bg-accent-solid px-4 py-1.5 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 active:scale-95"
      >
        Done
      </button>
    </motion.div>
  );
}
