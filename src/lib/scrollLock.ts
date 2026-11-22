"use client";

import { useEffect } from "react";

/**
 * Keeps the page from scrolling behind an open pop-up. Without it a finger moving over the dimmed backdrop scrolls the page
 * underneath (and on a phone the whole screen is "the backdrop"). Two things scroll in this app - the document (desktop) and
 * the content area of the phone layout (#main-content) - so both are held still. Counted: two pop-ups open at once (a
 * confirmation over an editor) release it only when the last one closes.
 */

type Lockable = { style: { overflow: string } };

let locks = 0;
let saved: { target: Lockable; overflow: string }[] = [];

function defaultTargets(): Lockable[] {
  const main = document.getElementById("main-content");
  return main ? [document.documentElement, main] : [document.documentElement];
}

/** Locks scrolling; returns the function that releases this lock. `targets` is for tests. */
export function lockScroll(targets: () => Lockable[] = defaultTargets): () => void {
  if (locks === 0) {
    saved = targets().map((target) => ({ target, overflow: target.style.overflow }));
    for (const { target } of saved) target.style.overflow = "hidden";
  }
  locks++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    locks--;
    if (locks === 0) {
      for (const { target, overflow } of saved) target.style.overflow = overflow;
      saved = [];
    }
  };
}

/** Holds the page still for as long as the calling pop-up is mounted. */
export function useScrollLock(): void {
  useEffect(() => lockScroll(), []);
}
