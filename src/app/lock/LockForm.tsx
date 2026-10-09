"use client";

import { useActionState } from "react";

import { LockIcon } from "@/components/icons";

import { unlock, type UnlockState } from "./actions";

export default function LockForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<UnlockState, FormData>(unlock, { error: null });

  return (
    <div className="flex min-h-[70vh] items-center justify-center">
      <form
        action={formAction}
        className="w-full max-w-xs rounded-xl border border-border bg-background p-6 text-center"
      >
        <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-accent/10 text-accent">
          <LockIcon className="size-5" />
        </span>
        <h1 className="mt-4 text-lg font-semibold tracking-tight">MarketDesk is locked</h1>
        <p className="mt-1 text-sm text-muted-foreground">Enter your PIN to continue.</p>

        <input type="hidden" name="next" value={next} />
        <input
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          autoFocus
          required
          aria-label="PIN"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? "pin-error" : undefined}
          className="mt-5 w-full rounded-lg border border-border bg-card px-3 py-2.5 text-center font-mono text-xl tracking-[0.5em] outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
        />
        {state.error && (
          <p id="pin-error" role="alert" className="mt-2 text-sm text-danger-fg">
            {state.error}
          </p>
        )}

        <button
          type="submit"
          disabled={pending}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Checking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
