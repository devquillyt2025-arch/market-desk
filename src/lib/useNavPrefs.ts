"use client";

/**
 * The saved choice of navigation tabs, as a hook. Read through useSyncExternalStore so the server render (and the first client
 * one) show the app's own nav - no hydration mismatch - and a change made in another tab of the browser arrives too. If
 * localStorage is unavailable (private browsing, blocked site data) the choice still holds for this load.
 */

import { useCallback, useMemo, useSyncExternalStore } from "react";

import { defaultNavPrefs, parseNavPrefs, serializeNavPrefs, type NavPrefs } from "@/lib/navPrefs";

const STORAGE_KEY = "marketdesk:nav-tabs";
const CHANGED_EVENT = "marketdesk:nav-tabs-changed";

/** The sidebar takes over from the phone's tab bar at this width (Tailwind's `lg`). */
export const DESKTOP_NAV_QUERY = "(min-width: 1024px)";

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

/**
 * Takes the new choice, null to go back to the app's own nav, or a function from the current choice to the new one - the latter is
 * what a drag needs, firing faster than React re-renders. The current choice it is given is, for a device that hasn't chosen yet,
 * the default for the screen it is on (a phone starts from the bar it has).
 */
export type SaveNavPrefs = (next: NavPrefs | null | ((current: NavPrefs) => NavPrefs)) => void;

export function useNavPrefs(): readonly [NavPrefs | null, SaveNavPrefs] {
  const raw = useSyncExternalStore(subscribe, readSaved, () => "");
  // Memoised on the saved string, so the same choice is the same object between renders (effects and memos can depend on it).
  const prefs = useMemo(() => parseNavPrefs(raw), [raw]);
  const save = useCallback<SaveNavPrefs>((next) => {
    let value: NavPrefs | null;
    if (typeof next === "function") {
      const phone = !window.matchMedia(DESKTOP_NAV_QUERY).matches;
      value = next(parseNavPrefs(readSaved()) ?? defaultNavPrefs(phone));
    } else {
      value = next;
    }
    remembered = value ? serializeNavPrefs(value) : "";
    try {
      if (value) localStorage.setItem(STORAGE_KEY, remembered);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // localStorage may be unavailable or full; the choice just won't outlive this load.
    }
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }, []);
  return [prefs, save] as const;
}
