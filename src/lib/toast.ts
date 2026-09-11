/**
 * App-wide toast notifications. Same lightweight pub/sub shape as the
 * subscribeToXChanges functions (no React context needed) — a module-level
 * list plus listeners, so any store or view can call showToast without
 * being wrapped in a provider.
 */

export type ToastVariant = "error" | "success";

export type ToastMessage = {
  id: string;
  message: string;
  variant: ToastVariant;
};

const DISMISS_AFTER_MS = 4000;

let toasts: ToastMessage[] = [];
let listeners: Array<(toasts: ToastMessage[]) => void> = [];

function emit() {
  listeners.forEach((listener) => listener(toasts));
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `toast_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

export function showToast(message: string, variant: ToastVariant = "error"): void {
  const toast: ToastMessage = { id: uuid(), message, variant };
  toasts = [...toasts, toast];
  emit();
  setTimeout(() => dismissToast(toast.id), DISMISS_AFTER_MS);
}

export function dismissToast(id: string): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function subscribeToasts(listener: (toasts: ToastMessage[]) => void): () => void {
  listeners.push(listener);
  listener(toasts);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
