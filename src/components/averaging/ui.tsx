"use client";

/**
 * Small pieces shared by every section of the Averaging Simulator: number
 * formatters, a titled section shell, the change chip and the date switch.
 * Colours are the app's own tokens only, so both themes work.
 */

import { motion, useReducedMotion } from "framer-motion";
import { useId, type ReactNode } from "react";

import { ChevronDownIcon, TrendingDownIcon, TrendingUpIcon } from "@/components/icons";
import type { Scenario, ScenarioKey, VerdictTone } from "@/lib/averaging";

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

/** Slim scrollbars in the app's own greys, for tables that scroll inside the page — in place of the browser's thick arrowed ones. */
export const thinScroll =
  "[scrollbar-width:thin] [scrollbar-color:color-mix(in_srgb,var(--muted-foreground)_45%,transparent)_transparent]";

/** Pill button; 44px tall on phones, 36px from `sm`. */
export const pillButton = (active: boolean) =>
  `inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors active:scale-95 sm:min-h-9 ${
    active
      ? "border-accent/50 bg-accent/10 text-accent"
      : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
  }`;

// --- Section shell ------------------------------------------------------------

/**
 * A titled block with a one-line plain-language subtitle saying what question it answers.
 * `step` numbers it, so the page reads as a short guided path: try it, see the result,
 * see the picture, check the maths.
 */
export function Section({
  title,
  subtitle,
  step,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  step?: number;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`flex min-w-0 flex-col gap-3 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 id={id} className="flex items-center gap-2 text-base font-semibold tracking-tight text-foreground">
            {step !== undefined && (
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[11px] font-bold text-accent"
              >
                {step}
              </span>
            )}
            {title}
          </h3>
          {subtitle && <p className={`mt-0.5 text-xs text-muted-foreground ${step !== undefined ? "sm:pl-7" : ""}`}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// --- Entrance -----------------------------------------------------------------

/**
 * Fades a block up into place as the tab opens, a beat after the one above it.
 * Opacity and a short slide only — nothing that changes the layout — and not at
 * all for anyone who has asked their system for less motion.
 */
export function Reveal({ children, index = 0, className = "" }: { children: ReactNode; index?: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index, 6) * 0.05, ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

// --- Verdict tone -------------------------------------------------------------

/** The colours of a verdict, shared by the result card and the compact strip beside the controls. */
export const VERDICT_TONE: Record<VerdictTone, { pill: string; edge: string; glow: string; text: string }> = {
  good: { pill: "bg-profit/10 text-profit", edge: "border-l-profit", glow: "from-profit/10", text: "text-profit" },
  caution: { pill: "bg-warning/10 text-warning", edge: "border-l-warning", glow: "from-warning/10", text: "text-warning" },
  bad: { pill: "bg-loss/15 text-danger-fg", edge: "border-l-danger-fg", glow: "from-loss/15", text: "text-danger-fg" },
  neutral: { pill: "bg-muted text-muted-foreground", edge: "border-l-border", glow: "from-muted", text: "text-muted-foreground" },
};

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

/** "Today" → "Today · Wed, 4 Nov"; a date label already is one, so it stands as it is. */
export function scenarioName(s: Pick<Scenario, "label" | "dateLabel">): string {
  return s.label === s.dateLabel ? s.label : `${s.label} · ${s.dateLabel}`;
}

/**
 * The date switch — drives the chart, the ladder and the highlighted break-even card together.
 * Up to three dates fit as pills (Today / Tomorrow / Expiry); with a date for every day to expiry
 * it becomes a stepper (‹ date ›) with Today and Expiry a tap away, at a fixed width so the
 * control doesn't change size as the date's name does.
 */
export function ScenarioSwitch({
  scenarios,
  value,
  onChange,
}: {
  scenarios: Pick<Scenario, "key" | "label" | "dateLabel">[];
  value: ScenarioKey;
  onChange: (key: ScenarioKey) => void;
}) {
  if (scenarios.length > 3) {
    const index = Math.max(
      scenarios.findIndex((s) => s.key === value),
      0,
    );
    const go = (to: number) => onChange(scenarios[Math.min(Math.max(to, 0), scenarios.length - 1)].key);
    const jump = (key: ScenarioKey, text: string) => (
      <button
        type="button"
        aria-pressed={value === key}
        onClick={() => onChange(key)}
        className={`hidden min-h-8 rounded-full px-3 text-sm font-medium transition-colors active:scale-95 sm:block ${
          value === key ? "bg-accent-solid text-accent-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {text}
      </button>
    );
    const arrow = "flex size-11 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent sm:size-8";
    return (
      <div role="group" aria-label="Date" className="inline-flex items-center gap-1 rounded-full border border-border bg-background p-1">
        {jump(scenarios[0].key, "Today")}
        <button type="button" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous date" className={arrow}>
          <ChevronDownIcon className="size-4 rotate-90" />
        </button>
        <span aria-live="polite" className="w-40 truncate text-center text-sm font-medium tabular-nums sm:w-44">
          {scenarioName(scenarios[index])}
        </span>
        <button type="button" onClick={() => go(index + 1)} disabled={index === scenarios.length - 1} aria-label="Next date" className={arrow}>
          <ChevronDownIcon className="size-4 -rotate-90" />
        </button>
        {jump(scenarios[scenarios.length - 1].key, "Expiry")}
      </div>
    );
  }

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
