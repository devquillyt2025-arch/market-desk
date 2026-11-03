"use client";

/**
 * Applies the OS "reduce motion" setting to every framer-motion animation in
 * the app. CSS transitions are handled in globals.css; this covers the
 * JS-driven ones (dialog entrances, row fades, the active-nav pill), which the
 * media query can't reach. "user" keeps simple fades but drops the movement and
 * scaling, which is what the setting is asking for.
 */

import { MotionConfig } from "framer-motion";

export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
