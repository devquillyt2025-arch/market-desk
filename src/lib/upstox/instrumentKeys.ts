/**
 * Maps this app's own Instrument values to Upstox's underlying
 * instrument_key for the option-chain endpoint. Hardcoded — only 3 values,
 * not worth a config table.
 */

import type { Instrument } from "@/lib/types";

export const UPSTOX_INSTRUMENT_KEYS: Record<Instrument, string> = {
  NIFTY: "NSE_INDEX|Nifty 50",
  BANKNIFTY: "NSE_INDEX|Nifty Bank",
  SENSEX: "BSE_INDEX|SENSEX",
};
