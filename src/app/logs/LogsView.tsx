"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";

import { ActivityIcon, SearchIcon, TrashIcon } from "@/components/icons";
import ConfirmDialog from "@/components/ConfirmDialog";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/Select";
import { clearLogs, getCachedLogs, getLogs, subscribeToLogChanges, type LogEntry } from "@/lib/activityLog";
import { showToast } from "@/lib/toast";

type SortOrder = "newest" | "oldest";

const SORT_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
];

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export default function LogsView() {
  const [logs, setLogs] = useState<LogEntry[] | null>(getCachedLogs);
  const [query, setQuery] = useState("");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");
  const [confirmingClear, setConfirmingClear] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        setLogs(await getLogs());
      } catch {
        showToast("Couldn't load logs. Check your connection.");
      }
    }
    load();
    return subscribeToLogChanges(load);
  }, []);

  const displayedLogs = useMemo(() => {
    if (!logs) return null;
    const q = query.trim().toLowerCase();
    const filtered = q ? logs.filter((entry) => entry.message.toLowerCase().includes(q)) : logs;
    // `logs` already arrives newest-first from the query — reverse only for "oldest".
    return sortOrder === "oldest" ? [...filtered].reverse() : filtered;
  }, [logs, query, sortOrder]);

  function handleClear() {
    const previous = logs;
    setConfirmingClear(false);
    setLogs([]);
    clearLogs().catch(() => {
      setLogs(previous);
      showToast("Couldn't clear logs. Try again.");
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col gap-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Logs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every change made in the app, synced across devices, newest first.
          </p>
        </div>
        {logs && logs.length > 0 && (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-loss/40 hover:bg-loss/10 hover:text-loss active:scale-95"
          >
            <TrashIcon className="size-4" />
            Clear Logs
          </button>
        )}
      </div>

      {logs !== null && logs.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search logs…"
              className="w-full rounded-lg border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30"
            />
          </div>
          <div className="w-40 shrink-0">
            <Select value={sortOrder} onChange={setSortOrder} options={SORT_OPTIONS} align="right" />
          </div>
        </div>
      )}

      {logs === null ? (
        <LoadingState className="h-48" label="Loading logs…" />
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-10 text-center">
          <ActivityIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing logged yet. Actions across the app will show up here.
          </p>
        </div>
      ) : displayedLogs && displayedLogs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-background p-10 text-center">
          <SearchIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No log entries match &quot;{query}&quot;.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <ul>
            <AnimatePresence initial={false}>
              {(displayedLogs ?? []).map((entry, index) => (
                <motion.li
                  key={entry.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, transition: { duration: 0.12 } }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                  className={`flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm ${
                    index === 0 ? "" : "border-t border-border"
                  }`}
                >
                  <span>{entry.message}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {formatTimestamp(entry.timestamp)}
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}

      <AnimatePresence>
        {confirmingClear && (
          <ConfirmDialog
            title="Clear the activity log?"
            message="Every log entry will be removed for every device — this can't be undone."
            confirmLabel="Clear Logs"
            onConfirm={handleClear}
            onCancel={() => setConfirmingClear(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
