/**
 * The small decisions behind a phone's pop-ups, with no React and no DOM so they can be tested on their own: when a swipe
 * down closes a bottom sheet, where a floating popup may sit so it stays on screen, and how much of the screen is left once
 * the keyboard is up.
 */

/** How far a sheet has to be dragged down - or how fast it has to be flicked - before it closes instead of springing back. */
export const SHEET_DISMISS_DISTANCE = 120;
export const SHEET_DISMISS_VELOCITY = 600;

/** `offsetY` in px, `velocityY` in px/s, both positive downwards. A tiny drag, even a quick one, is a tap, not a dismissal. */
export function shouldDismissSheet(offsetY: number, velocityY: number): boolean {
  if (offsetY > SHEET_DISMISS_DISTANCE) return true;
  return velocityY > SHEET_DISMISS_VELOCITY && offsetY > 24;
}

type PopupInput = {
  /** The field the popup belongs to, in viewport coordinates. */
  triggerLeft: number;
  triggerTop: number;
  triggerBottom: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  /** Space between the field and the popup; and the least space left to the screen's edge. */
  gap?: number;
  margin?: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

/**
 * Where a popup opens: under its field and lined up with its left edge - unless that would run off the screen. It is
 * pulled in from the right (a calendar opened from the right-hand column of a form used to hang 67px off a 390px phone), and
 * flips above the field when there is no room below and more room above.
 */
export function popupPosition(input: PopupInput): { left: number; top: number } {
  const { triggerLeft, triggerTop, triggerBottom, width, height, viewportWidth, viewportHeight, gap = 4, margin = 8 } = input;
  const left = clamp(triggerLeft, margin, viewportWidth - width - margin);

  const below = triggerBottom + gap;
  if (below + height <= viewportHeight - margin) return { left, top: below };
  const above = triggerTop - gap - height;
  const roomBelow = viewportHeight - margin - below;
  const roomAbove = triggerTop - gap - margin;
  if (above >= margin || roomAbove > roomBelow) return { left, top: clamp(above, margin, viewportHeight - height - margin) };
  return { left, top: clamp(below, margin, viewportHeight - height - margin) };
}

/**
 * The part of the screen a pop-up can use. Opening the keyboard shrinks the *visual* viewport but leaves the layout one (and
 * `vh`) as it was, so a panel sized from the full height ends up behind the keys. Null when the two agree - nothing to adjust.
 */
export function visibleArea(visual: { height: number; offsetTop: number } | null, layoutHeight: number): { top: number; height: number } | null {
  if (!visual) return null;
  // A viewport with no height (a browser still starting up, an embedded view) isn't a keyboard - sizing a pop-up to it would
  // collapse the pop-up to nothing.
  if (!(visual.height > 0)) return null;
  if (Math.abs(layoutHeight - visual.height) < 1 && visual.offsetTop < 1) return null;
  return { top: Math.max(0, Math.round(visual.offsetTop)), height: Math.round(visual.height) };
}

/**
 * Which edge of its button a dropdown menu hangs from so that it stays on screen. "right" lines the menu's right edge up with the
 * button's (the menu extends to the left) - how the menus under a right-hand button have always sat, so it wins whenever it fits.
 * "left" lines the left edges up (the menu extends to the right). On a phone the same button often sits at the left of the screen,
 * where a right-aligned 288px menu opened 157px past the edge. When neither fits, it hangs from the side with more room.
 */
export function menuAlign(input: { triggerLeft: number; triggerRight: number; menuWidth: number; viewportWidth: number; margin?: number }): "left" | "right" {
  const { triggerLeft, triggerRight, menuWidth, viewportWidth, margin = 8 } = input;
  if (triggerRight - menuWidth >= margin) return "right";
  if (triggerLeft + menuWidth <= viewportWidth - margin) return "left";
  return triggerLeft > viewportWidth - triggerRight ? "right" : "left";
}
