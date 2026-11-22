/**
 * Server-only: when each instrument last traded, from Upstox's full quotes (`/v2/market-quote/quotes`). The Heatmap's Commodities
 * tab needs it to know which session a price belongs to (see heatmap/sessionMove.ts) - the lighter LTP endpoint has no such field.
 * Best effort: on any failure the map is empty and the tab falls back to Upstox's own previous close.
 */

/** Reads the `instrument_token` -> last trade time (epoch ms) of a full-quotes response. Pure. */
export function parseLastTradeTimes(body: unknown): Map<string, number> {
  const times = new Map<string, number>();
  const data = body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
  if (!data || typeof data !== "object") return times;
  for (const entry of Object.values(data as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const { instrument_token: token, last_trade_time: raw } = entry as { instrument_token?: unknown; last_trade_time?: unknown };
    // Milliseconds since epoch, sent as text ("1795199087000"); zero or absent when the contract has never traded.
    const ms = Number(raw);
    if (typeof token === "string" && Number.isFinite(ms) && ms > 1e12) times.set(token, ms);
  }
  return times;
}

export async function getLastTradeTimes(token: string, instrumentKeys: readonly string[]): Promise<Map<string, number>> {
  if (instrumentKeys.length === 0) return new Map();
  try {
    const response = await fetch(`https://api.upstox.com/v2/market-quote/quotes?instrument_key=${encodeURIComponent(instrumentKeys.join(","))}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      // Polled with the prices - a cached answer would pin every tile to an old session.
      cache: "no-store",
    });
    if (!response.ok) return new Map();
    return parseLastTradeTimes(await response.json().catch(() => null));
  } catch {
    return new Map();
  }
}
