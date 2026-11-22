"use client";

/**
 * The "Upstox Trade Summary" at the top of Reports - gross and net P&L, charges broken down, ROI, profit factor and win
 * rate for the time frame, laid out the way Upstox's own P&L screen shows them. It is worked out from the same Upstox report
 * rows as Performance and every chart below it, so the cards can't disagree; the one thing the rows don't carry, the
 * charges, is Upstox's own figure for the same window. Like Upstox, a trade is a report row: a 3-lot exit that filled in three
 * pieces is three trades.
 */

import { AnimatePresence } from "framer-motion";
import { useState } from "react";

import { XIcon } from "@/components/icons";
import Modal from "@/components/Modal";
import type { ReportSummary } from "@/lib/calculateReports";
import { pnlColorClass } from "@/lib/format";
import type { PnlChargesState } from "@/lib/useUpstoxReport";
import { UPSTOX_SUMMARY_SCOPE_LABELS, type UpstoxChargesBreakdown, type UpstoxSummaryScope } from "@/lib/upstox/types";

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
  segment: UpstoxSummaryScope;
  /** e.g. "F&O · 04 Aug 2026 – 02 Nov 2026" — which figures these are. */
  caption: string;
  onClose: () => void;
};

/** "Charges and Breakdown" popup, like the one behind Upstox's own "Charges & taxes" link. */
function ChargesDialog({ charges, segment, caption, onClose }: ChargesDialogProps) {

  return (
    <Modal onClose={onClose} ariaLabelledBy="charges-dialog-title" className="flex sm:max-w-md flex-col overflow-hidden print:hidden">
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
          <Row
            key={line.key}
            // The tax Upstox's API files under "stt" is the commodities transaction tax on MCX - both, when the two are added together.
            label={line.key === "stt" ? (segment === "COM" ? "Commodities transaction tax" : segment === "ALL" ? "Securities & commodities transaction tax" : line.label) : line.label}
            value={inrPaise.format(charges[line.key])}
          />
        ))}
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-2 pb-1.5 text-sm font-semibold">
          <dt>Total</dt>
          <dd className="font-mono tabular-nums">{inrPaise.format(charges.total)}</dd>
        </div>
      </dl>
    </Modal>
  );
}


type Props = {
  scope: UpstoxSummaryScope;
  /** yyyy-mm-dd - the window the figures are for. */
  from: string;
  to: string;
  /** Of the trades in the window. */
  summary: ReportSummary;
  /** Total bought over the window's trades - the base of ROI %. */
  buyValue: number;
  charges: PnlChargesState;
};

export default function UpstoxTradeSummary({ scope, from, to, summary, buyValue, charges }: Props) {
  const [showCharges, setShowCharges] = useState(false);
  const total = charges.charges?.total ?? null;

  let body: React.ReactNode;
  if (summary.totalTrades === 0) {
    body = (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No {UPSTOX_SUMMARY_SCOPE_LABELS[scope]} trades closed on Upstox in this range.
      </p>
    );
  } else {
    const gross = summary.totalPnl;
    const net = total === null ? null : gross - total;
    const roiPct = buyValue > 0 ? (gross / buyValue) * 100 : null;
    const profitFactor = summary.grossLoss < 0 ? summary.grossProfit / Math.abs(summary.grossLoss) : null;
    const winPct = Math.round((summary.winCount / summary.totalTrades) * 100);

    body = (
      <div className="grid gap-3 lg:grid-cols-2">
        <dl className="rounded-lg border border-border bg-card px-4 py-2">
          <Row label="Gross P&L" value={inrPaise.format(gross)} className={pnlColorClass(gross)} strong />
          <Row
            label="Net P&L"
            value={net === null ? (charges.error ? "—" : "…") : inrPaise.format(net)}
            className={net === null ? "text-muted-foreground" : pnlColorClass(net)}
          />
          <Row
            label={
              charges.charges ? (
                <button
                  type="button"
                  onClick={() => setShowCharges(true)}
                  aria-haspopup="dialog"
                  className="text-accent underline underline-offset-4 hover:opacity-80 print:text-muted-foreground print:no-underline"
                >
                  Charges &amp; taxes
                </button>
              ) : (
                "Charges & taxes"
              )
            }
            value={total === null ? (charges.error ? "—" : "…") : inrPaise.format(total)}
            className={total === null ? "text-muted-foreground" : ""}
          />
          {charges.error && (
            <p className="pb-1.5 text-xs text-muted-foreground">
              Couldn&apos;t load Upstox&apos;s charges{charges.error === "network_error" ? " - no internet connection" : charges.error === "token_expired" ? " - the token has expired" : ` - ${charges.error}`}.{" "}
              <button type="button" onClick={charges.retry} className="font-medium text-accent hover:underline">
                Try again
              </button>
            </p>
          )}
        </dl>

        <dl className="rounded-lg border border-border bg-card px-4 py-2">
          <Row label="ROI %" value={roiPct === null ? "—" : `${roiPct.toFixed(2)}%`} strong />
          <Row
            label="Profit factor"
            value={profitFactor === null ? (summary.grossProfit > 0 ? "∞" : "—") : profitFactor.toFixed(2)}
            className={profitFactor === null ? "" : pnlColorClass(profitFactor - 1)}
          />
          <Row label="Winning trades (₹)" value={inrPaise.format(summary.grossProfit)} />
          <Row label="Losing trades (₹)" value={inrPaise.format(summary.grossLoss)} />
          <Row label="Winning trades (%)" value={`${summary.winCount}/${summary.totalTrades} (${winPct}%)`} />
        </dl>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-background p-4 sm:p-5">
      <h2 className="text-sm font-medium">Upstox Trade Summary</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        As of {formatDate(from)} – {formatDate(to)} · {UPSTOX_SUMMARY_SCOPE_LABELS[scope]} trades closed in this range, from Upstox&apos;s
        P&amp;L report. Each report row counts as a trade, as Upstox counts them. ROI is gross P&amp;L over the total bought.
      </p>
      <div className="mt-3">{body}</div>

      <AnimatePresence>
        {showCharges && charges.charges && (
          <ChargesDialog
            key="charges"
            charges={charges.charges}
            segment={scope}
            caption={`${UPSTOX_SUMMARY_SCOPE_LABELS[scope]} · ${formatDate(from)} – ${formatDate(to)}`}
            onClose={() => setShowCharges(false)}
          />
        )}
      </AnimatePresence>
    </section>
  );
}
