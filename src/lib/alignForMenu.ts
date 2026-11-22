import { menuAlign } from "@/lib/sheet";

/**
 * Measures a menu's button now and says which edge the menu should hang from (see menuAlign). Called as the menu is opened, in the
 * click handler, so the answer is in place for its first frame. `menuWidth` is the menu's own width in px; a menu capped to the
 * screen's width (max-w-[calc(100vw-2rem)]) is measured at that cap.
 */
export function alignForMenu(trigger: HTMLElement | null, menuWidth: number): "left" | "right" {
  if (!trigger) return "right";
  const rect = trigger.getBoundingClientRect();
  return menuAlign({
    triggerLeft: rect.left,
    triggerRight: rect.right,
    menuWidth: Math.min(menuWidth, window.innerWidth - 32),
    viewportWidth: window.innerWidth,
  });
}
