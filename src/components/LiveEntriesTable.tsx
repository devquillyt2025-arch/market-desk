"use client";

import { AnimatePresence, motion } from "framer-motion";

import DatePicker from "@/components/DatePicker";
import { needsExpiryOnly, type PortfolioRow } from "@/lib/calculatePortfolio";
import { formatINR, pnlColorClass } from "@/lib/format";
import { describeEntryContract, type TradeEntrySide } from "@/lib/tradeEntriesStore";

const tableHeadClass = "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const badgeClass = "rounded-full border border-border bg-background px-2.5 py-1 font-mono text-xs text-muted-foreground";

const SIDE_LABELS: Record<TradeEntrySide, string> = {
  buy: "Buy",
  sell: "Sell",
};

function formatCellDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

type LiveEntriesTableProps = {
  /** Non-empty — caller handles the loading/empty states before rendering this. */
  rows: PortfolioRow[];
  onSetExpiry: (entryId: string, expiryDate: string) => void;
  /**
   * Clicking anywhere on a row opens the edit form — the whole row (not just
   * its entry) so the caller can forward Greeks/OI into the modal, since
   * this table no longer shows them itself.
   */
  onRowClick: (row: PortfolioRow) => void;
};

/**
 * The live-priced positions table shared by Live Portfolio and Paper Trade:
 * one row per open entry (Date/Instrument/Expiry/Side/Lots/Entry Price/Live
 * LTP/Live P&L/Brokerage if Closed), plus a Total footer row across
 * every row with live data. Delta/Gamma/Theta/Vega/OI aren't shown here —
 * they're still computed per row and available in the edit popup.
 */
export default function LiveEntriesTable({ rows, onSetExpiry, onRowClick }: LiveEntriesTableProps) {
  const liveRows = rows.filter((row) => row.status === "ok");
  // Plain column sums. Lots counts every row so it matches the column above
  // it; the price, P&L and brokerage sums need a live price, so they only
  // cover rows that have one. Each price column adds up its own values —
  // Entry Price the entry prices, Live LTP the live prices — regardless of
  // which side (buy/sell) each row was opened on.
  const totalLots = rows.reduce((acc, row) => acc + row.entry.lots, 0);
  const totals =
    liveRows.length === 0
      ? null
      : liveRows.reduce(
          (acc, row) => ({
            entryPrice: acc.entryPrice + row.entryPrice,
            liveLtp: acc.liveLtp + (row.liveLtp ?? 0),
            livePnl: acc.livePnl + (row.livePnl ?? 0),
            brokerage: acc.brokerage + (row.brokerageIfClosed ?? 0),
          }),
          { entryPrice: 0, liveLtp: 0, livePnl: 0, brokerage: 0 },
        );

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className={`${tableHeadClass} py-3 pl-5 pr-2`}>Date</th>
              <th className={`${tableHeadClass} px-2 py-3`}>Instrument</th>
              <th className={`${tableHeadClass} px-2 py-3`}>Expiry</th>
              <th className={`${tableHeadClass} px-2 py-3`}>Side</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Lots</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Entry Price</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Live LTP</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Live P&amp;L</th>
              <th className={`${tableHeadClass} px-2 py-3 pr-5 text-right`}>Brokerage if Closed</th>
            </tr>
          </thead>
          <tbody>
            <AnimatePresence initial={false}>
              {rows.map((row) => {
                const { entry } = row;
                return (
                  <motion.tr
                    key={entry.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    onClick={() => onRowClick(row)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="whitespace-nowrap py-2.5 pl-5 pr-2 text-muted-foreground">
                      {formatCellDate(entry.entry_date)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 font-medium">{describeEntryContract(entry)}</td>
                    <td className="px-2 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <DatePicker
                        value={entry.expiry_date ?? ""}
                        onChange={(date) => onSetExpiry(entry.id, date)}
                        triggerClassName={
                          entry.expiry_date
                            ? "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-card px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
                            : "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-dashed border-accent/40 bg-accent/5 px-2.5 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent/10"
                        }
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <span className={badgeClass}>{SIDE_LABELS[entry.side]}</span>
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{entry.lots}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                      {row.entryPrice.toFixed(2)}
                    </td>

                    {row.status === "untracked" ? (
                      <td colSpan={3} className="px-2 py-2.5 text-center">
                        <span className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          {needsExpiryOnly(entry)
                            ? "Set the expiry to start tracking"
                            : "Add strike/CE-PE in Trade Entries"}
                        </span>
                      </td>
                    ) : row.status === "error" ? (
                      // token_expired/network_error already have their own
                      // banner above, so this stays short for those and
                      // only surfaces the raw message for anything else —
                      // e.g. Upstox itself returning a 429/500, or the
                      // server failing to read the saved token. Without
                      // this branch the row silently fell through to the
                      // "ok" cells with every value null, indistinguishable
                      // from no_match and with no explanation at all.
                      <td colSpan={3} className="px-2 py-2.5 text-center">
                        <span className="whitespace-nowrap rounded-full bg-loss/10 px-2.5 py-1 text-xs font-medium text-loss">
                          {row.errorMessage === "token_expired"
                            ? "Paused — token expired"
                            : row.errorMessage === "network_error"
                              ? "Paused — no connection"
                              : `Couldn't load live data${row.errorMessage ? `: ${row.errorMessage}` : ""}`}
                        </span>
                      </td>
                    ) : row.status === "no_match" ? (
                      // The chain fetch itself succeeded (a real response
                      // came back), but this exact strike wasn't in it —
                      // by far the most common cause is an expiry that
                      // isn't an actual trading date, so offer to fix it
                      // right here rather than a silent dash.
                      <td colSpan={3} className="px-2 py-2.5 text-center">
                        <span className="whitespace-nowrap rounded-full bg-loss/10 px-2.5 py-1 text-xs font-medium text-loss">
                          No live data for {entry.expiry_date} — check the expiry
                        </span>
                      </td>
                    ) : (
                      <>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                          {row.liveLtp == null ? "—" : row.liveLtp.toFixed(2)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-2 py-2.5 text-right font-mono font-medium tabular-nums ${
                            row.livePnl == null ? "text-muted-foreground" : pnlColorClass(row.livePnl)
                          }`}
                        >
                          {row.livePnl == null ? "—" : formatINR(row.livePnl)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 pr-5 text-right font-mono tabular-nums text-muted-foreground">
                          {row.brokerageIfClosed == null ? "—" : formatINR(row.brokerageIfClosed)}
                        </td>
                      </>
                    )}
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
          {totals && (
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td colSpan={4} className="whitespace-nowrap py-2.5 pl-5 pr-2">
                  Total
                </td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums">{totalLots}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {totals.entryPrice.toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {totals.liveLtp.toFixed(2)}
                </td>
                <td
                  className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${pnlColorClass(totals.livePnl)}`}
                >
                  {formatINR(totals.livePnl)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 pr-5 text-right font-mono tabular-nums">
                  {formatINR(totals.brokerage)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {liveRows.length > 0 && liveRows.length < rows.length && (
        <p className="border-t border-border px-5 py-2 text-xs text-muted-foreground">
          Price, P&amp;L and brokerage totals cover the {liveRows.length} of {rows.length} positions with live data.
        </p>
      )}
    </section>
  );
}
