/**
 * Local-only activity log. Every meaningful change made in the app calls
 * `logEvent` so the Logs tab has a full trail, without persisting anywhere
 * beyond this browser.
 */

const STORAGE_KEY = "marketdesk:logs";
const MAX_ENTRIES = 500;
/** Swallows duplicate calls from React re-invoking an effect twice in dev. */
const DEDUPE_WINDOW_MS = 300;

export type LogEntry = {
  id: string;
  timestamp: string;
  message: string;
};

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `log_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function readAll(): LogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: LogEntry[]) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function logEvent(message: string): void {
  if (typeof window === "undefined") return;

  const existing = readAll();
  const [last] = existing;
  if (
    last &&
    last.message === message &&
    Date.now() - new Date(last.timestamp).getTime() < DEDUPE_WINDOW_MS
  ) {
    return;
  }

  const entry: LogEntry = { id: uuid(), timestamp: new Date().toISOString(), message };
  writeAll([entry, ...existing].slice(0, MAX_ENTRIES));
}

export async function getLogs(): Promise<LogEntry[]> {
  return readAll();
}

export async function clearLogs(): Promise<void> {
  writeAll([]);
}
