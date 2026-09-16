"use client";

import { AnimatePresence, motion } from "framer-motion";

import DatePicker from "@/components/DatePicker";
import { PencilIcon, TrashIcon } from "@/components/icons";
import { needsExpiryOnly, type PortfolioRow } from "@/lib/calculatePortfolio";
import { formatINR, pnlColorClass } from "@/lib/format";
import { describeEntryContract, type TradeEntrySide } from "@/lib/tradeEntriesStore";
import type { TradeEntry } from "@/lib/types";

const tableHeadClass = "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground";
const badgeClass = "rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground";

const SIDE_LABELS: Record<TradeEntrySide, string> = {
  buy: "Buy",
  sell: "Sell",
};

function formatCellDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function formatGreek(value: number | null, decimals: number): string {
  return value == null ? "—" : value.toFixed(decimals);
}

function formatOi(value: number | null): string {
  return value == null ? "—" : value.toLocaleString("en-IN");
}

type LiveEntriesTableProps = {
  /** Non-empty — caller handles the loading/empty states before rendering this. */
  rows: PortfolioRow[];
  onSetExpiry: (entryId: string, expiryDate: string) => void;
  /** Omit to hide the Edit/Delete column entirely — Paper Trade's open positions don't offer it (only its Closed table does). */
  onEdit?: (entry: TradeEntry) => void;
  onDelete?: (entry: TradeEntry) => void;
};

/**
 * The live-priced positions table shared by Live Portfolio and Paper Trade:
 * one row per open entry (Date/Instrument/Expiry/Side/Lots/Entry Price, then
 * whichever of loading/error/no-match/live-data applies), plus a Cumulative
 * and Average footer row across every row with live data.
 */
export default function LiveEntriesTable({ rows, onSetExpiry, onEdit, onDelete }: LiveEntriesTableProps) {
  const showActions = Boolean(onEdit || onDelete);
  const liveRows = rows.filter((row) => row.status === "ok");
  const totals =
    liveRows.length === 0
      ? null
      : liveRows.reduce(
          (acc, row) => {
            const buyPrice = row.entry.side === "sell" ? row.liveLtp! : row.entryPrice;
            const sellPrice = row.entry.side === "sell" ? row.entryPrice : row.liveLtp!;
            return {
              lots: acc.lots + row.entry.lots,
              buyPrice: acc.buyPrice + buyPrice,
              sellPrice: acc.sellPrice + sellPrice,
              livePnl: acc.livePnl + (row.livePnl ?? 0),
              delta: acc.delta + (row.delta ?? 0),
              gamma: acc.gamma + (row.gamma ?? 0),
              theta: acc.theta + (row.theta ?? 0),
              brokerage: acc.brokerage + (row.brokerageIfClosed ?? 0),
              count: acc.count + 1,
            };
          },
          { lots: 0, buyPrice: 0, sellPrice: 0, livePnl: 0, delta: 0, gamma: 0, theta: 0, brokerage: 0, count: 0 },
        );
  const averages =
    totals === null
      ? null
      : {
          buyPrice: totals.buyPrice / totals.count,
          sellPrice: totals.sellPrice / totals.count,
          delta: totals.delta / totals.count,
          gamma: totals.gamma / totals.count,
          theta: totals.theta / totals.count,
          brokerage: totals.brokerage / totals.count,
        };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className={`w-full border-collapse text-sm ${showActions ? "min-w-[1180px]" : "min-w-[1080px]"}`}>
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left">
              <th className={`${tableHeadClass} py-3 pl-5 pr-2`}>Date</th>
              <th className={`${tableHeadClass} px-2 py-3`}>Instrument</th>
              <th className={`${tableHeadClass} px-2 py-3`}>Expiry</th>
              <th className={`${tableHeadClass} px-2 py-3`}>Side</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Lots</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Entry Price</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Live LTP</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Live P&amp;L</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Delta</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Gamma</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Theta</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Vega</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>OI</th>
              <th className={`${tableHeadClass} px-2 py-3 pr-5 text-right`}>Brokerage if Closed</th>
              {showActions && <th className="w-20 py-3 pr-4" />}
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
                    className="border-b border-border last:border-0 hover:bg-muted/30"
                  >
                    <td className="whitespace-nowrap py-2.5 pl-5 pr-2 text-muted-foreground">
                      {formatCellDate(entry.entry_date)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2.5 font-medium">{describeEntryContract(entry)}</td>
                    <td className="px-2 py-2.5">
                      <DatePicker
                        value={entry.expiry_date ?? ""}
                        onChange={(date) => onSetExpiry(entry.id, date)}
                        triggerClassName={
                          entry.expiry_date
                            ? "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
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
                      <td colSpan={8} className="px-2 py-2.5 text-center">
                        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
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
                      <td colSpan={8} className="px-2 py-2.5 text-center">
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
                      <td colSpan={8} className="px-2 py-2.5 text-center">
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
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {formatGreek(row.delta, 3)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {formatGreek(row.gamma, 4)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {formatGreek(row.theta, 2)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {formatGreek(row.vega, 2)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                          {formatOi(row.oi)}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 pr-5 text-right font-mono tabular-nums text-muted-foreground">
                          {row.brokerageIfClosed == null ? "—" : formatINR(row.brokerageIfClosed)}
                        </td>
                      </>
                    )}
                    {showActions && (
                      <td className="py-2.5 pr-4">
                        <div className="flex items-center justify-end gap-1">
                          {onEdit && (
                            <button
                              type="button"
                              onClick={() => onEdit(entry)}
                              aria-label="Edit position"
                              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent active:scale-90"
                            >
                              <PencilIcon className="size-4" />
                            </button>
                          )}
                          {onDelete && (
                            <button
                              type="button"
                              onClick={() => onDelete(entry)}
                              aria-label="Delete position"
                              className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-loss/10 hover:text-loss active:scale-90"
                            >
                              <TrashIcon className="size-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    )}
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
          {totals && averages && (
            <tfoot>
              <tr className="border-t border-border bg-muted/50 font-semibold">
                <td colSpan={4} className="whitespace-nowrap py-2.5 pl-5 pr-2">
                  Cumulative
                </td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums">{totals.lots}</td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {totals.buyPrice.toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {totals.sellPrice.toFixed(2)}
                </td>
                <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${pnlColorClass(totals.livePnl)}`}>
                  {formatINR(totals.livePnl)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {formatGreek(totals.delta, 3)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {formatGreek(totals.gamma, 4)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {formatGreek(totals.theta, 2)}
                </td>
                <td className="px-2 py-2.5" />
                <td className="px-2 py-2.5" />
                <td className="whitespace-nowrap px-2 py-2.5 pr-5 text-right font-mono tabular-nums">
                  {formatINR(totals.brokerage)}
                </td>
                {showActions && <td className="px-2 py-2.5" />}
              </tr>
              <tr className="border-t border-border bg-muted/30 text-muted-foreground">
                <td colSpan={5} className="whitespace-nowrap py-2.5 pl-5 pr-2 italic">
                  Average
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {averages.buyPrice.toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {averages.sellPrice.toFixed(2)}
                </td>
                <td className="px-2 py-2.5" />
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {formatGreek(averages.delta, 3)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {formatGreek(averages.gamma, 4)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {formatGreek(averages.theta, 2)}
                </td>
                <td className="px-2 py-2.5" />
                <td className="px-2 py-2.5" />
                <td className="whitespace-nowrap px-2 py-2.5 pr-5 text-right font-mono tabular-nums">
                  {formatINR(averages.brokerage)}
                </td>
                {showActions && <td className="px-2 py-2.5" />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
