/**
 * The Payment ledger and the Paper Trade entries for the Dashboard. Both are read from the same tables as their own pages (and
 * share their warm copies, so a repeat visit paints at once); nothing is written from here. Each reloads when its table changes.
 */

import { useEffect, useState } from "react";

import { getPaperTradeEntries, getCachedPaperTradeEntries, subscribeToPaperTradeChanges } from "@/lib/paperTradeEntriesStore";
import { getCachedPayments, getPayments, subscribeToPaymentChanges } from "@/lib/paymentStore";
import type { PaperTradeEntry, Payment } from "@/lib/types";

/** Keeps `value` loaded from `load`, reloading on every change `subscribe` reports; an error keeps what is there. */
function useLoaded<T>(initial: () => T | null, load: () => Promise<T>, subscribe: (callback: () => void) => () => void): T | null {
  const [value, setValue] = useState<T | null>(initial);

  useEffect(() => {
    let cancelled = false;
    async function reload() {
      try {
        const next = await load();
        if (!cancelled) setValue(next);
      } catch {
        // Keep what is shown: there is simply nothing newer.
      }
    }
    void reload();
    const unsubscribe = subscribe(() => void reload());
    return () => {
      cancelled = true;
      unsubscribe();
    };
    // The three arguments are module-level functions: stable for the life of the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}

export function usePayments(): Payment[] | null {
  return useLoaded(getCachedPayments, getPayments, subscribeToPaymentChanges);
}

export function usePaperTrades(): PaperTradeEntry[] | null {
  return useLoaded(getCachedPaperTradeEntries, getPaperTradeEntries, subscribeToPaperTradeChanges);
}
