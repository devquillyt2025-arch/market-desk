/**
 * The Averaging Simulator's two remembered numbers — available funds and the
 * capital-at-risk limit — kept in localStorage, the same way the Analysis
 * strategy is. They describe the person's own account, not a position, so
 * they stay put between simulations and between positions. A device-local
 * scratch value: it never goes to Supabase.
 */

import { DEFAULT_RISK_LIMIT_PCT } from "@/lib/averaging";

const STORAGE_KEY = "marketdesk:averaging";

export type AveragingPrefs = {
  /** ₹ available to add with; null until entered. */
  funds: number | null;
  /** Percent of funds the premium paid may reach before the drawer warns. */
  riskLimitPct: number;
};

const DEFAULTS: AveragingPrefs = { funds: null, riskLimitPct: DEFAULT_RISK_LIMIT_PCT };

export function loadAveragingPrefs(): AveragingPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object") return DEFAULTS;
    const { funds, riskLimitPct } = v as Record<string, unknown>;
    return {
      funds: typeof funds === "number" && Number.isFinite(funds) && funds > 0 ? funds : null,
      riskLimitPct:
        typeof riskLimitPct === "number" && Number.isFinite(riskLimitPct) && riskLimitPct > 0 && riskLimitPct <= 100
          ? riskLimitPct
          : DEFAULT_RISK_LIMIT_PCT,
    };
  } catch {
    // localStorage may be unavailable (private browsing, disabled storage) or hold invalid JSON.
    return DEFAULTS;
  }
}

export function saveAveragingPrefs(prefs: AveragingPrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage may be unavailable or full; the values just won't persist for this load.
  }
}
