"use client";

import { useEffect, useState } from "react";

import { visibleArea } from "@/lib/sheet";

/**
 * The part of the screen not covered by the on-screen keyboard, or null while nothing is. A phone's keyboard shrinks the *visual*
 * viewport and leaves the layout one - and `vh` - alone, so a pop-up sized to the full height ends up with its lower half, the
 * Save button included, behind the keys. A pop-up sized to this stays above them.
 */
export function useVisibleArea(): { top: number; height: number } | null {
  const [area, setArea] = useState<{ top: number; height: number } | null>(null);

  useEffect(() => {
    const visual = window.visualViewport;
    if (!visual) return;
    const update = () => setArea(visibleArea({ height: visual.height, offsetTop: visual.offsetTop }, window.innerHeight));
    update();
    visual.addEventListener("resize", update);
    visual.addEventListener("scroll", update);
    return () => {
      visual.removeEventListener("resize", update);
      visual.removeEventListener("scroll", update);
    };
  }, []);

  return area;
}
