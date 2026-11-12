/**
 * Maps the three indices to Upstox's underlying instrument_key. Hardcoded —
 * only 3 values, not worth a config table. The commodities have no entry on
 * purpose: their underlying is a monthly futures contract whose key changes,
 * so it is looked up per expiry (see mcx.ts).
 */

import type { IndexInstrument } from "@/lib/types";

export const UPSTOX_INSTRUMENT_KEYS: Record<IndexInstrument, string> = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  SENSEX: "BSE_INDEX|SENSEX",
};
