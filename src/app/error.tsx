"use client";

import { useEffect } from "react";

import { AlertCircleIcon } from "@/components/icons";
import { logEvent } from "@/lib/activityLog";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    logEvent(`App error: ${error.message || "Unknown error"}`);
  }, [error]);

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-loss/40 bg-card p-12 text-center">
      <AlertCircleIcon className="size-8 text-loss" />
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          An unexpected error occurred. You can try again, or use the sidebar to head elsewhere.
        </p>
      </div>
      <button
        type="button"
        onClick={retry}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90"
      >
        Try again
      </button>
    </div>
  );
}
