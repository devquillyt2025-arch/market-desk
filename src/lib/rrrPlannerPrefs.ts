/**
 * The RRR planner's remembered choices - which index, how long to hold, which look-back the volatility is
 * measured over, a volatility typed by hand, and a stop of your own - kept in localStorage so they are
 * still there next time, the same way the Analysis strategy and the averaging prefs are. They describe
 * how the person trades, not a position, so they are a device-local scratch value: they never go to Supabase.
 */

import { INDEX_INSTRUMENTS, type IndexInstrument } from "@/lib/types";
import { VOLATILITY_WINDOWS } from "@/lib/volatility";
import { HORIZONS, INTRADAY_STARTS } from "@/lib/rrrPlanner";

const STORAGE_KEY = "marketdesk:rrr-planner";

export type PlannerPrefs = {
  instrument: IndexInstrument;
  /** Trading days the trade is held at most. */
  days: number;
  /** The trade is opened and closed within one session; `days` is then ignored. */
  intraday: boolean;
  /** How much of the session is left when an intraday trade starts (see INTRADAY_STARTS): 1 is the open. */
  intradayLeft: number;
  /** Sessions of history the volatility is measured over. */
  window: number;
  /** An annual volatility typed by hand, in percent; null to use the one measured from the index. */
  manualAnnualPct: number | null;
  /** A stop of your own to try beside the usual ones, in percent; null for none. */
  customStopPct: number | null;
};

export const DEFAULT_PLANNER_PREFS: PlannerPrefs = { instrument: "NIFTY", days: 5, intraday: false, intradayLeft: 1, window: 60, manualAnnualPct: null, customStopPct: null };

const inRange = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;

/** Whatever was stored, as prefs: each field that is missing or not one of the choices on offer falls back to its default on its own. */
export function parsePlannerPrefs(raw: unknown): PlannerPrefs {
  if (!raw || typeof raw !== "object") return DEFAULT_PLANNER_PREFS;
  const v = raw as Record<string, unknown>;
  const d = DEFAULT_PLANNER_PREFS;
  return {
    instrument: (INDEX_INSTRUMENTS as readonly unknown[]).includes(v.instrument) ? (v.instrument as IndexInstrument) : d.instrument,
    days: HORIZONS.includes(v.days as number) ? (v.days as number) : d.days,
    intraday: v.intraday === true,
    intradayLeft: INTRADAY_STARTS.some((x) => x.left === v.intradayLeft) ? (v.intradayLeft as number) : d.intradayLeft,
    window: (VOLATILITY_WINDOWS as readonly unknown[]).includes(v.window) ? (v.window as number) : d.window,
    manualAnnualPct: inRange(v.manualAnnualPct, 1, 200) ? v.manualAnnualPct : null,
    customStopPct: inRange(v.customStopPct, 0.1, 50) ? v.customStopPct : null,
  };
}

export function loadPlannerPrefs(): PlannerPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parsePlannerPrefs(JSON.parse(raw)) : DEFAULT_PLANNER_PREFS;
  } catch {
    // localStorage may be unavailable (private browsing, disabled storage) or hold invalid JSON.
    return DEFAULT_PLANNER_PREFS;
  }
}

export function savePlannerPrefs(prefs: PlannerPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable or full; the values just won't persist for this load.
  }
}
