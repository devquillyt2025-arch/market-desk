"use client";

/**
 * Small pieces shared by the What-if lab's sections: money formatters that never lose a minus sign,
 * the coloured tag chip, and the rule for whether a change is good, bad or too small to call.
 */

import { formatCompactINR, formatINR } from "@/lib/format";
import type { Tag, TagTone } from "@/lib/whatIf";

/** ₹1,23,456 with a true minus sign for losses. */
export const money = (n: number) => `${n < 0 ? "−" : ""}${formatINR(Math.abs(n))}`;
/** ₹1.2L, for tight spaces. */
export const compactMoney = (n: number) => `${n < 0 ? "−" : ""}₹${formatCompactINR(Math.abs(n))}`;
/** +₹1,234 / −₹1,234 for a change. */
export const signedMoney = (n: number) => (Math.abs(n) < 0.5 ? "₹0" : `${n > 0 ? "+" : "−"}${formatINR(Math.abs(n))}`);
export const percent = (n: number) => `${Math.round(n * 100)}%`;

export type Tone = "good" | "bad" | "neutral";

/** Whether `after` is better, worse, or too close to `before` to call. `eps` is the smallest difference that counts. */
export function toneOf(before: number, after: number, eps: number, higherIsBetter = true): Tone {
  const d = after - before;
  if (Math.abs(d) < eps) return "neutral";
  return d > 0 === higherIsBetter ? "good" : "bad";
}

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-profit",
  bad: "text-danger-fg",
  neutral: "text-foreground",
};

const TAG_TONE: Record<TagTone, string> = {
  good: "bg-profit/10 text-profit",
  bad: "bg-loss/15 text-danger-fg",
  warn: "bg-warning/10 text-warning",
  info: "bg-muted text-muted-foreground",
};

export function TagChip({ tag }: { tag: Tag }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${TAG_TONE[tag.tone]}`}>{tag.label}</span>;
}
