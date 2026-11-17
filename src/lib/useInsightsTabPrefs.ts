"use client";

/**
 * The saved choice of insight tabs, as a hook. Read through useSyncExternalStore so the server render (and the first
 * client one) show everything - no hydration mismatch - and a change made in another tab of the browser arrives too.
 * If localStorage is unavailable (private browsing, blocked site data) the choice still holds for this load.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { parseInsightsTabPrefs, serializeInsightsTabPrefs, type InsightsTabPrefs } from "@/lib/insightsTabPrefs";

const STORAGE_KEY = "marketdesk:insights-tabs";
const CHANGED_EVENT = "marketdesk:insights-tabs-changed";

/** What was saved this load, for when storage can't be read back. */
let remembered = "";

function subscribe(callback: () => void): () => void {
  window.addEventListener("storage", callback);
  window.addEventListener(CHANGED_EVENT, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(CHANGED_EVENT, callback);
  };
}

function readSaved(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? remembered;
  } catch {
    return remembered;
  }
}

export function useInsightsTabPrefs(): readonly [InsightsTabPrefs, (next: InsightsTabPrefs) => void] {
  const raw = useSyncExternalStore(subscribe, readSaved, () => "");
  const prefs = useMemo(() => parseInsightsTabPrefs(raw), [raw]);
  const save = useCallback((next: InsightsTabPrefs) => {
    remembered = serializeInsightsTabPrefs(next);
    try {
      localStorage.setItem(STORAGE_KEY, remembered);
    } catch {
      // localStorage may be unavailable or full; the choice just won't outlive this load.
    }
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }, []);
  return [prefs, save] as const;
}
