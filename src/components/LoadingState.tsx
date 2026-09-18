"use client";

import { motion } from "framer-motion";

/** Alternating profit/loss colors and staggered heights read as a little candlestick chart rather than a generic spinner. */
const BARS = [
  { height: 45, color: "bg-loss" },
  { height: 75, color: "bg-profit" },
  { height: 100, color: "bg-loss" },
  { height: 65, color: "bg-profit" },
  { height: 50, color: "bg-loss" },
];

type LoadingStateProps = {
  /** Sizing/spacing for the container — pass a height utility to match whatever this replaces (e.g. "h-40"). */
  className?: string;
  /** Set to "" to omit the caption entirely. */
  label?: string;
};

/**
 * Replaces the flat gray `animate-pulse` skeleton blocks used while a
 * view's initial data is still loading. A single glance reads this as
 * "loading" the way a spinner would — unlike a stack of pulsing skeleton
 * rows, which only reads as motion if you watch it for a moment — and the
 * candlestick motif is on-brand for a trading app rather than generic.
 */
export default function LoadingState({ className, label = "Loading…" }: LoadingStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className={`flex flex-col items-center justify-center gap-3 rounded-xl border border-border bg-background ${className ?? ""}`}
    >
      <div className="flex h-10 items-end gap-1.5">
        {BARS.map((bar, i) => (
          <motion.span
            key={i}
            className={`w-2 rounded-sm ${bar.color}`}
            style={{ height: `${bar.height}%`, transformOrigin: "bottom" }}
            animate={{ scaleY: [0.35, 1, 0.35] }}
            transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut", delay: i * 0.1 }}
          />
        ))}
      </div>
      {label && <span className="text-xs font-medium text-muted-foreground">{label}</span>}
    </motion.div>
  );
}
