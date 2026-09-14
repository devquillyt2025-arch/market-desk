/**
 * Browser-side caller for this app's own /api/upstox/option-chain route —
 * never calls Upstox directly (see the route for why). One call per
 * (instrument, expiry) group; Live Portfolio is the only caller today.
 */

import type { Instrument } from "@/lib/types";
import { isUpstoxOptionChainError, type UpstoxOptionChainResult } from "@/lib/upstox/types";

export async function fetchOptionChain(instrument: Instrument, expiry: string): Promise<UpstoxOptionChainResult> {
  const params = new URLSearchParams({ instrument, expiry });
  const res = await fetch(`/api/upstox/option-chain?${params}`, { cache: "no-store" });
  const body: UpstoxOptionChainResult = await res.json();

  if (!res.ok && !isUpstoxOptionChainError(body)) {
    // Defensive fallback — the route always returns { error } on a non-ok
    // status, but don't let a malformed response masquerade as chain data.
    return { error: `Request failed with status ${res.status}` };
  }
  return body;
}
