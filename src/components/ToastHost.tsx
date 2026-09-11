"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { AlertCircleIcon, CheckCircleIcon, XIcon } from "@/components/icons";
import { dismissToast, subscribeToasts, type ToastMessage } from "@/lib/toast";

export default function ToastHost() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[500] flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:right-6 sm:left-auto sm:items-end sm:px-0">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, y: 16, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className={`pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border p-3.5 shadow-lg backdrop-blur ${
              toast.variant === "error" ? "border-loss/30 bg-loss/10" : "border-profit/30 bg-profit/10"
            }`}
          >
            {toast.variant === "error" ? (
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0 text-loss" />
            ) : (
              <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-profit" />
            )}
            <p className="flex-1 text-sm font-medium text-foreground">{toast.message}</p>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            >
              <XIcon className="size-3.5" />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
