/**
 * The Analysis tab's working strategy, kept in localStorage so it survives
 * switching tabs and closing the app — only "Clear All" empties it. Same
 * approach (and same reasoning) as the Brokerage Calculator's saved legs: it's
 * a scratchpad, so it lives on this device instead of in Supabase.
 *
 * Deliberately not saved: the target-spot/target-date sliders and the chart
 * tab. They're what-ifs measured against *today's* live spot and date, so a
 * copy from a previous day would just be stale — they reopen at their defaults.
 */

import type { DraftLeg } from "@/lib/strategyTransfer";
import { INSTRUMENTS, type Instrument } from "@/lib/types";

const STORAGE_KEY = "marketdesk:analysis";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SavedAnalysis = {
  instrument: Instrument;
  legs: DraftLeg[];
  /** The manual spot field, as typed — empty means "use the live spot". */
  spotOverride: string;
};

function isSavedLeg(value: unknown): value is DraftLeg {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.enabled === "boolean" &&
    (v.side === "buy" || v.side === "sell") &&
    (v.type === "CE" || v.type === "PE") &&
    typeof v.strike === "number" &&
    v.strike > 0 &&
    typeof v.expiry === "string" &&
    ISO_DATE.test(v.expiry) &&
    typeof v.lots === "number" &&
    Number.isInteger(v.lots) &&
    v.lots >= 1 &&
    typeof v.price === "string"
  );
}

/** Null when nothing usable is saved. Legs that fail validation are dropped individually rather than discarding the whole strategy. */
export function loadSavedAnalysis(): SavedAnalysis | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const v = parsed as Record<string, unknown>;
    if (!(INSTRUMENTS as readonly unknown[]).includes(v.instrument) || !Array.isArray(v.legs)) return null;
    return {
      instrument: v.instrument as Instrument,
      legs: v.legs.filter(isSavedLeg),
      spotOverride: typeof v.spotOverride === "string" ? v.spotOverride : "",
    };
  } catch {
    // localStorage may be unavailable (private browsing, disabled storage) or hold invalid JSON.
    return null;
  }
}

export function saveAnalysis(analysis: SavedAnalysis): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(analysis));
  } catch {
    // localStorage may be unavailable or full; the strategy just won't persist for this load.
  }
}
