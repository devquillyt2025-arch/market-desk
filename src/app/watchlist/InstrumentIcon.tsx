import type { CSSProperties } from "react";

import { iconTone, instrumentIconKind, type IconKind } from "@/lib/instrumentIcon";
import { itemGlyph, type WatchlistItem } from "@/lib/watchlist";

/** The drawings: simple filled shapes on a 24px grid, in the tile's colour, with a lighter second tone for depth. */
function Drawing({ icon }: { icon: Exclude<IconKind, "monogram"> }) {
  const cut = "var(--card)"; // the highlights are the card showing through
  switch (icon) {
    case "oil":
      return (
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M12 2.6c3.5 4.2 6.3 7.3 6.3 10.7a6.3 6.3 0 0 1-12.6 0C5.7 9.9 8.5 6.8 12 2.6z" />
          <path d="M8.9 14.3a3.3 3.3 0 0 0 2.7 3.1" fill="none" stroke={cut} strokeOpacity=".65" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    case "gas":
      return (
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M12.7 2.4c.6 3.2-1.9 4.9-3.5 7.2C7.9 11.5 7 13 7 15.1a5 5 0 0 0 10 0c0-2.5-1.2-4.1-2.5-5.6-.2 1.5-.9 2.4-1.9 2.9.6-3.5.3-6.3.1-10z" />
          <path d="M12 20a2.4 2.4 0 0 1-2.4-2.4c0-1.4 1-2.2 1.8-3.1.3 1 1.2 1.4 1.9 2.1.6.6 1.1 1.2 1.1 2.1A2.4 2.4 0 0 1 12 20z" fill={cut} fillOpacity=".55" />
        </svg>
      );
    case "gold":
      return (
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M7.2 11 8.8 5.5h6.4L16.8 11z" />
          <path d="M1.8 18l1.6-5.5h6.8L11.8 18z" fillOpacity=".7" />
          <path d="M12.2 18l1.6-5.5h6.8l1.6 5.5z" fillOpacity=".7" />
        </svg>
      );
    case "silver":
      return (
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="5.6" fill="none" stroke={cut} strokeOpacity=".6" strokeWidth="1.6" />
        </svg>
      );
    case "copper":
    case "metal":
      return (
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M5.5 9.5 8.5 5h10l-3 4.5z" fillOpacity=".55" />
          <path d="M5.5 9.5h10V19h-10z" />
          <path d="M15.5 9.5 18.5 5v9.5L15.5 19z" fillOpacity=".75" />
        </svg>
      );
    case "agri":
      return (
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M4.5 19.5C4.5 10.5 9.8 4.5 20 4.5c0 10-6 15.5-14.5 15.5-.7 0-1-.1-1-.5z" />
          <path d="M5 19.5 13.5 11" fill="none" stroke={cut} strokeOpacity=".6" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "power":
      return (
        <svg viewBox="0 0 24 24" className="size-5" fill="currentColor">
          <path d="M13.4 2 5.5 13.2h5.7L10.4 22l8.1-11.4h-5.8z" />
        </svg>
      );
  }
}

/**
 * An instrument's tile: a drawn icon for a commodity (oil drop, gas flame, gold bars ...), a monogram placeholder for an index
 * or a stock. Tinted by the instrument (see lib/instrumentIcon.ts), from theme tokens, so it holds in light and dark.
 * Decorative - the name beside it says what it is.
 */
export function InstrumentIcon({ item, className = "size-9 rounded-lg" }: { item: Pick<WatchlistItem, "kind" | "symbol" | "name">; className?: string }) {
  const icon = instrumentIconKind(item);
  return (
    <span
      aria-hidden="true"
      style={{ "--tone": iconTone(item) } as CSSProperties}
      className={`flex shrink-0 items-center justify-center bg-[image:linear-gradient(145deg,color-mix(in_srgb,var(--tone)_28%,var(--card)),color-mix(in_srgb,var(--tone)_8%,var(--card)))] text-[color-mix(in_srgb,var(--tone)_75%,var(--foreground))] ring-1 ring-inset ring-[color-mix(in_srgb,var(--tone)_30%,transparent)] ${className}`}
    >
      {icon === "monogram" ? <span className="text-[11px] font-semibold tracking-tight">{itemGlyph(item)}</span> : <Drawing icon={icon} />}
    </span>
  );
}
