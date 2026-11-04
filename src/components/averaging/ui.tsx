"use client";

/**
 * Small pieces shared by every section of the Averaging Simulator: number
 * formatters, a titled section shell, the change chip and the date switch.
 * Colours are the app's own tokens only, so both themes work.
 */

import { useId, type ReactNode } from "react";

import { TrendingDownIcon, TrendingUpIcon } from "@/components/icons";
import type { Scenario, ScenarioKey } from "@/lib/averaging";

// --- Formatters ---------------------------------------------------------------

/** `|| 0` folds -0 into plain 0 — otherwise a tiny negative rounds to "-0". */
export const whole = (n: number) => Math.round(n) || 0;
export const signedPts = (n: number) => `${n > 0 ? "+" : ""}${whole(n).toLocaleString("en-IN")} ${Math.abs(whole(n)) === 1 ? "pt" : "pts"}`;
export const plainPts = (n: number) => `${Math.abs(whole(n)).toLocaleString("en-IN")} ${Math.abs(whole(n)) === 1 ? "pt" : "pts"}`;
export const signedPct = (n: number, d = 1) => `${n > 0 ? "+" : n < 0 ? "-" : ""}${Math.abs(n).toFixed(d)}%`;
export const signedRupee = (n: number, d = 0) =>
  `${n > 0 ? "+" : n < 0 ? "-" : ""}₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
/** 0–1 as a percentage. */
export const pct = (n: number | null) => (n === null ? "—" : `${(n * 100).toFixed(1)}%`);
export const num = (n: number, d = 2) => n.toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d });

// --- Shared classes -----------------------------------------------------------

export const eyebrow = "text-xs font-semibold uppercase tracking-wide text-muted-foreground";
export const tableHead = "whitespace-nowrap px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground";

/** Pill button; 44px tall on phones, 36px from `sm`. */
export const pillButton = (active: boolean) =>
  `inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors active:scale-95 sm:min-h-9 ${
    active
      ? "border-accent/50 bg-accent/10 text-accent"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;

// --- Section shell ------------------------------------------------------------

/** A titled block with a one-line plain-language subtitle saying what question it answers. */
export function Section({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={id} className="text-sm font-semibold tracking-tight text-foreground">
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// --- Change chip --------------------------------------------------------------

export type Quality = "good" | "bad" | "neutral";

/** An arrow and a signed figure — direction and meaning are in the shape and the text, not only the colour. */
export function DeltaChip({
  direction,
  quality,
  children,
}: {
  direction: "up" | "down" | "flat";
  quality: Quality;
  children: ReactNode;
}) {
  const tone =
    quality === "good" ? "bg-profit/10 text-profit" : quality === "bad" ? "bg-loss/15 text-danger-fg" : "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${tone}`}>
      {direction === "up" && <TrendingUpIcon className="size-3" />}
      {direction === "down" && <TrendingDownIcon className="size-3" />}
      {children}
    </span>
  );
}

// --- Date switch --------------------------------------------------------------

/** Today / Tomorrow / Expiry — drives the chart, the ladder and the highlighted break-even card together. */
export function ScenarioSwitch({
  scenarios,
  value,
  onChange,
}: {
  scenarios: Pick<Scenario, "key" | "label">[];
  value: ScenarioKey;
  onChange: (key: ScenarioKey) => void;
}) {
  return (
    <div role="group" aria-label="Date" className="inline-flex gap-1 rounded-full border border-border bg-background p-1">
      {scenarios.map((s) => {
        const active = s.key === value;
        return (
          <button
            key={s.key}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(s.key)}
            className={`min-h-9 rounded-full px-3.5 text-sm font-medium transition-colors active:scale-95 sm:min-h-8 sm:px-3 ${
              active ? "bg-accent-solid text-accent-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}
