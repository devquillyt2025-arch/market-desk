"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether a CSS media query matches right now, kept up to date as it changes (a phone turned sideways, a window resized).
 * `serverValue` is what the server render and the first client render assume, so they agree: the answer for the usual case.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}
