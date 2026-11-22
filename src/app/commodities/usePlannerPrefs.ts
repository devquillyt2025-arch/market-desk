/**
 * What the planner remembers on this device: the timeframe, side, ratio, how the stop is sized, and the risk budget. Saved the way
 * the ticker and tab choices are (localStorage, read through an external store), so a reload comes back to the same plan.
 * Anything unreadable or out of range falls back to its default.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { ATR_MULT_RANGE, DEFAULT_ATR_MULT, DEFAULT_RATIO, isTimeframe, RATIOS, type Timeframe } from "@/lib/natgasPlanner/config";

export type PlannerSide = "auto" | "long" | "short";
export type StopMode = "atr" | "pct" | "abs";

export type PlannerPrefs = {
  tf: Timeframe;
  side: PlannerSide;
  ratio: number;
  atrMult: number;
  stopMode: StopMode;
  /** Percent of the entry price for `pct`, rupees a mmBtu for `abs`. */
  stopValue: number;
  /** Rupees to risk (net, at the stop); 0 for none set. */
  riskBudget: number;
};

export const DEFAULT_PREFS: PlannerPrefs = { tf: 5, side: "auto", ratio: DEFAULT_RATIO, atrMult: DEFAULT_ATR_MULT, stopMode: "atr", stopValue: 0.5, riskBudget: 0 };

const KEY = "marketdesk:planner-prefs";
const CHANGED = "marketdesk:planner-prefs-changed";

const num = (v: unknown, fallback: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : fallback);

/** Exported for testing. */
export function parsePrefs(raw: string | null): PlannerPrefs {
  let o: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object") o = parsed as Record<string, unknown>;
  } catch {
    // unreadable: the defaults
  }
  return {
    tf: typeof o.tf === "number" && isTimeframe(o.tf) ? o.tf : DEFAULT_PREFS.tf,
    side: o.side === "long" || o.side === "short" || o.side === "auto" ? o.side : DEFAULT_PREFS.side,
    ratio: typeof o.ratio === "number" && (RATIOS as readonly number[]).includes(o.ratio) ? o.ratio : DEFAULT_PREFS.ratio,
    atrMult: num(o.atrMult, DEFAULT_PREFS.atrMult, ATR_MULT_RANGE.min, ATR_MULT_RANGE.max),
    stopMode: o.stopMode === "pct" || o.stopMode === "abs" || o.stopMode === "atr" ? o.stopMode : DEFAULT_PREFS.stopMode,
    stopValue: num(o.stopValue, DEFAULT_PREFS.stopValue, 0, 1000),
    riskBudget: num(o.riskBudget, 0, 0, 100_000_000),
  };
}

function read(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGED, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGED, onChange);
  };
}

let memory: string | null = null;

export function usePlannerPrefs(): [PlannerPrefs, (patch: Partial<PlannerPrefs>) => void] {
  const raw = useSyncExternalStore(subscribe, () => memory ?? read(), () => null);
  const prefs = useMemo(() => parsePrefs(raw), [raw]);
  const update = useCallback((patch: Partial<PlannerPrefs>) => {
    const next = JSON.stringify(parsePrefs(JSON.stringify({ ...parsePrefs(memory ?? read()), ...patch })));
    memory = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // private mode or full: it still works for this visit, through `memory`
    }
    window.dispatchEvent(new Event(CHANGED));
  }, []);
  return [prefs, update];
}
