"use client";

import { useState } from "react";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm text-foreground outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30";

type StepperProps = {
  value: number;
  onChange: (v: number) => void;
  step: number;
  min?: number;
  /** Upper bound for both the buttons and typed values; unbounded when omitted. */
  max?: number;
  /** Decimal places to round button steps to, so 0.05 steps don't drift into 100.15000000000001. */
  precision?: number;
  width?: string;
  /** Accessible name for the field; the buttons read "Decrease <label>" / "Increase <label>". */
  label?: string;
  /** Put on the input, so a <label htmlFor> can point at it. */
  id?: string;
  /** Touch-sized controls (44px) on phones, shrinking to the usual 32px from `sm` up. */
  large?: boolean;
};

/** A number field with − / + buttons, shared by the Analysis leg editor and the averaging simulator. */
export default function Stepper({
  value,
  onChange,
  step,
  min = 0,
  max,
  precision,
  width = "w-20",
  label,
  id,
  large = false,
}: StepperProps) {
  // What's typed is held as text until the field loses focus, so it can be
  // emptied or half-typed without the parent snapping it back mid-keystroke.
  // Only a complete, in-range number is passed up.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? (Number.isFinite(value) ? String(value) : "");
  const inRange = (n: number) => n >= min && (max === undefined || n <= max);

  function handleType(text: string) {
    setDraft(text);
    const n = Number(text);
    if (text.trim() !== "" && Number.isFinite(n) && inRange(n)) onChange(n);
  }
  function nudge(delta: number) {
    setDraft(null);
    const next = value + delta;
    const rounded = precision === undefined ? next : Number(next.toFixed(precision));
    onChange(Math.min(max ?? Infinity, Math.max(min, rounded)));
  }

  const btn = `flex shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 ${
    large ? "size-11 text-lg sm:size-8 sm:text-base" : "size-8"
  }`;
  return (
    <div className="flex min-w-0 items-center gap-1">
      <button type="button" className={btn} onClick={() => nudge(-step)} aria-label={label ? `Decrease ${label}` : "Decrease"}>
        −
      </button>
      <input
        type="number"
        inputMode="decimal"
        id={id}
        value={shown}
        aria-label={label}
        onChange={(e) => handleType(e.target.value)}
        onBlur={() => setDraft(null)}
        className={`${INPUT_CLASS} ${width} text-center font-mono tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none ${
          large ? "h-11 sm:h-auto" : ""
        }`}
      />
      <button type="button" className={btn} onClick={() => nudge(step)} aria-label={label ? `Increase ${label}` : "Increase"}>
        +
      </button>
    </div>
  );
}
