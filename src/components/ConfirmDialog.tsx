"use client";

/**
 * Shared "are you sure?" prompt for every destructive action in the app —
 * one styled dialog instead of the browser's unthemed `window.confirm`.
 * Callers keep the pending item in their own state and render this
 * conditionally (same pattern as TradeEntryModal/NoteModal), so cancelling
 * just clears that state without the caller needing to know anything else.
 */

import Modal from "@/components/Modal";
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
  return (
    // Higher than the app's other modals (z 300) so this can stack on top when a delete is confirmed from inside an
    // already-open editor. Escape and a tap outside both cancel.
    <Modal onClose={onCancel} role="alertdialog" ariaLabelledBy="confirm-dialog-title" z={400} className="sm:max-w-sm">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-loss/10 text-danger-fg">
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
            data-autofocus=""
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-loss/15 px-4 py-2 text-sm font-medium text-danger-fg transition-colors hover:bg-loss/25 active:scale-95"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
