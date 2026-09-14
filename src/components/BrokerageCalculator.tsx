"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useId, useRef, useState } from "react";

import { ActivityIcon, ChevronDownIcon } from "@/components/icons";
import InstrumentSearch, { type CalcOption } from "@/components/InstrumentSearch";
import { logEvent } from "@/lib/activityLog";
import { calculateTrade } from "@/lib/calculateTrade";
import { brokerageRuleText, calculateBrokerage, type BrokerageBreakdown } from "@/lib/calculateBrokerage";
import { pnlColorClass } from "@/lib/format";
import { DEFAULT_LOT_SIZES } from "@/lib/types";

/** Coalesces rapid keystrokes into one log entry instead of one per character. */
const LOG_DEBOUNCE_MS = 600;

/**
 * One combined "what am I trading" choice, matching Upstox's own calculator
 * (upstox.com/calculator/brokerage-calculator): a single search box instead
 * of separate Segment + Instrument controls. Equity has no lot concept, so
 * it carries `instrument: null`.
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

function rupees(value: number): string {
  return `₹${value.toFixed(2)}`;
}

function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";
const labelClass = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

export default function BrokerageCalculator() {
  const [option, setOption] = useState<CalcOption>(CALC_OPTIONS[0]);
  const [buyPrice, setBuyPrice] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [qty, setQty] = useState(DEFAULT_LOT_SIZES.NIFTY);
  const [showBreakup, setShowBreakup] = useState(true);

  const qtyId = useId();
  const buyId = useId();
  const sellId = useId();
  const pendingLogs = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = pendingLogs.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

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

  function handleOptionChange(next: CalcOption) {
    if (next.id === option.id) return;
    setOption(next);
    setQty(next.instrument ? DEFAULT_LOT_SIZES[next.instrument] : 1);
    logEvent(`Brokerage calculator instrument changed to ${next.label}`);
  }

  function handleQtyChange(nextQty: number) {
    setQty(nextQty);
    if (nextQty !== qty) logDebounced("brokerage-qty", `Brokerage calculator qty changed to ${nextQty}`);
  }

  function handlePriceChange(field: "buy" | "sell", value: string) {
    if (field === "buy") setBuyPrice(value);
    else setSellPrice(value);
    logDebounced(
      `brokerage-${field}`,
      `Brokerage calculator: ${field === "buy" ? "Buy" : "Sell"} price changed to ${value || "0"}`,
    );
  }

  const leg = { buyPrice: toNumber(buyPrice), sellPrice: toNumber(sellPrice) };
  const trade = calculateTrade([leg], qty);
  const charges = calculateBrokerage(option.segment, [leg], qty);
  const otherCharges = charges.totalCharges - charges.brokerage;
  const netPnl = trade.totalPnl - charges.totalCharges;
  const netColor = pnlColorClass(netPnl);
  const lotSize = option.instrument ? DEFAULT_LOT_SIZES[option.instrument] : null;

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
      className="flex flex-col gap-6"
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {topStats.map((stat) => (
          <section key={stat.label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums transition-colors ${stat.color}`}>
              {stat.value}
            </dd>
          </section>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Instrument</span>
              <InstrumentSearch options={CALC_OPTIONS} value={option} onChange={handleOptionChange} />
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <label htmlFor={buyId} className={labelClass}>
                  Buy Price
                </label>
                <input
                  id={buyId}
                  type="number"
                  step="0.05"
                  inputMode="decimal"
                  value={buyPrice}
                  onChange={(e) => handlePriceChange("buy", e.target.value)}
                  placeholder="0.00"
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={sellId} className={labelClass}>
                  Sell Price
                </label>
                <input
                  id={sellId}
                  type="number"
                  step="0.05"
                  inputMode="decimal"
                  value={sellPrice}
                  onChange={(e) => handlePriceChange("sell", e.target.value)}
                  placeholder="0.00"
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor={qtyId} className={labelClass}>
                  Qty
                </label>
                <input
                  id={qtyId}
                  type="number"
                  min={1}
                  step={1}
                  value={qty}
                  onChange={(e) => handleQtyChange(Math.max(1, Math.trunc(toNumber(e.target.value))))}
                  className={`${inputClass} font-mono tabular-nums`}
                />
                {lotSize && (
                  <span className="text-xs text-muted-foreground">
                    1 lot = {lotSize} qty
                    {qty % lotSize !== 0 && " — not a multiple of the lot size"}
                  </span>
                )}
              </div>
            </div>
          </section>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ActivityIcon className="mt-0.5 size-3.5 shrink-0" />
            {option.segment === "DELIVERY"
              ? "Delivery"
              : option.segment === "INTRADAY"
                ? "Intraday"
                : option.segment === "FUTURES"
                  ? "Futures"
                  : "Options"}{" "}
            charges: brokerage is {brokerageRuleText(option.segment)} (Upstox&apos;s rate). STT, transaction
            charges, SEBI fees, stamp duty, and GST are exchange/government-mandated and change
            periodically — treat this as indicative, not a substitute for your broker&apos;s contract
            note. DP charges (₹20/scrip/sell-day + GST, delivery only) are shown GST-inclusive and
            aren&apos;t added into the GST line above. Clearing charges are listed for parity with
            Upstox&apos;s own breakdown but aren&apos;t separately levied. A trade with only a buy or
            only a sell price is costed as one order, not a round trip.
          </p>
        </div>

        <div className="flex flex-col gap-4 lg:sticky lg:top-8">
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <dl className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <dt className="text-sm text-muted-foreground">Gross P&amp;L</dt>
                <dd className="font-mono text-sm font-medium tabular-nums">{rupees(trade.totalPnl)}</dd>
              </div>
            </dl>
            <div className="mt-4 border-t border-border pt-4">
              <dt className="text-sm text-muted-foreground">Net PnL (after charges)</dt>
              <dd className={`mt-1 font-mono text-3xl font-semibold tabular-nums ${netColor}`}>
                {rupees(netPnl)}
              </dd>
            </div>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <button
              type="button"
              onClick={() => setShowBreakup((prev) => !prev)}
              className="flex w-full items-center justify-between text-left"
            >
              <h2 className="text-sm font-medium">
                {showBreakup ? "Hide" : "Show"} charges breakup
              </h2>
              <ChevronDownIcon
                className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                  showBreakup ? "rotate-180" : ""
                }`}
              />
            </button>

            <AnimatePresence initial={false}>
              {showBreakup && (
                <motion.div
                  key="breakup"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden"
                >
                  <dl className="mt-4 flex flex-col gap-3">
                    {BREAKUP_ROWS.map(({ key, label }) => (
                      <div key={key} className="flex items-center justify-between">
                        <dt className="text-sm text-muted-foreground">{label}</dt>
                        <dd className="font-mono text-sm font-medium tabular-nums">
                          {rupees(charges[key])}
                        </dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                    <dt className="text-sm font-medium">Total taxes and charges</dt>
                    <dd className="font-mono text-lg font-semibold tabular-nums">
                      {rupees(charges.totalCharges)}
                    </dd>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </section>

          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <h2 className="text-sm font-medium text-muted-foreground">Trade Values</h2>
            <dl className="mt-4 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <dt className="text-sm text-muted-foreground">Net Buy Value</dt>
                <dd className="font-mono text-sm font-medium tabular-nums">
                  {rupees(charges.netBuyValue)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm text-muted-foreground">Net Sell Value</dt>
                <dd className="font-mono text-sm font-medium tabular-nums">
                  {rupees(charges.netSellValue)}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-sm text-muted-foreground">Points to Breakeven</dt>
                <dd className="font-mono text-sm font-medium tabular-nums">
                  {rupees(charges.pointsToBreakeven)}
                </dd>
              </div>
            </dl>
          </section>
        </div>
      </div>
    </motion.div>
  );
}
