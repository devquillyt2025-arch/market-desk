/**
 * Polls Upstox's real margin (SPAN + exposure) for every open, live-matched
 * position — separate from useLivePricing's LTP/Greeks polling since margin
 * only needs an instrument_key + qty + side, doesn't change nearly as often
 * as LTP, and only exists once a row has reached status "ok" (its
 * instrument_key comes from the matched chain leg, not the entry itself).
 */

import { useEffect, useMemo, useState } from "react";

import type { PortfolioRow } from "@/lib/calculatePortfolio";
import { DEFAULT_LOT_SIZES } from "@/lib/types";
import { fetchMargin } from "@/lib/upstox/client";

const DEFAULT_MARGIN_POLL_MS = 30000;

export type MarginState = {
  /** Sum of every trackable open position's total_margin. Null until the first successful fetch. */
  totalMargin: number | null;
  marginByEntryId: Map<string, number>;
  loading: boolean;
};

export function useMargin(rows: PortfolioRow[] | null, pollMs = DEFAULT_MARGIN_POLL_MS): MarginState {
  const [marginByEntryId, setMarginByEntryId] = useState<Map<string, number>>(new Map());
  const [totalMargin, setTotalMargin] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const trackable = useMemo(() => (rows ?? []).filter((r) => r.status === "ok" && r.instrumentKey), [rows]);

  // Only re-poll when the actual instrument/qty/side set changes — not on
  // every LTP tick, which would otherwise refire this on every 10s price
  // poll even though margin itself rarely moves that fast. The
  // loading/loaded prefix distinguishes "rows hasn't loaded yet" from
  // "rows loaded and there's genuinely nothing trackable" — both produce an
  // empty `trackable` array, but only the latter should settle totalMargin
  // at 0 instead of leaving it at null.
  const requestSignature =
    (rows === null ? "loading|" : "loaded|") +
    trackable.map((r) => `${r.entry.id}:${r.instrumentKey}:${r.entry.lots}:${r.entry.side}`).sort().join(",");

  useEffect(() => {
    if (trackable.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resetting state to reflect "nothing to poll" isn't reacting to an external system, it's this hook's own derived state.
      setMarginByEntryId(new Map());
      setTotalMargin(rows !== null ? 0 : null);
      return;
    }

    let cancelled = false;

    async function poll() {
      setLoading(true);

      // Upstox rejects a request containing duplicate instrument_keys, but
      // two open positions can easily be the exact same contract (added in
      // separate tranches) — so same instrument_key+side entries are merged
      // into one request line with their quantities summed, then that
      // group's margin is split back across its entries proportional to
      // each entry's own share of the combined quantity.
      type Group = {
        instrumentKey: string;
        side: "BUY" | "SELL";
        qty: number;
        price: number | undefined;
        members: { id: string; qty: number }[];
      };
      const groups = new Map<string, Group>();
      for (const r of trackable) {
        const side: "BUY" | "SELL" = r.entry.side === "sell" ? "SELL" : "BUY";
        const qty = r.entry.lots * DEFAULT_LOT_SIZES[r.entry.instrument];
        const key = `${r.instrumentKey}|${side}`;
        const existing = groups.get(key);
        if (existing) {
          existing.qty += qty;
          existing.members.push({ id: r.entry.id, qty });
        } else {
          groups.set(key, {
            instrumentKey: r.instrumentKey!,
            side,
            qty,
            price: r.liveLtp ?? undefined,
            members: [{ id: r.entry.id, qty }],
          });
        }
      }
      const groupList = [...groups.values()];
      const instruments = groupList.map((g) => ({
        instrument_key: g.instrumentKey,
        quantity: g.qty,
        transaction_type: g.side,
        product: "D" as const,
        price: g.price,
      }));

      const result = await fetchMargin(instruments);
      if (cancelled) return;
      setLoading(false);

      if ("error" in result) return; // keep the last known good values rather than blanking them on a transient failure

      const map = new Map<string, number>();
      let total = 0;
      result.margins.forEach((m, i) => {
        const groupMargin = m.total_margin ?? 0;
        const group = groupList[i];
        total += groupMargin;
        for (const member of group.members) {
          const share = group.qty > 0 ? (member.qty / group.qty) * groupMargin : 0;
          map.set(member.id, (map.get(member.id) ?? 0) + share);
        }
      });
      setMarginByEntryId(map);
      setTotalMargin(total);
    }

    poll();
    const id = setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- requestSignature is the real dependency (derived from trackable); trackable itself is a fresh array every render.
  }, [requestSignature, pollMs]);

  return { totalMargin, marginByEntryId, loading };
}
