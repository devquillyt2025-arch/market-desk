"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

import { PlusIcon, TrashIcon } from "@/components/icons";
import InstrumentSearch, { type CalcOption } from "@/components/InstrumentSearch";
import { logEvent } from "@/lib/activityLog";
import { calculateTrade } from "@/lib/calculateTrade";
import { calculateBrokerage, type BrokerageBreakdown } from "@/lib/calculateBrokerage";
import { pnlColorClass } from "@/lib/format";
import { DEFAULT_LOT_SIZES } from "@/lib/types";

/** Coalesces rapid keystrokes into one log entry instead of one per character. */
const LOG_DEBOUNCE_MS = 600;

/**
 * One combined "what am I trading" choice per leg, matching Upstox's own
 * calculator (upstox.com/calculator/brokerage-calculator): a single search
 * box instead of separate Segment + Instrument controls. Equity has no lot
 * concept, so it carries `instrument: null`.
 */
const CALC_OPTIONS: CalcOption[] = [
  { id: "NIFTY_OPTIONS", label: "Nifty — Options", segment: "OPTIONS", instrument: "NIFTY" },
  { id: "NIFTY_FUTURES", label: "Nifty — Futures", segment: "FUTURES", instrument: "NIFTY" },
  { id: "BANKNIFTY_OPTIONS", label: "Bank Nifty — Options", segment: "OPTIONS", instrument: "BANKNIFTY" },
  { id: "BANKNIFTY_FUTURES", label: "Bank Nifty — Futures", segment: "FUTURES", instrument: "BANKNIFTY" },
  { id: "SENSEX_OPTIONS", label: "Sensex — Options", segment: "OPTIONS", instrument: "SENSEX" },
  { id: "SENSEX_FUTURES", label: "Sensex — Futures", segment: "FUTURES", instrument: "SENSEX" },
  { id: "EQUITY_DELIVERY", label: "Equity — Delivery", segment: "DELIVERY", instrument: null },
  { id: "EQUITY_INTRADAY", label: "Equity — Intraday", segment: "INTRADAY", instrument: null },
];

const EMPTY_BREAKDOWN: BrokerageBreakdown = {
  brokerage: 0,
  stt: 0,
  transactionCharges: 0,
  clearingCharges: 0,
  dpCharges: 0,
  stampDuty: 0,
  sebiCharges: 0,
  gst: 0,
  totalCharges: 0,
  netBuyValue: 0,
  netSellValue: 0,
  pointsToBreakeven: 0,
};

function rupees(value: number): string {
  return `₹${value.toFixed(2)}`;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * F&O quantities can only ever be traded in whole lots (e.g. 65, 130, 195 for
 * Nifty — never 66), so any typed value is snapped to the nearest multiple of
 * the lot size rather than accepted as-is. Equity (Delivery/Intraday) has no
 * lot concept — `lotSize` is null there — so it stays free-entry.
 */
function normalizeQty(qty: number, lotSize: number | null): number {
  if (!lotSize) return Math.max(1, Math.trunc(qty) || 1);
  const lots = Math.max(1, Math.round(qty / lotSize));
  return lots * lotSize;
}

const BREAKUP_ROWS: { key: keyof BrokerageBreakdown; label: string }[] = [
  { key: "brokerage", label: "Brokerage" },
  { key: "stt", label: "STT/CTT" },
  { key: "transactionCharges", label: "Transaction Charges" },
  { key: "clearingCharges", label: "Clearing Charges" },
  { key: "dpCharges", label: "DP Charges" },
  { key: "stampDuty", label: "State Stamp Duty" },
  { key: "sebiCharges", label: "SEBI Turnover Fees" },
  { key: "gst", label: "GST" },
];

const inputClass =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";

type CalcLeg = {
  key: number;
  option: CalcOption;
  buyPrice: string;
  sellPrice: string;
  qty: number;
};

let nextLegKey = 0;
function newLeg(option: CalcOption): CalcLeg {
  return {
    key: nextLegKey++,
    option,
    buyPrice: "",
    sellPrice: "",
    qty: option.instrument ? DEFAULT_LOT_SIZES[option.instrument] : 1,
  };
}

/**
 * Persisted across tab switches and app restarts — only `handleClearAll`
 * resets it. `option` is stored by id and re-resolved against CALC_OPTIONS
 * on load (rather than persisting the object as-is) so a saved id that no
 * longer exists (a future CALC_OPTIONS change) can't produce a broken leg.
 */
const STORAGE_KEY = "brokerage-calculator-legs";

type StoredLeg = { optionId: string; buyPrice: string; sellPrice: string; qty: number };

function isValidStoredLeg(value: unknown): value is StoredLeg {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.optionId === "string" &&
    CALC_OPTIONS.some((o) => o.id === v.optionId) &&
    typeof v.buyPrice === "string" &&
    typeof v.sellPrice === "string" &&
    typeof v.qty === "number" &&
    v.qty > 0
  );
}

function loadStoredLegs(): CalcLeg[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const valid = parsed.filter(isValidStoredLeg);
    if (valid.length === 0) return null;
    return valid.map((stored) => {
      const option = CALC_OPTIONS.find((o) => o.id === stored.optionId)!;
      const lotSize = option.instrument ? DEFAULT_LOT_SIZES[option.instrument] : null;
      return {
        key: nextLegKey++,
        option,
        buyPrice: stored.buyPrice,
        sellPrice: stored.sellPrice,
        // Re-normalized in case it was saved before lot-size enforcement existed.
        qty: normalizeQty(stored.qty, lotSize),
      };
    });
  } catch {
    // localStorage may be unavailable (private browsing, disabled storage) or hold invalid JSON.
    return null;
  }
}

export default function BrokerageCalculator() {
  const [legs, setLegs] = useState<CalcLeg[]>(() => [newLeg(CALC_OPTIONS[0])]);
  // Gates the persistence effect below until *after* the load attempt below
  // has run and (if it found something) applied it — otherwise that effect
  // would fire first, on the still-default pre-load state, and overwrite the
  // very data the load effect was about to restore.
  const [hydrated, setHydrated] = useState(false);

  const pendingLogs = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = pendingLogs.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  useEffect(() => {
    const stored = loadStoredLegs();
    if (stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLegs(stored);
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      const toStore: StoredLeg[] = legs.map((leg) => ({
        optionId: leg.option.id,
        buyPrice: leg.buyPrice,
        sellPrice: leg.sellPrice,
        qty: leg.qty,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
    } catch {
      // localStorage may be unavailable; values just won't persist for this load.
    }
  }, [legs, hydrated]);

  function logDebounced(key: string, message: string) {
    const timers = pendingLogs.current;
    const existing = timers.get(key);
    if (existing) clearTimeout(existing);
    timers.set(
      key,
      setTimeout(() => {
        logEvent(message);
        timers.delete(key);
      }, LOG_DEBOUNCE_MS),
    );
  }

  function handleLegOptionChange(key: number, next: CalcOption) {
    setLegs((prev) =>
      prev.map((leg) =>
        leg.key === key
          ? { ...leg, option: next, qty: next.instrument ? DEFAULT_LOT_SIZES[next.instrument] : 1 }
          : leg,
      ),
    );
    logEvent(`Brokerage calculator: leg instrument changed to ${next.label}`);
  }

  function handleLegPriceChange(key: number, field: "buyPrice" | "sellPrice", value: string) {
    setLegs((prev) => prev.map((leg) => (leg.key === key ? { ...leg, [field]: value } : leg)));
    logDebounced(
      `brokerage-leg-${key}-${field}`,
      `Brokerage calculator: ${field === "buyPrice" ? "Buy" : "Sell"} price for a leg changed to ${value || "0"}`,
    );
  }

  function handleLegQtyChange(key: number, nextQty: number) {
    setLegs((prev) => prev.map((leg) => (leg.key === key ? { ...leg, qty: nextQty } : leg)));
    logDebounced(`brokerage-leg-${key}-qty`, `Brokerage calculator: leg qty changed to ${nextQty}`);
  }

  function addLeg() {
    setLegs((prev) => [...prev, newLeg(prev[prev.length - 1]?.option ?? CALC_OPTIONS[0])]);
    logEvent(`Brokerage calculator: added leg ${legs.length + 1}`);
  }

  function removeLeg(key: number) {
    const legNumber = legs.findIndex((leg) => leg.key === key) + 1;
    setLegs((prev) => (prev.length > 1 ? prev.filter((leg) => leg.key !== key) : prev));
    if (legs.length > 1) logEvent(`Brokerage calculator: removed leg ${legNumber}`);
  }

  function handleClearAll() {
    setLegs([newLeg(CALC_OPTIONS[0])]);
    logEvent("Brokerage calculator: cleared all legs");
  }

  const legResults = legs.map((leg) => {
    const numericLeg = { buyPrice: toNumber(leg.buyPrice), sellPrice: toNumber(leg.sellPrice) };
    return {
      leg,
      trade: calculateTrade([numericLeg], leg.qty),
      charges: calculateBrokerage(leg.option.segment, [numericLeg], leg.qty),
    };
  });

  const totalPnl = legResults.reduce((sum, r) => sum + r.trade.totalPnl, 0);
  const totalQty = legs.reduce((sum, l) => sum + l.qty, 0);

  // Every field but pointsToBreakeven sums cleanly across legs regardless of
  // instrument/segment; that one is recomputed below since "total charges /
  // total qty" only has to be derived once, not summed per leg.
  const charges = legResults.reduce<BrokerageBreakdown>((acc, r) => {
    const next = { ...acc };
    for (const key of Object.keys(acc) as (keyof BrokerageBreakdown)[]) {
      if (key === "pointsToBreakeven") continue;
      next[key] = acc[key] + r.charges[key];
    }
    return next;
  }, EMPTY_BREAKDOWN);
  charges.pointsToBreakeven = totalQty > 0 ? charges.totalCharges / totalQty : 0;

  const otherCharges = charges.totalCharges - charges.brokerage;
  const netPnl = totalPnl - charges.totalCharges;
  const netColor = pnlColorClass(netPnl);

  const topStats = [
    { label: "Brokerage", value: rupees(charges.brokerage), color: "" },
    { label: "Other Charges", value: rupees(otherCharges), color: "" },
    { label: "Points to Breakeven", value: rupees(charges.pointsToBreakeven), color: "" },
    { label: "Net PnL", value: rupees(netPnl), color: netColor },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full min-h-0 flex-col gap-3"
    >
      <section className="grid shrink-0 overflow-hidden rounded-xl border border-border sm:grid-cols-2">
        <div className="grid grid-cols-2 gap-px bg-border sm:border-r sm:border-border">
          {topStats.map((stat) => (
            <div key={stat.label} className="bg-background p-2.5">
              <dt className="text-xs text-muted-foreground">{stat.label}</dt>
              <dd className={`mt-0.5 font-mono text-lg font-semibold tabular-nums transition-colors ${stat.color}`}>
                {stat.value}
              </dd>
            </div>
          ))}
        </div>

        <div className="flex flex-col justify-center gap-2 bg-background p-3 sm:p-4">
          <div className="flex items-center justify-between">
            <dt className="text-sm text-muted-foreground">Gross P&amp;L</dt>
            <dd className="font-mono text-sm font-medium tabular-nums">{rupees(totalPnl)}</dd>
          </div>
          <div className="flex flex-col gap-1.5 border-t border-border pt-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Trade Values</h2>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-muted-foreground">Net Buy Value</dt>
              <dd className="font-mono text-sm font-medium tabular-nums">{rupees(charges.netBuyValue)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-sm text-muted-foreground">Net Sell Value</dt>
              <dd className="font-mono text-sm font-medium tabular-nums">{rupees(charges.netSellValue)}</dd>
            </div>
          </div>
        </div>
      </section>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3 lg:grid-cols-3">
        <div className="flex min-h-0 flex-col gap-2 lg:col-span-2">
          <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border">
            {/* flex-1 fills whatever room is actually available (the whole
                page is height-locked, see page.tsx) — a tall screen shows
                many more rows before this needs to scroll at all, rather
                than always stopping at some fixed count. min-h keeps at
                least one row visible rather than collapsing to nothing on
                a very short viewport. */}
            <div className="min-h-[112px] flex-1 overflow-auto">
              {/*
                table-fixed + explicit widths on every column but Instrument
                lock Buy Price/Sell Price/Qty in place regardless of cell
                content — without it, the browser's auto table layout sizes
                every column from the widest content in it, so switching an
                instrument (which changes the Instrument label's natural
                width) reflowed the whole table and visibly shook the
                price/qty columns next to it.
              */}
              <table className="w-full table-fixed border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-border bg-background text-left text-muted-foreground">
                    <th className="px-4 py-2 font-medium">Instrument</th>
                    <th className="w-[110px] px-2 py-2 font-medium">Buy Price</th>
                    <th className="w-[110px] px-2 py-2 font-medium">Sell Price</th>
                    <th className="w-[110px] px-2 py-2 font-medium">Qty</th>
                    <th className="w-12 py-3 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {legs.map((leg, index) => {
                      const lotSize = leg.option.instrument ? DEFAULT_LOT_SIZES[leg.option.instrument] : null;
                      return (
                        <motion.tr
                          key={leg.key}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: 0.15 }}
                          className="border-b border-border last:border-0"
                        >
                          <td className="px-4 py-2 align-top">
                            <InstrumentSearch
                              options={CALC_OPTIONS}
                              value={leg.option}
                              onChange={(next) => handleLegOptionChange(leg.key, next)}
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="number"
                              step="0.05"
                              inputMode="decimal"
                              value={leg.buyPrice}
                              onChange={(e) => handleLegPriceChange(leg.key, "buyPrice", e.target.value)}
                              placeholder="0.00"
                              className={`${inputClass} font-mono tabular-nums`}
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="number"
                              step="0.05"
                              inputMode="decimal"
                              value={leg.sellPrice}
                              onChange={(e) => handleLegPriceChange(leg.key, "sellPrice", e.target.value)}
                              placeholder="0.00"
                              className={`${inputClass} font-mono tabular-nums`}
                            />
                          </td>
                          <td className="px-2 py-2 align-top">
                            <input
                              type="number"
                              min={lotSize ?? 1}
                              step={lotSize ?? 1}
                              value={leg.qty}
                              onChange={(e) =>
                                handleLegQtyChange(leg.key, Math.max(1, Math.trunc(toNumber(e.target.value)) || 1))
                              }
                              // Snapped to the nearest whole lot only once typing is done — not on
                              // every keystroke, which would fight a user typing a multi-digit
                              // quantity (each digit would get rounded before the next one lands).
                              onBlur={() => {
                                const normalized = normalizeQty(leg.qty, lotSize);
                                if (normalized !== leg.qty) handleLegQtyChange(leg.key, normalized);
                              }}
                              className={`${inputClass} font-mono tabular-nums`}
                            />
                          </td>
                          <td className="py-2 pr-4 text-center align-top">
                            <button
                              type="button"
                              onClick={() => removeLeg(leg.key)}
                              disabled={legs.length === 1}
                              className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-loss/10 hover:text-loss disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent active:scale-90"
                              aria-label={`Remove leg ${index + 1}`}
                            >
                              <TrashIcon className="size-4" />
                            </button>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>

            <div className="flex items-stretch border-t border-dashed border-border">
              <button
                type="button"
                onClick={addLeg}
                className="flex flex-1 items-center justify-center gap-1.5 py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground active:scale-[0.98]"
              >
                <PlusIcon className="size-4" />
                Add Leg
              </button>
              <button
                type="button"
                onClick={handleClearAll}
                className="flex items-center gap-1.5 border-l border-dashed border-border px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-loss/10 hover:text-loss active:scale-[0.98]"
              >
                <TrashIcon className="size-4" />
                Clear
              </button>
            </div>
          </section>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-background p-4 sm:p-5">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Charges Breakup
            </h2>

            {/* flex-1 + justify-between spreads the 8 rows evenly across
                whatever height the card actually has (it matches the legs
                table's height) instead of bunching them at the top and
                leaving one big gap before the total. divide-y gives each
                row its own separator instead of leaving the spacing to
                read as arbitrary gaps. */}
            <dl className="mt-3 flex flex-1 flex-col justify-between divide-y divide-border">
              {BREAKUP_ROWS.map(({ key, label }) => (
                <div key={key} className="flex items-center justify-between py-2 first:pt-0 last:pb-0">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="font-mono text-sm font-medium tabular-nums">{rupees(charges[key])}</dd>
                </div>
              ))}
            </dl>

            <div className="flex items-center justify-between border-t border-border pt-3">
              <dt className="text-sm font-medium">Total taxes and charges</dt>
              <dd className="font-mono text-base font-semibold tabular-nums">{rupees(charges.totalCharges)}</dd>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  );
}
