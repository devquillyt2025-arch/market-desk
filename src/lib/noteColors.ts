import type { NoteColor } from "@/lib/notesStore";

export const NOTE_COLOR_LABELS: Record<NoteColor, string> = {
  default: "Default",
  red: "Red",
  orange: "Orange",
  yellow: "Yellow",
  green: "Green",
  teal: "Teal",
  blue: "Blue",
  purple: "Purple",
  pink: "Pink",
};

type ColorClasses = {
  /** Solid swatch fill — color-picker dots and the card's top accent bar. */
  swatch: string;
  /** Card background tint. */
  bg: string;
  /** Card border tint. */
  border: string;
};

/**
 * Fully-spelled-out Tailwind classes (not built dynamically) so the
 * compiler's static scan actually picks them up — see Tailwind's docs on
 * class detection. Every class referenced anywhere below must appear here
 * as a literal string.
 */
export const NOTE_COLOR_CLASSES: Record<Exclude<NoteColor, "default">, ColorClasses> = {
  red: { swatch: "bg-red-500", bg: "bg-red-500/10", border: "border-red-500/40" },
  orange: { swatch: "bg-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/40" },
  yellow: { swatch: "bg-yellow-500", bg: "bg-yellow-500/10", border: "border-yellow-500/40" },
  green: { swatch: "bg-green-500", bg: "bg-green-500/10", border: "border-green-500/40" },
  teal: { swatch: "bg-teal-500", bg: "bg-teal-500/10", border: "border-teal-500/40" },
  blue: { swatch: "bg-blue-500", bg: "bg-blue-500/10", border: "border-blue-500/40" },
  purple: { swatch: "bg-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/40" },
  pink: { swatch: "bg-pink-500", bg: "bg-pink-500/10", border: "border-pink-500/40" },
};
