"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ActivityIcon, ChevronDownIcon } from "@/components/icons";
import { logEvent } from "@/lib/activityLog";
import { calculateTrade } from "@/lib/calculateTrade";
import {
  brokerageRuleText,
  calculateBrokerage,
  SEGMENT_RATES,
  type BrokerageBreakdown,
  type BrokerageSegment,
} from "@/lib/calculateBrokerage";
import LegsTable, { newLeg, toNumber, type LegRow } from "@/components/LegsTable";
import TradeInputsPanel from "@/components/TradeInputsPanel";
import { DEFAULT_LOT_SIZES, INSTRUMENT_LABELS, type Instrument } from "@/lib/types";

/** Coalesces rapid keystrokes into one log entry instead of one per character. */
const LOG_DEBOUNCE_MS = 600;

const SEGMENTS: BrokerageSegment[] = ["DELIVERY", "INTRADAY", "FUTURES", "OPTIONS"];

/** Delivery/Intraday are plain equity — no index instrument or lot concept applies. */
function usesInstrumentPanel(segment: BrokerageSegment): boolean {
  return segment === "FUTURES" || segment === "OPTIONS";
}

function rupees(value: number): string {
  return `₹${value.toFixed(2)}`;
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
  const [segment, setSegment] = useState<BrokerageSegment>("OPTIONS");
  const [instrument, setInstrument] = useState<Instrument>("NIFTY");
  const [lotSize, setLotSize] = useState(DEFAULT_LOT_SIZES.NIFTY);
  const [lots, setLots] = useState(1);
  const [qty, setQty] = useState(DEFAULT_LOT_SIZES.NIFTY);
  const [legs, setLegs] = useState<LegRow[]>([newLeg(), newLeg()]);
  const [showBreakup, setShowBreakup] = useState(true);

  const quantityId = useId();
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

  function handleSegmentChange(next: BrokerageSegment) {
    if (next === segment) return;
    setSegment(next);
    setQty(usesInstrumentPanel(next) ? lots * lotSize : 1);
    logEvent(`Brokerage calculator segment changed to ${SEGMENT_RATES[next].label}`);
  }

  function handleInstrumentChange(next: Instrument) {
    if (next === instrument) return;
    const nextLotSize = DEFAULT_LOT_SIZES[next];
    setInstrument(next);
    setLotSize(nextLotSize);
    setQty(lots * nextLotSize);
    logEvent(`Brokerage calculator instrument changed to ${INSTRUMENT_LABELS[next]}`);
  }

  function handleLotSizeChange(nextLotSize: number) {
    setLotSize(nextLotSize);
    setQty(lots * nextLotSize);
    if (nextLotSize !== lotSize)
      logDebounced("brokerage-lotSize", `Brokerage calculator lot size changed to ${nextLotSize}`);
  }

  function handleLotsChange(nextLots: number) {
    setLots(nextLots);
    setQty(nextLots * lotSize);
    if (nextLots !== lots) logDebounced("brokerage-lots", `Brokerage calculator lots changed to ${nextLots}`);
  }

  function handleQtyChange(nextQty: number) {
    setQty(nextQty);
    if (nextQty !== qty) logDebounced("brokerage-qty", `Brokerage calculator qty changed to ${nextQty}`);
  }

  function updateLeg(key: number, field: "sellPrice" | "buyPrice", value: string) {
    setLegs((prev) => prev.map((leg) => (leg.key === key ? { ...leg, [field]: value } : leg)));
    const legNumber = legs.findIndex((leg) => leg.key === key) + 1;
    const fieldLabel = field === "sellPrice" ? "Sell price" : "Buy price";
    logDebounced(
      `brokerage-leg-${key}-${field}`,
      `Brokerage calculator: ${fieldLabel.toLowerCase()} for leg ${legNumber} changed to ${value || "0"}`,
    );
  }

  function addLeg() {
    setLegs((prev) => [...prev, newLeg()]);
    logEvent(`Brokerage calculator: added leg ${legs.length + 1}`);
  }

  function removeLeg(key: number) {
    const legNumber = legs.findIndex((leg) => leg.key === key) + 1;
    setLegs((prev) => (prev.length > 1 ? prev.filter((leg) => leg.key !== key) : prev));
    if (legs.length > 1) logEvent(`Brokerage calculator: removed leg ${legNumber}`);
  }

  const numericLegs = legs.map((leg) => ({
    sellPrice: toNumber(leg.sellPrice),
    buyPrice: toNumber(leg.buyPrice),
  }));

  const trade = calculateTrade(numericLegs, qty);
  const charges = calculateBrokerage(segment, numericLegs, qty);
  const otherCharges = charges.totalCharges - charges.brokerage;
  const netPnl = trade.totalPnl - charges.totalCharges;
  const netSign = netPnl > 0 ? "profit" : netPnl < 0 ? "loss" : "flat";
  const netColor = netSign === "profit" ? "text-profit" : netSign === "loss" ? "text-loss" : "text-foreground";

  const topStats = [
    { label: "Brokerage", value: rupees(charges.brokerage), color: "" },
    { label: "Other Charges", value: rupees(otherCharges), color: "" },
    { label: "Points to Breakeven", value: rupees(charges.pointsToBreakeven), color: "" },
    { label: "Net PnL", value: rupees(netPnl), color: netColor },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {topStats.map((stat) => (
          <section key={stat.label} className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <dt className="text-xs text-muted-foreground">{stat.label}</dt>
            <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums ${stat.color}`}>
              {stat.value}
            </dd>
          </section>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3 lg:items-start">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
            <div className="flex flex-col gap-1.5">
              <span className={labelClass}>Segment</span>
              <div className="inline-flex w-fit rounded-lg border border-border bg-muted p-1">
                {SEGMENTS.map((seg) => (
                  <button
                    key={seg}
                    type="button"
                    onClick={() => handleSegmentChange(seg)}
                    className={
                      seg === segment
                        ? "rounded-md bg-card px-3.5 py-1.5 text-sm font-medium text-foreground shadow-sm"
                        : "rounded-md px-3.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                    }
                  >
                    {SEGMENT_RATES[seg].label}
                  </button>
                ))}
              </div>
            </div>
          </section>

          {usesInstrumentPanel(segment) ? (
            <TradeInputsPanel
              instrument={instrument}
              lotSize={lotSize}
              lots={lots}
              qty={qty}
              onInstrumentChange={handleInstrumentChange}
              onLotSizeChange={handleLotSizeChange}
              onLotsChange={handleLotsChange}
              onQtyChange={handleQtyChange}
            />
          ) : (
            <section className="rounded-xl border border-border bg-card p-5 shadow-sm sm:p-6">
              <div className="flex flex-col gap-1.5 sm:max-w-[160px]">
                <label htmlFor={quantityId} className={labelClass}>
                  Quantity
                </label>
                <input
                  id={quantityId}
                  type="number"
                  min={1}
                  step={1}
                  value={qty}
                  onChange={(e) => handleQtyChange(Math.max(1, Math.trunc(toNumber(e.target.value))))}
                  className={`${inputClass} font-mono tabular-nums`}
                />
              </div>
            </section>
          )}

          <LegsTable legs={legs} onLegChange={updateLeg} onAddLeg={addLeg} onRemoveLeg={removeLeg} />

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <ActivityIcon className="mt-0.5 size-3.5 shrink-0" />
            {SEGMENT_RATES[segment].label} charges: brokerage is {brokerageRuleText(segment)} (Upstox&apos;s
            rate). STT, transaction charges, SEBI fees, stamp duty, and GST are
            exchange/government-mandated and change periodically — treat this as indicative, not a
            substitute for your broker&apos;s contract note. DP charges (₹20/scrip/sell-day + GST,
            delivery only) are shown GST-inclusive and aren&apos;t added into the GST line above.
            Clearing charges are listed for parity with Upstox&apos;s own breakdown but aren&apos;t
            separately levied. A leg with only a sell or only a buy price is costed as one order, not a
            round trip.
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

            {showBreakup && (
              <>
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
              </>
            )}
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
    </div>
  );
}
