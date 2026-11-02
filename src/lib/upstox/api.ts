/**
 * Server-only: one GET against Upstox's REST API with the token_expired /
 * unreachable / non-ok handling every route here does. The single-call
 * routes (option-chain, margin, …) inline it; positions and pnl-report make
 * several calls per request, so they share this instead of repeating it.
 */

import { NextResponse } from "next/server";

export type UpstoxGetError = { error: string; status: number; detail?: string };
export type UpstoxGetResult = { body: unknown } | UpstoxGetError;

/** Narrows any `{ …success } | UpstoxGetError` result, not just upstoxGet's own. */
export function isUpstoxGetError<T extends object>(result: T | UpstoxGetError): result is UpstoxGetError {
  return "error" in result;
}

/** `path` starts at the version segment, e.g. `/v2/portfolio/short-term-positions`. */
export async function upstoxGet(token: string, path: string): Promise<UpstoxGetResult> {
  let response: Response;
  try {
    response = await fetch(`https://api.upstox.com${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      // Account data — positions move all session, and a report is only
      // fetched when someone asks for it.
      cache: "no-store",
    });
  } catch {
    return { error: "Couldn't reach Upstox.", status: 502 };
  }

  if (response.status === 401) return { error: "token_expired", status: 401 };
  if (!response.ok) {
    const detail = await response.text().catch(() => undefined);
    return { error: `Upstox returned ${response.status}`, status: 502, detail };
  }
  return { body: await response.json().catch(() => null) };
}

/** The `data` field of a successful Upstox response, or undefined if it's missing. */
export function upstoxData(body: unknown): unknown {
  return body && typeof body === "object" ? (body as { data?: unknown }).data : undefined;
}

export function upstoxErrorResponse({ error, status, detail }: UpstoxGetError) {
  return NextResponse.json({ error, detail }, { status });
}

/** Upstox sends most numbers as numbers, but a few (strike_price on trades) as strings — this reads either, NaN-safe. */
export function num(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

export type HistoricalFill = {
  tradeId: string;
  /** yyyy-mm-dd. */
  date: string;
  side: "BUY" | "SELL";
  /** Upstox's underlying symbol, e.g. "NIFTY", "BANKNIFTY", "SENSEX". */
  symbol: string;
  optionType: string;
  strike: number;
  expiry: string;
  quantity: number;
};

const FILLS_PAGE_SIZE = 500;
const MAX_FILL_PAGES = 40;

/**
 * Every F&O fill between two dates (inclusive, yyyy-mm-dd) from
 * `/v2/charges/historical-trades`. Upstox adds a day's fills the day after,
 * so today's never appear here. Each fill keeps its exchange trade id, which
 * rises through the session — the only record of which leg of a same-day
 * round trip came first.
 */
export async function getHistoricalFills(
  token: string,
  fromDate: string,
  toDate: string,
): Promise<{ fills: HistoricalFill[] } | UpstoxGetError> {
  const fills: HistoricalFill[] = [];
  for (let page = 1; page <= MAX_FILL_PAGES; page++) {
    const params = new URLSearchParams({
      segment: "FO",
      start_date: fromDate,
      end_date: toDate,
      page_number: String(page),
      page_size: String(FILLS_PAGE_SIZE),
    });
    const result = await upstoxGet(token, `/v2/charges/historical-trades?${params}`);
    if (isUpstoxGetError(result)) return result;

    const rows = upstoxData(result.body);
    if (!Array.isArray(rows)) return { error: "Upstox's trade history was missing the expected data.", status: 502 };
    for (const row of rows as Record<string, unknown>[]) {
      const side = row.transaction_type;
      if (side !== "BUY" && side !== "SELL") continue;
      fills.push({
        tradeId: String(row.trade_id ?? ""),
        date: String(row.trade_date ?? "").slice(0, 10),
        side,
        symbol: String(row.symbol ?? ""),
        optionType: String(row.option_type ?? ""),
        strike: num(row.strike_price),
        expiry: String(row.expiry ?? "").slice(0, 10),
        quantity: num(row.quantity),
      });
    }

    const total = num(
      (result.body as { metaData?: { page?: { total_records?: unknown } } } | null)?.metaData?.page?.total_records,
    );
    if (rows.length < FILLS_PAGE_SIZE || (total > 0 && fills.length >= total)) break;
  }
  return { fills };
}

/** Numeric when both ids are (they are, from NSE and BSE), else a plain string comparison. */
export function compareTradeIds(a: string, b: string): number {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return a < b ? -1 : a > b ? 1 : 0;
}
