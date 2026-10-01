/**
 * Server-only: daily closing prices from Upstox's historical-candle endpoint,
 * for the Heatmap's longer ranges (5D … 5Y).
 *
 * One request per instrument — the endpoint has no batch form — but a single
 * 5-year daily fetch covers every range at once, and the result can't change
 * until tomorrow: today's own candle is never used (live prices come from the
 * LTP endpoint), and completed sessions don't get revised. So each
 * instrument's history is cached in memory for the rest of the IST day, and
 * only the first poll after a cold start pays for the ~60 requests. Upstox
 * returns these already adjusted for splits, bonuses and demergers.
 */

import { addDays } from "@/lib/calculateStrategy";

export type DailyClose = { date: string; close: number };
export type DailyClosesResult = { closes: DailyClose[] } | { error: string };

/** The longest range is 5 years; the extra days make sure a candle exists on or before that date even if it landed on a holiday. */
const HISTORY_DAYS = 5 * 366 + 15;

const cache = new Map<string, { asOf: string; closes: DailyClose[] }>();
// Polls overlap when the first (cold) load outlasts the poll interval — share the fetch instead of starting a second.
const inflight = new Map<string, Promise<DailyClosesResult>>();

async function fetchDailyCloses(token: string, instrumentKey: string, todayIso: string): Promise<DailyClosesResult> {
  const from = addDays(todayIso, -HISTORY_DAYS);
  const url = `https://api.upstox.com/v3/historical-candle/${encodeURIComponent(instrumentKey)}/days/1/${todayIso}/${from}`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
    });
  } catch {
    return { error: "Couldn't reach Upstox." };
  }
  if (response.status === 401) return { error: "token_expired" };
  if (!response.ok) return { error: `Upstox returned ${response.status}` };

  const body = await response.json().catch(() => null);
  const candles: unknown = body?.data?.candles;
  if (!Array.isArray(candles)) return { error: "Upstox's history response was missing the expected data." };

  // Each candle is [timestamp, open, high, low, close, volume, oi], newest first.
  const closes: DailyClose[] = [];
  for (const candle of candles) {
    const date = typeof candle?.[0] === "string" ? candle[0].slice(0, 10) : "";
    const close = Number(candle?.[4]);
    // Today's candle (if Upstox has one yet) is partial — live prices cover today.
    if (date && date < todayIso && close > 0) closes.push({ date, close });
  }
  closes.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { closes };
}

/** Oldest-first closes of every completed session before today (IST). */
export function getDailyCloses(token: string, instrumentKey: string, todayIso: string): Promise<DailyClosesResult> {
  const hit = cache.get(instrumentKey);
  if (hit && hit.asOf === todayIso) return Promise.resolve({ closes: hit.closes });

  const pending = inflight.get(instrumentKey);
  if (pending) return pending;

  const request = fetchDailyCloses(token, instrumentKey, todayIso)
    .then((result) => {
      // Only a good result is cached — a transient failure should be retried on the next poll.
      if ("closes" in result) cache.set(instrumentKey, { asOf: todayIso, closes: result.closes });
      return result;
    })
    .finally(() => inflight.delete(instrumentKey));
  inflight.set(instrumentKey, request);
  return request;
}

/** The last close on or before `isoDate`, or null when the instrument has no history that far back (e.g. listed since). */
export function closeOnOrBefore(closes: DailyClose[], isoDate: string): number | null {
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i].date <= isoDate) return closes[i].close;
  }
  return null;
}
