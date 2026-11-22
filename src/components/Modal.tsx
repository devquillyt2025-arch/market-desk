"use client";

/**
 * The one shell every pop-up dialog in the app sits in: the dimmed backdrop and the panel, with the behaviour that makes
 * it work on a phone as well as a desktop.
 *
 * On a phone (under 640px) the panel is a bottom sheet - full width, rounded at the top, sliding up from the bottom edge,
 * with a grab handle: drag it down (or flick it) to close. On a wider screen it is the centred card it always was.
 * Either way:
 *  - the page behind is held still while it is open (see scrollLock.ts);
 *  - it is sized to the part of the screen above the on-screen keyboard, not the full height, so the lower half of a form -
 *    the Save button - is not left behind the keys (see useVisibleArea.ts);
 *  - on a phone with a notch or home indicator it keeps clear of them;
 *  - focus moves in, Tab stays inside and Escape closes (see useDialogFocus.ts).
 *
 * Callers render it inside an AnimatePresence, as they did the hand-rolled version, and give the panel's *width and layout*
 * through `className` (max-w-2xl, flex-col...). Height, corners and scrolling are the shell's: the panel never grows past the
 * screen, and what doesn't fit scrolls inside it.
 */

import { motion, useDragControls } from "framer-motion";
import type { ReactNode } from "react";

import { shouldDismissSheet } from "@/lib/sheet";
import { useScrollLock } from "@/lib/scrollLock";
import { useDialogFocus } from "@/lib/useDialogFocus";
import { useMediaQuery } from "@/lib/useMediaQuery";
import { useVisibleArea } from "@/lib/useVisibleArea";

/** Static strings, so Tailwind sees them. 400 sits over another dialog (a confirmation over an editor), 500 over both (a calendar). */
const Z_CLASS = { 300: "z-[300]", 400: "z-[400]", 500: "z-[500]" } as const;

type ModalProps = {
  /** Escape, the swipe down, and - unless `onBackdropClick` says otherwise - a tap on the backdrop. */
  onClose: () => void;
  /** For a dialog whose backdrop tap means something else (the note editor saves). */
  onBackdropClick?: () => void;
  /** "alertdialog" for a confirmation, which interrupts and needs an answer. */
  role?: "dialog" | "alertdialog";
  /** The dialog's accessible name: the id of its visible title, or a label where it has none. */
  ariaLabelledBy?: string;
  ariaLabel?: string;
  z?: keyof typeof Z_CLASS;
  /** Escape closes it - off for a dialog that handles the key itself. */
  closeOnEscape?: boolean;
  /** The panel's width and layout - never its height or corners. */
  className?: string;
  children: ReactNode;
};

export default function Modal({
  onClose,
  onBackdropClick,
  role = "dialog",
  ariaLabelledBy,
  ariaLabel,
  z = 300,
  closeOnEscape = true,
  className = "",
  children,
}: ModalProps) {
  // Assumed true on the server and at first (the desktop card); a pop-up only ever mounts after a tap, in the browser.
  const roomy = useMediaQuery("(min-width: 640px)", true);
  const dialogRef = useDialogFocus<HTMLDivElement>(closeOnEscape ? onClose : undefined);
  const visible = useVisibleArea();
  const dragControls = useDragControls();
  useScrollLock();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className={`glass-backdrop modal-overlay ${Z_CLASS[z]} print:hidden`}
      // Above the keyboard when it is up; otherwise the whole screen (the stylesheet's own insets).
      style={visible ? { top: visible.top, height: visible.height, bottom: "auto" } : undefined}
      onClick={onBackdropClick ?? onClose}
    >
      <motion.div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel}
        initial={roomy ? { opacity: 0, scale: 0.97, y: -4 } : { y: "100%" }}
        animate={roomy ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
        exit={roomy ? { opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12, ease: "easeIn" } } : { y: "100%", transition: { duration: 0.2, ease: "easeIn" } }}
        transition={roomy ? { duration: 0.18, ease: "easeOut" } : { type: "spring", damping: 34, stiffness: 380, mass: 0.9 }}
        // Dragged by the handle only (`dragListener` off, started from the handle below), so a finger scrolling the form
        // inside the sheet is never mistaken for a swipe to close it. Free to move down, never up.
        drag={roomy ? false : "y"}
        dragListener={false}
        dragControls={dragControls}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        dragSnapToOrigin
        onDragEnd={(_, info) => {
          if (shouldDismissSheet(info.offset.y, info.velocity.y)) onClose();
        }}
        onClick={(e) => e.stopPropagation()}
        className={`glass-panel modal-sheet ${className}`}
      >
        {!roomy && (
          <div aria-hidden="true" onPointerDown={(e) => dragControls.start(e)} className="modal-handle">
            <span />
          </div>
        )}
        {children}
      </motion.div>
    </motion.div>
  );
}
