/**
 * Keyboard focus for a modal dialog: pulls focus into it when it opens, keeps
 * Tab / Shift+Tab cycling inside it, and hands focus back to whatever opened it
 * when it closes. Without this, the page behind a modal stays in the tab order
 * (one Tab walks off into it), and a screen reader never learns the dialog
 * appeared.
 *
 * Attach the returned ref to the dialog *panel* (the element carrying
 * role="dialog"), not the backdrop. Pass `onEscape` for a modal that should close
 * on Escape and has no handler of its own; it fires only for the topmost dialog
 * (a confirmation over an editor closes alone) and not while a dropdown or
 * calendar is open, which take the key first. Backdrop-click stays with each modal.
 *
 * Focus lands on the panel itself rather than the first control: the screen
 * reader announces the dialog's name, and the first Tab reaches the first
 * control — the same as ARIA's modal-dialog pattern. The exception is a control
 * marked `data-autofocus` (the safe button of a destructive confirmation), which
 * gets it instead; a control that already took focus on mount is left alone.
 */

import { useEffect, useRef, useState } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[inert]") && el.getAttribute("aria-hidden") !== "true" && el.getClientRects().length > 0,
  );
}

/** The newest dialog is last in the document — the one a stray Tab should be pulled into. */
function isTopmostDialog(dialog: HTMLElement): boolean {
  const all = document.querySelectorAll('[role="dialog"], [role="alertdialog"]');
  return all[all.length - 1] === dialog;
}

export function useDialogFocus<T extends HTMLElement = HTMLDivElement>(onEscape?: () => void) {
  const ref = useRef<T>(null);
  // Whatever had focus when the dialog was asked for — read in the first render, since a control inside
  // that uses `autoFocus` (ConfirmDialog) has already taken focus by the time any effect runs.
  const [opener] = useState(() => (typeof document === "undefined" ? null : document.activeElement));
  // Always the latest callback, without re-running the effect (callers pass a fresh closure each render).
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
    if (!dialog.contains(document.activeElement)) {
      (dialog.querySelector<HTMLElement>("[data-autofocus]") ?? dialog).focus({ preventScroll: true });
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (!onEscapeRef.current || !dialog || !isTopmostDialog(dialog)) return;
        if (document.querySelector('[data-picker-popup], [role="listbox"]')) return;
        onEscapeRef.current();
        return;
      }
      if (e.key !== "Tab" || !dialog) return;
      const active = document.activeElement;
      const inside = dialog.contains(active);
      // Focus can drop to <body> from inside (the focused control unmounted — e.g. a date
      // was picked and its calendar closed). Then Tab would start from the top of the page
      // behind, so pull it back in. A focus that is elsewhere (another dialog) is not ours.
      if (!inside && !(active === document.body || active === null)) return;
      if (!inside && !isTopmostDialog(dialog)) return;

      const items = focusableIn(dialog);
      if (items.length === 0) {
        e.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, [opener]);

  return ref;
}
