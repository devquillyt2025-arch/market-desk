"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

import { CheckIcon, CopyIcon, TrendingDownIcon, TrendingUpIcon, WalletIcon, XIcon } from "@/components/icons";
import { calculateBrokerage } from "@/lib/calculateBrokerage";
import { round2 } from "@/lib/calculateTrade";
import { formatINR, formatPct, pnlColorClass } from "@/lib/format";
import { describeEntryContract } from "@/lib/tradeEntriesStore";
import type { UpstoxPosition } from "@/lib/upstox/types";

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function average(value: number, quantity: number): number | null {
  return quantity > 0 ? round2(value / quantity) : null;
}

function formatINRDecimals(amount: number): string {
  const isNeg = amount < 0;
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${isNeg ? "- " : ""}₹${formatted}`;
}

type Props = {
  position: UpstoxPosition;
  onClose: () => void;
};

export default function ClosedPositionDetailModal({ position: p, onClose }: Props) {
  const [copiedKey, setCopiedKey] = useState(false);

  // Close on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const buyAvg = average(p.buyValue, p.buyQuantity);
  const sellAvg = average(p.sellValue, p.sellQuantity);
  const grossPnl = round2(p.sellValue - p.buyValue);
  const totalQty = p.buyQuantity > 0 ? p.buyQuantity : p.sellQuantity;
  const lots = p.lotSize > 0 ? round2(totalQty / p.lotSize) : 0;

  // Brokerage & Regulatory breakdown
  const brokerage =
    buyAvg != null && sellAvg != null && totalQty > 0
      ? calculateBrokerage("OPTIONS", [{ buyPrice: buyAvg, sellPrice: sellAvg }], totalQty)
      : null;
  const totalCharges = brokerage?.totalCharges ?? null;
  const netPnl = totalCharges != null ? round2(grossPnl - totalCharges) : grossPnl;

  // Money Invested (Capital deployed):
  // For options buying, premium paid = buyValue.
  // In case of shorting first or carried position, fallback to sellValue.
  const moneyInvested = p.buyValue > 0 ? p.buyValue : p.sellValue;

  // Returns in percentage (%)
  const grossReturnPct = moneyInvested > 0 ? round2((grossPnl / moneyInvested) * 100) : null;
  const netReturnPct = moneyInvested > 0 ? round2((netPnl / moneyInvested) * 100) : null;

  // Points difference captured per unit/share
  const pointsCaptured = buyAvg != null && sellAvg != null ? round2(sellAvg - buyAvg) : null;

  const instrument = describeEntryContract({
    instrument: p.instrument,
    strike_price: p.strike,
    option_type: p.optionType,
  });

  const isProfit = netPnl >= 0;

  async function handleCopyKey() {
    try {
      await navigator.clipboard.writeText(p.instrumentKey);
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    } catch {
      // ignore clipboard error
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="glass-backdrop fixed inset-0 z-[300] flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -6, transition: { duration: 0.12, ease: "easeIn" } }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        className="glass-panel flex max-h-[92vh] w-full max-w-5xl flex-col overflow-y-auto rounded-2xl border border-border shadow-2xl"
      >
        {/* Landscape Header */}
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-card/70 px-5 py-3.5 backdrop-blur-sm sm:px-6">
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {p.instrument}
              </span>
              <span
                className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-bold ${
                  p.optionType === "CE"
                    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                }`}
              >
                {p.optionType}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                Squared Off Today
              </span>
              <span className="text-xs text-muted-foreground">
                Expiry: <span className="font-medium text-foreground">{formatDate(p.expiry)}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{instrument}</h2>
              <span className="text-xs text-muted-foreground">
                {lots} lot{lots !== 1 ? "s" : ""} · {totalQty} qty (Lot Size: {p.lotSize})
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        {/* Hero Performance Cards Row: Money Invested, Realised P&L, Return % */}
        <div className="grid grid-cols-1 gap-px border-b border-border bg-border sm:grid-cols-3">
          {/* Money Invested */}
          <div className="flex flex-col justify-between gap-1.5 bg-card p-4 sm:px-6 sm:py-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Money Invested</span>
              <WalletIcon className="size-4 text-muted-foreground/70" />
            </div>
            <div>
              <div className="font-mono text-2xl font-bold tracking-tight text-foreground tabular-nums">
                {formatINR(moneyInvested)}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Buy Turnover: {formatINR(p.buyValue)}
              </div>
            </div>
          </div>

          {/* Realised P&L */}
          <div className="flex flex-col justify-between gap-1.5 bg-card p-4 sm:px-6 sm:py-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Realised P&amp;L</span>
              {isProfit ? (
                <TrendingUpIcon className="size-4 text-profit" />
              ) : (
                <TrendingDownIcon className="size-4 text-danger-fg" />
              )}
            </div>
            <div>
              <div className={`font-mono text-2xl font-bold tracking-tight tabular-nums ${pnlColorClass(netPnl)}`}>
                {formatINR(netPnl)}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Gross: <span className={pnlColorClass(grossPnl)}>{formatINR(grossPnl)}</span> · Chgs:{" "}
                {totalCharges == null ? "—" : formatINR(totalCharges)}
              </div>
            </div>
          </div>

          {/* Return % */}
          <div className="flex flex-col justify-between gap-1.5 bg-card p-4 sm:px-6 sm:py-4">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-[11px] font-semibold uppercase tracking-wider">Return (ROI)</span>
              <span
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                  (netReturnPct ?? 0) >= 0 ? "bg-profit/15 text-profit" : "bg-loss/15 text-danger-fg"
                }`}
              >
                {netReturnPct == null ? "0%" : formatPct(netReturnPct, 1)}
              </span>
            </div>
            <div>
              <div
                className={`font-mono text-2xl font-bold tracking-tight tabular-nums ${
                  netReturnPct == null ? "text-foreground" : pnlColorClass(netReturnPct)
                }`}
              >
                {netReturnPct == null ? "—" : formatPct(netReturnPct, 2)}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                Gross ROI: {grossReturnPct == null ? "—" : formatPct(grossReturnPct, 2)}
              </div>
            </div>
          </div>
        </div>

        {/* Main Landscape Body: 2 Columns */}
        <div className="grid grid-cols-1 gap-5 p-5 sm:p-6 lg:grid-cols-12">
          {/* Left Column (7 cols): Execution Details & Net Summary */}
          <div className="flex flex-col gap-4 lg:col-span-7">
            {/* Trade Execution */}
            <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/15 p-4 sm:p-5">
              <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Trade Execution Summary
                </h3>
                {pointsCaptured != null && (
                  <span
                    className={`rounded-md border px-2 py-0.5 font-mono text-xs font-semibold tabular-nums ${
                      pointsCaptured >= 0
                        ? "border-profit/30 bg-profit/10 text-profit"
                        : "border-loss/30 bg-loss/10 text-danger-fg"
                    }`}
                  >
                    {pointsCaptured >= 0 ? "+" : ""}
                    {pointsCaptured.toFixed(2)} pts captured
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {/* Buy Leg */}
                <div className="rounded-lg border border-border/60 bg-card/60 p-3.5">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <span className="size-2 rounded-full bg-blue-500" />
                      Buy Leg (Entry)
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.buyQuantity} qty
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Buy Avg Price</span>
                    <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                      {buyAvg == null ? "—" : `₹${buyAvg.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Buy Turnover</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatINRDecimals(p.buyValue)}
                    </span>
                  </div>
                </div>

                {/* Sell Leg */}
                <div className="rounded-lg border border-border/60 bg-card/60 p-3.5">
                  <div className="flex items-center justify-between border-b border-border/40 pb-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <span className="size-2 rounded-full bg-amber-500" />
                      Sell Leg (Exit)
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.sellQuantity} qty
                    </span>
                  </div>
                  <div className="mt-2.5 flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Sell Avg Price</span>
                    <span className="font-mono text-base font-semibold tabular-nums text-foreground">
                      {sellAvg == null ? "—" : `₹${sellAvg.toFixed(2)}`}
                    </span>
                  </div>
                  <div className="mt-1.5 flex items-baseline justify-between">
                    <span className="text-xs text-muted-foreground">Sell Turnover</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {formatINRDecimals(p.sellValue)}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Net Outcome Summary Callout */}
            <div className="flex items-center justify-between rounded-xl border border-border bg-card p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Net Realised Outcome
                </span>
                <span className="text-xs text-muted-foreground">
                  Gross {formatINR(grossPnl)} − Charges {totalCharges == null ? "₹0" : formatINR(totalCharges)}
                </span>
              </div>
              <div className="text-right">
                <div className={`font-mono text-xl font-bold tabular-nums ${pnlColorClass(netPnl)}`}>
                  {formatINR(netPnl)}
                </div>
                <div className="font-mono text-xs font-medium text-muted-foreground">
                  {netReturnPct == null ? "—" : `${formatPct(netReturnPct, 2)} Net ROI`}
                </div>
              </div>
            </div>
          </div>

          {/* Right Column (5 cols): Contract Info & Charges Breakdown */}
          <div className="flex flex-col gap-4 lg:col-span-5">
            {/* Market & Contract Snapshot */}
            <div className="rounded-xl border border-border/70 bg-muted/15 p-4 sm:p-5">
              <h4 className="border-b border-border/50 pb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Market &amp; Contract Information
              </h4>
              <div className="mt-3 grid grid-cols-2 gap-y-2.5 text-xs">
                <div>
                  <span className="block text-[11px] text-muted-foreground">Last Traded Price</span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {p.lastPrice == null ? "—" : `₹${p.lastPrice.toFixed(2)}`}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-muted-foreground">Prev Day Close</span>
                  <span className="font-mono text-sm tabular-nums text-muted-foreground">
                    {p.closePrice == null ? "—" : `₹${p.closePrice.toFixed(2)}`}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-muted-foreground">Strike &amp; Type</span>
                  <span className="font-mono text-sm font-medium text-foreground">
                    {p.strike} {p.optionType}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] text-muted-foreground">Session Type</span>
                  <span className="text-xs font-medium text-foreground">
                    {p.overnightQuantity === 0 ? "Intraday Squared" : "Carried Over"}
                  </span>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2 text-xs">
                <span className="text-[11px] text-muted-foreground">Instrument Key</span>
                <button
                  type="button"
                  onClick={handleCopyKey}
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                  title="Click to copy key"
                >
                  <span className="max-w-[170px] truncate sm:max-w-none">{p.instrumentKey}</span>
                  {copiedKey ? <CheckIcon className="size-3 text-profit" /> : <CopyIcon className="size-3" />}
                </button>
              </div>
            </div>

            {/* Estimated Charges & Regulatory Fees */}
            {brokerage && (
              <div className="rounded-xl border border-border/70 bg-muted/15 p-4 sm:p-5">
                <div className="flex items-center justify-between border-b border-border/50 pb-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Charges &amp; Regulatory Fees
                  </span>
                  <span className="font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                    Total: {formatINRDecimals(brokerage.totalCharges)}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Brokerage</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {formatINRDecimals(brokerage.brokerage)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">STT / CTT</span>
                    <span className="font-mono tabular-nums text-foreground">{formatINRDecimals(brokerage.stt)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Exchange Txn</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {formatINRDecimals(brokerage.transactionCharges)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">GST (18%)</span>
                    <span className="font-mono tabular-nums text-foreground">{formatINRDecimals(brokerage.gst)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">Stamp Duty</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {formatINRDecimals(brokerage.stampDuty)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">SEBI Charges</span>
                    <span className="font-mono tabular-nums text-foreground">
                      {formatINRDecimals(brokerage.sebiCharges)}
                    </span>
                  </div>
                </div>

                {brokerage.pointsToBreakeven > 0 && (
                  <div className="mt-2.5 border-t border-border/40 pt-2 text-right text-[11px] text-muted-foreground">
                    Breakeven:{" "}
                    <span className="font-mono font-medium text-foreground">
                      +{brokerage.pointsToBreakeven.toFixed(2)} pts
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
