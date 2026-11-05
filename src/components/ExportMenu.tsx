"use client";

/**
 * The "Export" button with a small menu of formats under it. Picking one runs
 * `onSelect`; while that runs (building a PDF takes a moment — the PDF library
 * loads on first use) the button shows a spinner and ignores further clicks.
 *
 * Menu semantics follow the usual pattern: the button toggles it, focus moves
 * to the first item on open, arrows / Home / End walk the items, Escape closes
 * and returns focus to the button, and a click elsewhere or Tab closes it.
 * `onSelect` owns its own error reporting — a rejection is not caught here.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { ChevronDownIcon, DownloadIcon, RefreshIcon } from "@/components/icons";

export type ExportFormat = "csv" | "pdf" | "json";

type ExportOption = { format: ExportFormat; label: string; description: string };

const OPTIONS: readonly ExportOption[] = [
  {
    format: "csv",
    label: "CSV spreadsheet",
    description: "Every table in one file. Opens in Excel or Google Sheets.",
  },
  {
    format: "pdf",
    label: "PDF report",
    description: "Formatted summary, positions and risk. Ready to share or print.",
  },
  {
    format: "json",
    label: "JSON",
    description: "Raw saved positions, for re-importing into Trade Entries.",
  },
];

const BUSY_LABELS: Record<ExportFormat, string> = {
  csv: "Exporting…",
  pdf: "Preparing PDF…",
  json: "Exporting…",
};

type ExportMenuProps = {
  onSelect: (format: ExportFormat) => void | Promise<void>;
};

export default function ExportMenu({ onSelect }: ExportMenuProps) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    itemRefs.current[0]?.focus();

    function handlePointerDown(e: MouseEvent) {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  async function choose(format: ExportFormat) {
    setOpen(false);
    triggerRef.current?.focus();
    setBusy(format);
    try {
      await onSelect(format);
    } finally {
      setBusy(null);
    }
  }

  function moveFocus(to: number) {
    const last = OPTIONS.length - 1;
    itemRefs.current[Math.min(last, Math.max(0, to))]?.focus();
  }

  function handleMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const current = itemRefs.current.findIndex((el) => el === document.activeElement);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveFocus(current + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveFocus(current - 1);
        break;
      case "Home":
        e.preventDefault();
        moveFocus(0);
        break;
      case "End":
        e.preventDefault();
        moveFocus(OPTIONS.length - 1);
        break;
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      case "Tab":
        setOpen(false);
        break;
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        disabled={busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-busy={busy !== null}
        className="flex items-center gap-1.5 rounded-lg border border-border px-3.5 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 disabled:cursor-progress disabled:opacity-70 disabled:active:scale-100"
      >
        {busy ? <RefreshIcon className="size-4 animate-spin" /> : <DownloadIcon className="size-4" />}
        {busy ? BUSY_LABELS[busy] : "Export"}
        {!busy && (
          <ChevronDownIcon
            className={`size-3.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            aria-label="Export format"
            onKeyDown={handleMenuKeyDown}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-full z-[500] mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-card p-1 shadow-lg"
          >
            {OPTIONS.map((option, index) => (
              <button
                key={option.format}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                onClick={() => choose(option.format)}
                className="flex w-full flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
              >
                <span className="text-sm font-medium text-foreground">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
