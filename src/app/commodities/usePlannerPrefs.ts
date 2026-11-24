/**
 * What the planner remembers on this device: the contract and the timeframe. Saved the way the ticker and tab choices are (localStorage,
 * read through an external store), so a reload comes back to the same view.
 * Anything unreadable or out of range falls back to its default. The contract is shared: the Natural gas tab reads and sets the same one.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { parseContractPref, type ContractPref } from "@/lib/natgasContract";
import { isTimeframe, type Timeframe } from "@/lib/natgasPlanner/config";

export type { ContractPref };

export type PlannerPrefs = {
  contract: ContractPref;
  tf: Timeframe;
};

export const DEFAULT_PREFS: PlannerPrefs = { contract: "default", tf: 5 };

const KEY = "marketdesk:planner-prefs";
const CHANGED = "marketdesk:planner-prefs-changed";

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
    contract: parseContractPref(o.contract) ?? DEFAULT_PREFS.contract,
    tf: typeof o.tf === "number" && isTimeframe(o.tf) ? o.tf : DEFAULT_PREFS.tf,
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
