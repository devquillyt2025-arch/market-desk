"use client";

/**
 * Custom dropdown, not a native <select>. Native select popups can only be
 * themed via `color-scheme` (a rough browser dark/light approximation) —
 * there's no CSS that reaches the actual popup chrome in any browser, so it
 * always looked out of place against this app's own theme. This renders the
 * options list itself, so it picks up the same tokens as everything else.
 */

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

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
  triggerClassName?: string;
  align?: "left" | "right";
};

const DEFAULT_TRIGGER_CLASS =
  "flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";

export default function Select<T extends string>({
  value,
  onChange,
  options,
  id,
  triggerClassName,
  align = "left",
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        id={id}
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={triggerClassName ?? DEFAULT_TRIGGER_CLASS}
      >
        <span className="truncate">{selected?.label ?? ""}</span>
        <ChevronDownIcon
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.ul
            role="listbox"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className={`absolute top-[calc(100%+4px)] z-50 max-h-60 min-w-full overflow-auto rounded-lg border border-border bg-card p-1 shadow-lg ${
              align === "right" ? "right-0" : "left-0"
            }`}
          >
            {options.map((option) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={`flex cursor-pointer items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors ${
                  option.value === value ? "bg-accent/10 text-accent" : "text-foreground hover:bg-muted"
                }`}
              >
                {option.label}
                {option.value === value && <CheckIcon className="size-3.5 shrink-0" />}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
