"use client";

/**
 * "Sync Upstox" for Trade Entries (and Reports, which reads the same table):
 * pulls one financial year of closed trades from Upstox's P&L report, shows
 * what that would change in the journal — trades it doesn't have yet,
 * entries whose dates/prices/etc. differ from Upstox's, and entries Upstox has
 * no record of — and only writes once confirmed. The last group is only
 * deleted if ticked, since an entry Upstox doesn't know about could be from
 * another account.
 */

import { motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { XIcon } from "@/components/icons";
import LoadingState from "@/components/LoadingState";
import Select from "@/components/Select";
import { formatINR, pnlColorClass } from "@/lib/format";
import { showToast } from "@/lib/toast";
import {
  applyUpstoxTrades,
  describeEntryContract,
  getCachedTradeEntries,
  getTradeEntries,
  type TradeEntry,
  type TradeEntrySide,
  type UpstoxTradeWrite,
} from "@/lib/tradeEntriesStore";
import { fetchPnlReport } from "@/lib/upstox/client";
import { isUpstoxPnlReportError, type UpstoxPnlReportResult } from "@/lib/upstox/types";
import { planTradeImport } from "@/lib/upstoxSync";

function todayISODate(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

/** Indian financial years run April to March — the year this one started in. */
function currentFyStart(): number {
  const now = new Date();
  return now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
}

function fyLabel(start: number): string {
  return `FY ${start}-${String(start + 1).slice(2)}`;
}

function formatShortDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

type LineProps = {
  contract: string;
  expiry: string | null;
  side: TradeEntrySide;
  lots: number;
  entryDate: string;
  closingDate: string | null;
  buyPrice: number;
  sellPrice: number;
  pnl: number;
  note?: string;
};

function TradeLine({ contract, expiry, side, lots, entryDate, closingDate, buyPrice, sellPrice, pnl, note }: LineProps) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm">
      <span
        className={`flex size-6 shrink-0 items-center justify-center rounded text-xs font-bold ${
          side === "buy" ? "bg-info/20 text-info" : "bg-danger-fg/15 text-danger-fg"
        }`}
      >
        {side === "buy" ? "B" : "S"}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium">{contract}</span>
        {expiry && <span className="text-muted-foreground"> · exp {formatShortDate(expiry)}</span>}
        <span className="block text-xs text-muted-foreground">
          {formatShortDate(entryDate)}
          {closingDate ? ` → ${formatShortDate(closingDate)}` : ""} · {lots} lot{lots === 1 ? "" : "s"} · {buyPrice.toFixed(2)} /{" "}
          {sellPrice.toFixed(2)}
          {note && <span className="text-accent"> · {note}</span>}
        </span>
      </span>
      <span className={`shrink-0 font-mono text-sm font-medium tabular-nums ${pnlColorClass(pnl)}`}>{formatINR(pnl)}</span>
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

export default function UpstoxTradeSyncModal({ onClose }: { onClose: () => void }) {
  const [fy, setFy] = useState(currentFyStart);
  const [report, setReport] = useState<UpstoxPnlReportResult | null>(null);
  const [entries, setEntries] = useState<TradeEntry[] | null>(getCachedTradeEntries);
  const [entriesFailed, setEntriesFailed] = useState(false);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [applying, setApplying] = useState(false);

  const fyOptions = useMemo(() => {
    const start = currentFyStart();
    return [0, 1, 2].map((back) => ({ value: String(start - back), label: fyLabel(start - back) }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    getTradeEntries()
      .then((rows) => {
        if (!cancelled) setEntries(rows);
      })
      .catch(() => {
        if (!cancelled) setEntriesFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchPnlReport(fy).then((result) => {
      if (!cancelled) setReport(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fy]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function changeFy(value: string) {
    setFy(Number(value));
    setReport(null);
    setRemoveMissing(false);
  }

  const reportOk = report && !isUpstoxPnlReportError(report) ? report : null;
  const plan = useMemo(
    () => (reportOk && entries ? planTradeImport(entries, reportOk, todayISODate()) : null),
    [reportOk, entries],
  );

  const newItems = plan?.items.filter((i) => i.kind === "new") ?? [];
  const updateItems = plan?.items.flatMap((i) => (i.kind === "update" ? [i] : [])) ?? [];
  const sameCount = plan?.items.filter((i) => i.kind === "same").length ?? 0;
  const missing = plan?.missing ?? [];
  // The whole report's figure, not just the importable trades' — charges cover every row too, so Net P&L stays like for like.
  const grossPnl = reportOk?.grossPnl ?? 0;
  const changeCount = newItems.length + updateItems.length + (removeMissing ? missing.length : 0);

  async function handleApply() {
    if (!plan) return;
    setApplying(true);
    try {
      const writes = plan.items.flatMap<UpstoxTradeWrite>((i) =>
        i.kind === "new" ? [{ trade: i.trade, entry: null }] : i.kind === "update" ? [{ trade: i.trade, entry: i.entry }] : [],
      );
      const result = await applyUpstoxTrades(writes, removeMissing ? missing.map((e) => e.id) : []);
      const parts = [
        result.added > 0 && `${result.added} added`,
        result.updated > 0 && `${result.updated} corrected`,
        result.removed > 0 && `${result.removed} removed`,
      ].filter(Boolean);
      showToast(`Synced ${fyLabel(fy)} from Upstox — ${parts.join(", ")}.`, "success");
      onClose();
    } catch {
      showToast("Couldn't save the synced trades. Try again.");
      setApplying(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      className="glass-backdrop fixed inset-0 z-[300] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: 0.12, ease: "easeIn" } }}
        transition={{ duration: 0.18, ease: "easeOut" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Sync trades from Upstox"
        className="glass-panel flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-lg font-semibold tracking-tight">Sync from Upstox</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-36">
              <Select value={String(fy)} onChange={changeFy} options={fyOptions} />
            </div>
            <p className="flex-1 text-xs text-muted-foreground">
              From Upstox&apos;s P&amp;L report. A day&apos;s trades show up there from the next day.
            </p>
          </div>

          {report === null || (entries === null && !entriesFailed) ? (
            <LoadingState className="h-40" label="Fetching your P&L report from Upstox…" />
          ) : isUpstoxPnlReportError(report) ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {report.error === "token_expired" ? (
                <>
                  Your Upstox token has expired.{" "}
                  <Link href="/settings" className="font-medium text-accent hover:underline">
                    Add today&apos;s token
                  </Link>{" "}
                  and try again.
                </>
              ) : report.error === "network_error" ? (
                "No internet connection. Try again once you're back online."
              ) : (
                `Couldn't load the report — ${report.error}`
              )}
            </p>
          ) : !plan ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Couldn&apos;t load your trade entries. Check your connection and try again.
            </p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-border bg-background p-3">
                  <dt className="text-xs text-muted-foreground">Upstox P&amp;L</dt>
                  <dd className={`mt-1 font-mono text-lg font-semibold tabular-nums ${pnlColorClass(grossPnl)}`}>
                    {formatINR(grossPnl)}
                  </dd>
                </div>
                <div className="rounded-xl border border-border bg-background p-3">
                  <dt className="text-xs text-muted-foreground">Charges</dt>
                  <dd className="mt-1 font-mono text-lg font-semibold tabular-nums">
                    {reportOk?.charges == null ? "—" : formatINR(reportOk.charges.total)}
                  </dd>
                </div>
                <div className="rounded-xl border border-border bg-background p-3">
                  <dt className="text-xs text-muted-foreground">Net P&amp;L</dt>
                  <dd
                    className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                      reportOk?.charges == null ? "" : pnlColorClass(grossPnl - reportOk.charges.total)
                    }`}
                  >
                    {reportOk?.charges == null ? "—" : formatINR(grossPnl - reportOk.charges.total)}
                  </dd>
                </div>
              </dl>

              <p className="text-sm text-muted-foreground">
                {reportOk?.trades.length ?? 0} closed trade{reportOk?.trades.length === 1 ? "" : "s"} on Upstox ·{" "}
                {sameCount} already in your journal as-is
                {reportOk && reportOk.otherCount > 0 && (
                  <>
                    {" "}
                    · {reportOk.otherCount} in other underlyings left out ({reportOk.otherNames.join(", ")})
                  </>
                )}
              </p>

              {newItems.length > 0 && (
                <Section title={`New — ${newItems.length}`}>
                  <ul className="flex flex-col gap-1.5">
                    {newItems.map(({ trade }) => (
                      <TradeLine
                        key={trade.key}
                        contract={describeEntryContract({
                          instrument: trade.instrument,
                          strike_price: trade.strike,
                          option_type: trade.optionType,
                        })}
                        expiry={trade.expiry}
                        side={trade.side}
                        lots={trade.lots}
                        entryDate={trade.entryDate}
                        closingDate={trade.closingDate}
                        buyPrice={trade.buyPrice}
                        sellPrice={trade.sellPrice}
                        pnl={trade.pnl}
                      />
                    ))}
                  </ul>
                </Section>
              )}

              {updateItems.length > 0 && (
                <Section title={`Corrected to match Upstox — ${updateItems.length}`}>
                  <ul className="flex flex-col gap-1.5">
                    {updateItems.map(({ trade, changes }) => (
                      <TradeLine
                        key={trade.key}
                        contract={describeEntryContract({
                          instrument: trade.instrument,
                          strike_price: trade.strike,
                          option_type: trade.optionType,
                        })}
                        expiry={trade.expiry}
                        side={trade.side}
                        lots={trade.lots}
                        entryDate={trade.entryDate}
                        closingDate={trade.closingDate}
                        buyPrice={trade.buyPrice}
                        sellPrice={trade.sellPrice}
                        pnl={trade.pnl}
                        note={`fixes ${changes.join(", ")}`}
                      />
                    ))}
                  </ul>
                </Section>
              )}

              {missing.length > 0 && (
                <Section title={`In your journal, not on Upstox — ${missing.length}`}>
                  <label className="flex cursor-pointer items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={removeMissing}
                      onChange={(e) => setRemoveMissing(e.target.checked)}
                      className="mt-0.5 size-4 accent-accent"
                    />
                    <span>
                      Delete these entries
                      <span className="block text-xs text-muted-foreground">
                        Leave unticked if they&apos;re from another account. Otherwise they double-count in Reports.
                      </span>
                    </span>
                  </label>
                  <ul className={`flex flex-col gap-1.5 ${removeMissing ? "opacity-60 line-through" : ""}`}>
                    {missing.map((e) => (
                      <TradeLine
                        key={e.id}
                        contract={describeEntryContract(e)}
                        expiry={e.expiry_date}
                        side={e.side}
                        lots={e.lots}
                        entryDate={e.entry_date}
                        closingDate={e.closing_date}
                        buyPrice={Number(e.buy_price)}
                        sellPrice={Number(e.sell_price)}
                        pnl={Number(e.pnl)}
                      />
                    ))}
                  </ul>
                </Section>
              )}

              {newItems.length === 0 && updateItems.length === 0 && missing.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Your journal already matches Upstox for {fyLabel(fy)}.
                </p>
              )}
            </>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:scale-95"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!plan || changeCount === 0 || applying}
            onClick={handleApply}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-foreground transition-opacity hover:opacity-90 disabled:opacity-50 active:scale-95"
          >
            {applying ? "Syncing…" : changeCount === 0 ? "Nothing to sync" : `Apply ${changeCount} change${changeCount === 1 ? "" : "s"}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
