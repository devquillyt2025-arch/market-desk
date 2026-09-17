"use client";

/**
 * One consolidated Settings page — Profile, Access Token, and Appearance
 * used to be split across a sidebar popover, a modal, and a dedicated
 * /settings/upstox page. All three now live as sections on this single tab.
 */

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { CheckCircleIcon, EyeIcon, EyeOffIcon, KeyIcon } from "@/components/icons";
import ThemeToggle from "@/components/ThemeToggle";
import { showToast } from "@/lib/toast";
import { getUpstoxConfig, saveUpstoxToken, type UpstoxConfig } from "@/lib/upstoxConfigStore";

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";
const sectionClass = "rounded-xl border border-border bg-background p-5 sm:p-6";

function formatUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function supabaseProjectRef(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  const match = /^https:\/\/([a-z0-9-]+)\.supabase\.co/.exec(url);
  return match ? match[1] : null;
}

export default function SettingsView() {
  const [config, setConfig] = useState<UpstoxConfig | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [showSavedToken, setShowSavedToken] = useState(false);

  useEffect(() => {
    getUpstoxConfig()
      .then(setConfig)
      .catch(() => showToast("Couldn't load the current token status. Check your connection."));
  }, []);

  async function handleSaveToken() {
    const trimmed = token.trim();
    if (!trimmed) {
      showToast("Paste today's Upstox access token first.");
      return;
    }
    setSaving(true);
    try {
      await saveUpstoxToken(trimmed);
      setToken("");
      setConfig(await getUpstoxConfig());
      showToast("Upstox token saved.", "success");
    } catch {
      showToast("Couldn't save the token. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const projectRef = supabaseProjectRef();

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex max-w-lg flex-col gap-6"
    >
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Profile, Upstox access token, and appearance.</p>
      </div>

      <section className={sectionClass}>
        <h2 className="text-sm font-medium">Profile</h2>
        <div className="mt-4 flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-sm font-bold text-accent-foreground">
            M
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">MarketDesk</p>
            <p className="text-xs text-muted-foreground">Personal options-trading toolkit</p>
          </div>
        </div>
        <dl className="mt-4 flex items-center justify-between border-t border-border pt-4">
          <dt className="text-sm text-muted-foreground">Supabase project</dt>
          <dd className="font-mono text-sm font-medium tabular-nums">{projectRef ?? "Not configured"}</dd>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          No login here — this instance is single-user, so there&apos;s nothing more account-specific to
          show.
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-medium">Access Token</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Powers live LTP and Greeks on the Live Portfolio tab. Upstox tokens expire daily around 3:30 AM
          IST — there&apos;s no auto-refresh yet, so paste in a freshly generated one here each day before
          relying on live data.
        </p>

        <div className="mt-4 flex items-center gap-2 text-sm">
          {config === null ? (
            <span className="text-muted-foreground">Checking current status…</span>
          ) : config.token ? (
            <>
              <CheckCircleIcon className="size-4 shrink-0 text-profit" />
              <span>
                Token saved
                {config.updatedAt && (
                  <span className="text-muted-foreground"> — last updated {formatUpdatedAt(config.updatedAt)}</span>
                )}
              </span>
            </>
          ) : (
            <>
              <KeyIcon className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-muted-foreground">No token saved yet.</span>
            </>
          )}
        </div>

        {config?.token && (
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs text-muted-foreground">
              {showSavedToken ? config.token : "•".repeat(Math.min(config.token.length, 48))}
            </code>
            <button
              type="button"
              onClick={() => setShowSavedToken((prev) => !prev)}
              aria-label={showSavedToken ? "Hide saved token" : "Show saved token"}
              className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
            >
              {showSavedToken ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </button>
          </div>
        )}

        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor="upstox-token" className={labelClass}>
            Access Token
          </label>
          <div className="relative">
            <input
              id="upstox-token"
              type={showTokenInput ? "text" : "password"}
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Paste today's token"
              className={`${inputClass} pr-10 font-mono`}
            />
            <button
              type="button"
              onClick={() => setShowTokenInput((prev) => !prev)}
              aria-label={showTokenInput ? "Hide token" : "Show token"}
              className="absolute right-2 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {showTokenInput ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSaveToken}
          disabled={saving}
          className="mt-4 w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-60 active:scale-95 sm:w-auto"
        >
          {saving ? "Saving…" : "Save Token"}
        </button>
      </section>

      <section className={sectionClass}>
        <h2 className="text-sm font-medium">Appearance</h2>
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Switch between light and dark mode.</p>
          <ThemeToggle />
        </div>
      </section>
    </motion.div>
  );
}
