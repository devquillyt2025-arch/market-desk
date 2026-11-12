/**
 * Measures how much one index has been moving, for the RRR planner. Each index is asked for once: its
 * history only changes at the end of a session, so there is nothing to poll. A failure isn't kept - asking
 * again (switching back to the index, or "Try again") makes a fresh request.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Instrument } from "@/lib/types";
import { fetchVolatility } from "@/lib/upstox/client";
import type { UpstoxVolatilityResult, UpstoxVolatilitySuccess } from "@/lib/upstox/types";

export type VolatilityState =
  | { status: "loading" }
  | { status: "ok"; data: UpstoxVolatilitySuccess }
  | { status: "error"; message: string; tokenExpired: boolean };

const NETWORK_ERROR = "network_error";

function describe(error: string): { message: string; tokenExpired: boolean } {
  if (error === "token_expired") return { message: "Today's Upstox token isn't set or has expired, so the index's history can't be read.", tokenExpired: true };
  if (error === NETWORK_ERROR) return { message: "Couldn't reach the server.", tokenExpired: false };
  return { message: error, tokenExpired: false };
}

export function useVolatility(instrument: Instrument): VolatilityState & { retry: () => void } {
  const [results, setResults] = useState<Partial<Record<Instrument, UpstoxVolatilityResult>>>({});
  // Indices already asked for (or being asked): a second ask would only repeat the first.
  const asked = useRef(new Set<Instrument>());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (asked.current.has(instrument)) return;
    asked.current.add(instrument);
    fetchVolatility(instrument)
      .catch((): UpstoxVolatilityResult => ({ error: NETWORK_ERROR }))
      .then((result) => {
        if ("error" in result) asked.current.delete(instrument);
        setResults((prev) => ({ ...prev, [instrument]: result }));
      });
  }, [instrument, attempt]);

  const retry = useCallback(() => {
    asked.current.delete(instrument);
    setResults((prev) => {
      const next = { ...prev };
      delete next[instrument];
      return next;
    });
    setAttempt((n) => n + 1);
  }, [instrument]);

  const result = results[instrument];
  if (!result) return { status: "loading", retry };
  if ("error" in result) return { status: "error", ...describe(result.error), retry };
  return { status: "ok", data: result, retry };
}
