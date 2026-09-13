"use client";

/**
 * Shared "are you sure?" prompt for every destructive action in the app —
 * one styled dialog instead of the browser's unthemed `window.confirm`.
 * Callers keep the pending item in their own state and render this
 * conditionally (same pattern as TradeEntryModal/NoteModal), so cancelling
 * just clears that state without the caller needing to know anything else.
 */

import { motion } from "framer-motion";
import { useEffect } from "react";

import { AlertCircleIcon } from "@/components/icons";

type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      // Higher than the app's other modals (z-[300]) so this can stack on
      // top when a delete is confirmed from inside an already-open editor.
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 20, scale: 0.98 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-2xl"
      >
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-loss/10 text-loss">
            <AlertCircleIcon className="size-5" />
          </div>
          <div className="flex flex-col gap-1 pt-0.5">
            <h2 id="confirm-dialog-title" className="text-sm font-semibold text-foreground">
              {title}
            </h2>
            <p className="text-sm text-muted-foreground">{message}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            autoFocus
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-loss/15 px-4 py-2 text-sm font-medium text-loss transition-colors hover:bg-loss/25 active:scale-95"
          >
            {confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
