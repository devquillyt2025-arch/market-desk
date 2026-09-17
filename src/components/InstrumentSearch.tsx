"use client";

/**
 * Searchable instrument/segment picker for the Brokerage Calculator, styled
 * after Upstox's own calculator (upstox.com/calculator/brokerage-calculator)
 * — one search box instead of separate Segment + Instrument tab rows.
 * Portaled like DatePicker: the calculator's root is a `motion.div` that
 * carries an inline `transform` from its entrance animation, which makes it
 * a containing block for any ordinary `position: absolute`/`fixed`
 * descendant — so the dropdown would otherwise be clipped/mispositioned by
 * the card it lives in.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ChevronDownIcon, SearchIcon } from "@/components/icons";
import type { BrokerageSegment } from "@/lib/calculateBrokerage";
import type { Instrument } from "@/lib/types";

export type CalcOption = {
  id: string;
  label: string;
  segment: BrokerageSegment;
  instrument: Instrument | null;
};

type Coords = { top: number; left: number; width: number };

const TRIGGER_CLASS =
  "flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";

type InstrumentSearchProps = {
  options: CalcOption[];
  value: CalcOption;
  onChange: (option: CalcOption) => void;
};

export default function InstrumentSearch({ options, value, onChange }: InstrumentSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [coords, setCoords] = useState<Coords | null>(null);
  const [mounted, setMounted] = useState(false);
  const triggerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function updateCoords() {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    updateCoords();

    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (popupRef.current?.contains(target)) return;
      setOpen(false);
      setQuery("");
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setQuery("");
      }
    }
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

  function openDropdown() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setOpen(true);
    setQuery("");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function selectOption(option: CalcOption) {
    onChange(option);
    setOpen(false);
    setQuery("");
  }

  const filtered = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={triggerRef} className="relative">
      {open ? (
        <div className={TRIGGER_CLASS}>
          <SearchIcon className="size-4 shrink-0 text-muted-foreground/55" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search instrument..."
            className="flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground/55"
          />
        </div>
      ) : (
        <button type="button" onClick={openDropdown} className={TRIGGER_CLASS}>
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="flex-1 truncate text-left font-medium">{value.label}</span>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </button>
      )}

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && coords && (
              <motion.div
                ref={popupRef}
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.97, transition: { duration: 0.1 } }}
                transition={{ duration: 0.18, ease: "easeOut" }}
                style={{ position: "fixed", top: coords.top, left: coords.left, width: coords.width }}
                className="glass-panel z-[500] max-h-64 overflow-y-auto p-1"
              >
                {filtered.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No matching instrument</p>
                ) : (
                  filtered.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => selectOption(option)}
                      className={`flex w-full items-center rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        option.id === value.id
                          ? "bg-accent/10 font-medium text-accent"
                          : "text-foreground hover:bg-muted"
                      }`}
                    >
                      {option.label}
                    </button>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
