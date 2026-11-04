"use client";

/**
 * A figure that glides to its new value instead of snapping — drag the slider and
 * the average, break-even and risk tiles roll with it. The digits are written
 * straight into the page by the motion value (no React re-render per frame), the
 * figures are tabular so nothing shifts sideways, and anyone who has asked for
 * less motion just gets the new number.
 */

import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "framer-motion";
import { useEffect } from "react";

export default function AnimatedNumber({
  value,
  format,
  fallback = "—",
}: {
  value: number | null;
  /** Keep this a stable function (declared outside the component) — it runs on every frame. */
  format: (n: number) => string;
  /** What to show when there's no number. */
  fallback?: string;
}) {
  const reduce = useReducedMotion();
  const motionValue = useMotionValue(value ?? 0);
  const text = useTransform(motionValue, format);

  useEffect(() => {
    if (value === null) return;
    if (reduce) {
      motionValue.set(value);
      return;
    }
    const controls = animate(motionValue, value, { duration: 0.3, ease: "easeOut" });
    return () => controls.stop();
  }, [value, reduce, motionValue]);

  if (value === null) return <>{fallback}</>;
  return <motion.span>{text}</motion.span>;
}
