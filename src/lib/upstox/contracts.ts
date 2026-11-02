/**
 * Server-only: every listed option contract of the three indices, keyed by
 * Upstox instrument_key — what turns a position's bare `NSE_FO|39948` into the
 * instrument / strike / CE-PE / expiry this app stores. One
 * `/v2/option/contract` call per index (all expiries at once, ~5,600
 * contracts in total), cached for the rest of the IST day: contracts are
 * listed before a session opens, not during it.
 */

import { istDateString } from "@/lib/calculateStrategy";
import { INSTRUMENTS, type Instrument, type TradeEntryOptionType } from "@/lib/types";
import { isUpstoxGetError, num, upstoxData, upstoxGet, type UpstoxGetError } from "@/lib/upstox/api";
import { UPSTOX_INSTRUMENT_KEYS } from "@/lib/upstox/instrumentKeys";

const IST_OFFSET_MS = 5.5 * 3_600_000;

export type OptionContract = {
  instrument: Instrument;
  strike: number;
  optionType: TradeEntryOptionType;
  /** yyyy-mm-dd. */
  expiry: string;
  lotSize: number;
};

type ContractsResult = { contracts: Map<string, OptionContract> } | UpstoxGetError;

let cache: { day: string; contracts: Map<string, OptionContract> } | null = null;
// Positions polls from several open tabs can land together on a cold start — share the fetch.
let inflight: Promise<ContractsResult> | null = null;

/** Same tolerance as the expiries route: Upstox has sent `expiry` both as a date string and as epoch milliseconds. */
function toIsoDate(value: unknown): string | null {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value + IST_OFFSET_MS).toISOString().slice(0, 10);
  return null;
}

async function fetchContracts(token: string): Promise<ContractsResult> {
  const contracts = new Map<string, OptionContract>();
  const results = await Promise.all(
    INSTRUMENTS.map(async (instrument) => {
      const params = new URLSearchParams({ instrument_key: UPSTOX_INSTRUMENT_KEYS[instrument] });
      return [instrument, await upstoxGet(token, `/v2/option/contract?${params}`)] as const;
    }),
  );

  for (const [instrument, result] of results) {
    // All or nothing — a partial map would quietly drop that index's positions.
    if (isUpstoxGetError(result)) return result;
    const rows = upstoxData(result.body);
    if (!Array.isArray(rows)) return { error: "Upstox's contract list was missing the expected data.", status: 502 };

    for (const row of rows as Record<string, unknown>[]) {
      const key = row.instrument_key;
      const optionType = row.instrument_type;
      const expiry = toIsoDate(row.expiry);
      const strike = num(row.strike_price);
      const lotSize = num(row.lot_size);
      if (typeof key !== "string" || (optionType !== "CE" && optionType !== "PE") || !expiry || !(strike > 0) || !(lotSize > 0)) {
        continue;
      }
      contracts.set(key, { instrument, strike, optionType, expiry, lotSize });
    }
  }
  return { contracts };
}

export function getOptionContracts(token: string): Promise<ContractsResult> {
  const today = istDateString(Date.now());
  if (cache?.day === today) return Promise.resolve({ contracts: cache.contracts });
  if (inflight) return inflight;

  inflight = fetchContracts(token)
    .then((result) => {
      // Only a complete result is cached — a failure is retried on the next poll.
      if (!isUpstoxGetError(result)) cache = { day: today, contracts: result.contracts };
      return result;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
