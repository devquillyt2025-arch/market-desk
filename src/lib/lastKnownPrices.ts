/**
 * The last live prices each screen saw, kept in localStorage so an expired
 * Upstox token doesn't blank them. Tokens lapse around 3:30 AM every day, so
 * the usual case is opening the app in the morning with nothing in memory —
 * only a persisted copy can still show yesterday's close. Same approach (and
 * same reasoning) as savedAnalysis.ts: it's a display convenience for this
 * device, not data worth a Supabase table.
 *
 * Everything here only ever reads or writes after a poll has already
 * resolved, never during render, so there's no SSR/hydration mismatch to
 * worry about — and every call is a quiet no-op if storage is unavailable.
 */

import type { LegSnapshot, LegSnapshots } from "@/lib/calculatePortfolio";
import { INSTRUMENTS, type Instrument } from "@/lib/types";
import type { HeatmapQuote, IndexQuote } from "@/lib/upstox/types";

const LEG_PRICES_KEY = "marketdesk:last-leg-prices";
const HEATMAP_KEY = "marketdesk:last-heatmap";
const SPOT_KEY = "marketdesk:last-spot";

/** Snapshots for contracts nobody has looked at since are dropped on the next save — expired contracts would otherwise pile up forever. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as unknown) : null;
  } catch {
    // localStorage may be unavailable (private browsing, disabled storage) or hold invalid JSON.
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // localStorage may be unavailable or full; the last prices just won't survive a reload.
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

const isNumberOrNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v));

// --- Live Portfolio / Paper Trade: one snapshot per contract -------------------

function isLegSnapshot(value: unknown): value is LegSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.at === "number" &&
    typeof value.ltp === "number" &&
    Number.isFinite(value.ltp) &&
    (value.instrumentKey === null || typeof value.instrumentKey === "string") &&
    // Snapshots saved before prevClose existed lack it; they're still good, and loadLegSnapshots fills it in.
    (value.prevClose === undefined || isNumberOrNull(value.prevClose)) &&
    isNumberOrNull(value.delta) &&
    isNumberOrNull(value.gamma) &&
    isNumberOrNull(value.theta) &&
    isNumberOrNull(value.vega) &&
    isNumberOrNull(value.oi) &&
    isNumberOrNull(value.iv) &&
    isNumberOrNull(value.volume) &&
    isNumberOrNull(value.underlyingSpot) &&
    isNumberOrNull(value.nearbyIv)
  );
}

/** Empty when nothing usable is saved; a snapshot that fails validation is dropped individually. */
export function loadLegSnapshots(): LegSnapshots {
  const parsed = readJson(LEG_PRICES_KEY);
  if (!isRecord(parsed)) return {};
  const out: LegSnapshots = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (isLegSnapshot(value)) out[key] = { ...value, prevClose: value.prevClose ?? null };
  }
  return out;
}

export function saveLegSnapshots(snapshots: LegSnapshots): void {
  const cutoff = Date.now() - MAX_AGE_MS;
  writeJson(LEG_PRICES_KEY, Object.fromEntries(Object.entries(snapshots).filter(([, s]) => s.at >= cutoff)));
}

// --- Heatmap: one payload per index + range ------------------------------------

export type StoredHeatmap = {
  quotes: HeatmapQuote[];
  indices: IndexQuote[];
  /** When this index + range last loaded successfully. */
  at: number;
};

function isStoredHeatmap(value: unknown): value is StoredHeatmap {
  return isRecord(value) && typeof value.at === "number" && Array.isArray(value.quotes) && Array.isArray(value.indices);
}

/** Null when this index + range was never saved. */
export function loadHeatmap(key: string): StoredHeatmap | null {
  const parsed = readJson(HEATMAP_KEY);
  if (!isRecord(parsed)) return null;
  const entry = parsed[key];
  return isStoredHeatmap(entry) ? entry : null;
}

export function saveHeatmap(key: string, payload: StoredHeatmap): void {
  const parsed = readJson(HEATMAP_KEY);
  writeJson(HEATMAP_KEY, { ...(isRecord(parsed) ? parsed : {}), [key]: payload });
}

// --- Analysis: the underlying's spot -------------------------------------------

export type StoredSpot = { value: number; at: number };

/** Empty when nothing usable is saved. */
export function loadLastSpots(): Partial<Record<Instrument, StoredSpot>> {
  const parsed = readJson(SPOT_KEY);
  if (!isRecord(parsed)) return {};
  const out: Partial<Record<Instrument, StoredSpot>> = {};
  for (const instrument of INSTRUMENTS) {
    const v = parsed[instrument];
    if (isRecord(v) && typeof v.value === "number" && v.value > 0 && typeof v.at === "number") {
      out[instrument] = { value: v.value, at: v.at };
    }
  }
  return out;
}

export function saveLastSpot(instrument: Instrument, spot: StoredSpot): void {
  writeJson(SPOT_KEY, { ...loadLastSpots(), [instrument]: spot });
}
