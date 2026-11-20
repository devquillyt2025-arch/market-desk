"use client";

/**
 * The saved choice for the ticker across the top of every page, as a hook. Read through useSyncExternalStore so the server render
 * (and the first client one) show the default - no hydration mismatch - and a change made in another tab of the browser arrives
 * too. If localStorage is unavailable (private browsing, blocked site data) the choice still holds for this load.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { parseTickerPrefs, serializeTickerPrefs, type TickerPrefs } from "@/lib/tickerPrefs";

const STORAGE_KEY = "marketdesk:ticker";
const CHANGED_EVENT = "marketdesk:ticker-changed";

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

/** Takes the new choice, or a function from the current choice to it - the latter is what a drag needs, firing faster than React re-renders. */
export type SaveTickerPrefs = (next: TickerPrefs | ((current: TickerPrefs) => TickerPrefs)) => void;

export function useTickerPrefs(): readonly [TickerPrefs, SaveTickerPrefs] {
  const raw = useSyncExternalStore(subscribe, readSaved, () => "");
  const prefs = useMemo(() => parseTickerPrefs(raw), [raw]);
  const save = useCallback<SaveTickerPrefs>((next) => {
    const value = typeof next === "function" ? next(parseTickerPrefs(readSaved())) : next;
    remembered = serializeTickerPrefs(value);
    try {
      localStorage.setItem(STORAGE_KEY, remembered);
    } catch {
      // localStorage may be unavailable or full; the choice just won't outlive this load.
    }
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }, []);
  return [prefs, save] as const;
}
