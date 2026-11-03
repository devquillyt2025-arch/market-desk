"use client";

/**
 * Upstox's own "Trade summary" for the range Reports is showing — gross and
 * net P&L, charges broken down, ROI, profit factor and win rate — fetched
 * live rather than worked out from the journal, so it always agrees with
 * Upstox's P&L screen to the paisa. Like Upstox, it covers every trade in the
 * picked segment (F&O includes stock options) that closed in the range,
 * counted per report row.
 */

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { XIcon } from "@/components/icons";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/Select";
import { pnlColorClass } from "@/lib/format";
import { fetchPnlSummary } from "@/lib/upstox/client";
import { useDialogFocus } from "@/lib/useDialogFocus";
import {
  isUpstoxPnlSummaryError,
  UPSTOX_PNL_SEGMENT_LABELS,
  UPSTOX_PNL_SEGMENTS,
  type UpstoxChargesBreakdown,
  type UpstoxPnlSegment,
  type UpstoxPnlSummaryResult,
} from "@/lib/upstox/types";

const SEGMENT_OPTIONS = UPSTOX_PNL_SEGMENTS.map((s) => ({ value: s, label: UPSTOX_PNL_SEGMENT_LABELS[s] }));

const inrPaise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** Every line of Upstox's charges popup the API can supply — the last three only show up when non-zero. */
const CHARGE_LINES: { key: keyof UpstoxChargesBreakdown; label: string; always: boolean }[] = [
  { key: "brokerage", label: "Brokerage", always: true },
  { key: "gst", label: "GST", always: true },
  { key: "stt", label: "Securities transaction tax", always: true },
  { key: "stampDuty", label: "Stamp duty", always: true },
  { key: "transactionAndSebi", label: "Transaction charges & SEBI fees", always: true },
  { key: "clearing", label: "Clearing charges", always: false },
  { key: "ipft", label: "IPFT charges", always: false },
  { key: "demat", label: "Demat charges", always: false },
];

function Row({ label, value, className = "", strong = false }: { label: React.ReactNode; value: string; className?: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between gap-3 py-1.5 text-sm ${strong ? "font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted-foreground"}>{label}</dt>
      <dd className={`font-mono tabular-nums ${className}`}>{value}</dd>
    </div>
  );
}

type ChargesDialogProps = {
  charges: UpstoxChargesBreakdown;
  /** e.g. "F&O · 04 Aug 2026 – 02 Nov 2026" — which figures these are. */
  caption: string;
  onClose: () => void;
};

/** "Charges and Breakdown" popup, like the one behind Upstox's own "Charges & taxes" link. */
function ChargesDialog({ charges, caption, onClose }: ChargesDialogProps) {
  const dialogRef = useDialogFocus();
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="glass-backdrop fixed inset-0 z-[300] flex items-center justify-center p-4 print:hidden"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12, ease: "easeIn" } }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="charges-dialog-title"
        className="glass-panel flex w-full max-w-md flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="charges-dialog-title" className="text-lg font-semibold tracking-tight">
              Charges and Breakdown
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{caption}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>
        <dl className="px-5 py-3">
          {CHARGE_LINES.filter((line) => line.always || charges[line.key] !== 0).map((line) => (
            <Row key={line.key} label={line.label} value={inrPaise.format(charges[line.key])} />
          ))}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-2 pb-1.5 text-sm font-semibold">
            <dt>Total</dt>
            <dd className="font-mono tabular-nums">{inrPaise.format(charges.total)}</dd>
          </div>
        </dl>
      </motion.div>
    </motion.div>
  );
}

export default function UpstoxTradeSummary({ from, to }: { from: string; to: string }) {
  const [segment, setSegment] = useState<UpstoxPnlSegment>("FO");
  // Keyed by what was asked for, so a segment/range change shows loading without resetting state inside an effect.
  const [attempt, setAttempt] = useState(0);
  const key = `${segment}|${from}|${to}|${attempt}`;
  const [loaded, setLoaded] = useState<{ key: string; result: UpstoxPnlSummaryResult } | null>(null);
  const [showCharges, setShowCharges] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPnlSummary(segment, from, to).then((result) => {
      if (!cancelled) setLoaded({ key, result });
    });
    return () => {
      cancelled = true;
    };
  }, [segment, from, to, key]);

  const result = loaded?.key === key ? loaded.result : null;

  // While the next figures load, the body holds the height of the last ones.
  // Otherwise it shrinks to a spinner on every range or segment change and
  // everything below jumps up, then back down when the figures arrive. Done on
  // the DOM, before paint, rather than through state: it only needs to keep the
  // box from collapsing, not to re-render anything.
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastBodyHeight = useRef(0);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    if (result === null) {
      el.style.minHeight = `${lastBodyHeight.current}px`;
    } else {
      el.style.minHeight = "";
      lastBodyHeight.current = el.offsetHeight;
    }
  }, [result]);

  let body: React.ReactNode;
  if (result === null) {
    body = <LoadingState className="h-32" label="Fetching your trade summary from Upstox…" />;
  } else if (isUpstoxPnlSummaryError(result)) {
    body = (
      <p className="py-6 text-center text-sm text-muted-foreground">
        {result.error === "token_expired" ? (
          <>
            Your Upstox token has expired.{" "}
            <Link href="/settings" className="font-medium text-accent hover:underline">
              Add today&apos;s token
            </Link>{" "}
            to load Upstox&apos;s figures.
          </>
        ) : (
          <>
            {result.error === "network_error" ? "No internet connection." : `Couldn't load Upstox's summary — ${result.error}`}{" "}
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="font-medium text-accent hover:underline">
              Try again
            </button>
          </>
        )}
      </p>
    );
  } else if (result.tradeCount === 0) {
    body = (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No {UPSTOX_PNL_SEGMENT_LABELS[segment]} trades closed on Upstox in this range.
      </p>
    );
  } else {
    const netPnl = result.grossPnl - result.charges.total;
    const roiPct = result.buyValue > 0 ? (result.grossPnl / result.buyValue) * 100 : null;
    const profitFactor = result.losingPnl < 0 ? result.winningPnl / Math.abs(result.losingPnl) : null;
    const winPct = Math.round((result.winningCount / result.tradeCount) * 100);

    body = (
      <div className="grid gap-3 lg:grid-cols-2">
        <dl className="rounded-lg border border-border bg-card px-4 py-2">
          <Row label="Gross P&L" value={inrPaise.format(result.grossPnl)} className={pnlColorClass(result.grossPnl)} strong />
          <Row label="Net P&L" value={inrPaise.format(netPnl)} className={pnlColorClass(netPnl)} />
          <Row
            label={
              <button
                type="button"
                onClick={() => setShowCharges(true)}
                aria-haspopup="dialog"
                className="text-accent underline underline-offset-4 hover:opacity-80 print:text-muted-foreground print:no-underline"
              >
                Charges &amp; taxes
              </button>
            }
            value={inrPaise.format(result.charges.total)}
          />
        </dl>

        <dl className="rounded-lg border border-border bg-card px-4 py-2">
          <Row label="ROI %" value={roiPct === null ? "—" : `${roiPct.toFixed(2)}%`} strong />
          <Row
            label="Profit factor"
            value={profitFactor === null ? (result.winningPnl > 0 ? "∞" : "—") : profitFactor.toFixed(2)}
            className={profitFactor === null ? "" : pnlColorClass(profitFactor - 1)}
          />
          <Row label="Winning trades (₹)" value={inrPaise.format(result.winningPnl)} />
          <Row label="Losing trades (₹)" value={inrPaise.format(result.losingPnl)} />
          <Row label="Winning trades (%)" value={`${result.winningCount}/${result.tradeCount} (${winPct}%)`} />
        </dl>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-background p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">Upstox Trade Summary</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            As of {formatDate(from)} – {formatDate(to)} · {UPSTOX_PNL_SEGMENT_LABELS[segment]} trades closed in this range,
            straight from Upstox. ROI is gross P&amp;L over the total bought.
          </p>
        </div>
        <div className="w-28 shrink-0 print:hidden">
          <Select value={segment} onChange={setSegment} options={SEGMENT_OPTIONS} align="right" />
        </div>
      </div>
      <div ref={bodyRef} className="mt-3">
        {body}
      </div>

      <AnimatePresence>
        {showCharges && result && !isUpstoxPnlSummaryError(result) && (
          <ChargesDialog
            key="charges"
            charges={result.charges}
            caption={`${UPSTOX_PNL_SEGMENT_LABELS[segment]} · ${formatDate(from)} – ${formatDate(to)}`}
            onClose={() => setShowCharges(false)}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
