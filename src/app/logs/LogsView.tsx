"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

import { ActivityIcon, TrashIcon } from "@/components/icons";
import { clearLogs, getCachedLogs, getLogs, subscribeToLogChanges, type LogEntry } from "@/lib/activityLog";
import { showToast } from "@/lib/toast";

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

  function handleClear() {
    if (!window.confirm("Clear the activity log? This can't be undone.")) return;
    const previous = logs;
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
            onClick={handleClear}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-loss/40 hover:bg-loss/10 hover:text-loss active:scale-95"
          >
            <TrashIcon className="size-4" />
            Clear Logs
          </button>
        )}
      </div>

      {logs === null ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-11 animate-pulse rounded-lg border border-border bg-card" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <ActivityIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing logged yet. Actions across the app will show up here.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <ul>
            <AnimatePresence initial={false}>
              {logs.map((entry, index) => (
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
    </motion.div>
  );
}
