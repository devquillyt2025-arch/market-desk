/**
 * Browser-side caller for this app's own /api/upstox/option-chain route —
 * never calls Upstox directly (see the route for why). One call per
 * (instrument, expiry) group; Live Portfolio is the only caller today.
 */

import type { Instrument } from "@/lib/types";
import {
  isUpstoxMarginError,
  isUpstoxOptionChainError,
  type UpstoxMarginInstrumentRequest,
  type UpstoxMarginLine,
  type UpstoxOptionChainResult,
} from "@/lib/upstox/types";

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

const MARGIN_BATCH_SIZE = 20; // Upstox's own per-request limit

export type MarginFetchResult = { margins: UpstoxMarginLine[] } | { error: string };

/**
 * Fetches margin for every instrument, chunking into batches of 20 (Upstox's
 * limit) and concatenating the results back in the same order as `instruments`
 * so the caller can zip `margins[i]` back to `instruments[i]` by index. Fails
 * the whole call on the first failing chunk — a partial total would be
 * misleading rather than merely incomplete.
 */
export async function fetchMargin(instruments: UpstoxMarginInstrumentRequest[]): Promise<MarginFetchResult> {
  const margins: UpstoxMarginLine[] = [];

  for (let i = 0; i < instruments.length; i += MARGIN_BATCH_SIZE) {
    const batch = instruments.slice(i, i + MARGIN_BATCH_SIZE);
    let res: Response;
    try {
      res = await fetch("/api/upstox/margin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instruments: batch }),
        cache: "no-store",
      });
    } catch {
      return { error: "Couldn't reach the margin endpoint." };
    }
    const body = await res.json();
    if (!res.ok || isUpstoxMarginError(body)) {
      return isUpstoxMarginError(body) ? body : { error: `Request failed with status ${res.status}` };
    }
    margins.push(...body.data.margins);
  }

  return { margins };
}
