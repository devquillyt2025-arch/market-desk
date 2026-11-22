"use client";

/**
 * Cards or compact list, remembered on this device. Read through useSyncExternalStore so the server render and the first
 * client render agree (no hydration mismatch) and a change in another tab arrives too. With nothing saved yet, a phone gets
 * the list - nineteen tall cards is a long scroll - and everything else the cards. If localStorage is unavailable the
 * choice still holds for this load.
 */

import { useCallback, useSyncExternalStore } from "react";

import { useMediaQuery } from "@/lib/useMediaQuery";

import type { BoardView } from "./BoardToolbar";

const STORAGE_KEY = "marketdesk:commodities-view";
const CHANGED_EVENT = "marketdesk:commodities-view-changed";

/** What was chosen this load, for when storage can't be read back. */
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

export function useBoardView(): readonly [BoardView, (next: BoardView) => void] {
  const saved = useSyncExternalStore(subscribe, readSaved, () => "");
  const phone = useMediaQuery("(max-width: 639px)");
  const view: BoardView = saved === "cards" || saved === "list" ? saved : phone ? "list" : "cards";

  const save = useCallback((next: BoardView) => {
    remembered = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not remembered beyond this load.
    }
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }, []);

  return [view, save] as const;
}
