"use client";

import { calculateBrokerage } from "@/lib/calculateBrokerage";
import { round2 } from "@/lib/calculateTrade";
import { formatINR, pnlColorClass } from "@/lib/format";
import { describeEntryContract } from "@/lib/tradeEntriesStore";
import type { UpstoxPosition } from "@/lib/upstox/types";

const tableHeadClass = "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground";

function formatCellDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function average(value: number, quantity: number): number | null {
  return quantity > 0 ? round2(value / quantity) : null;
}

type ClosedTodayTableProps = {
  /** Today's Upstox positions that are flat again — caller filters to quantity 0. Non-empty. */
  positions: UpstoxPosition[];
};

/**
 * Positions squared off today, the way Upstox's own positions screen keeps
 * listing them until the day ends: what was bought and sold (carried-in
 * quantity included), the contract's LTP, and the realised result. These
 * never become Live Portfolio rows — they're straight from the latest sync —
 * and they drop off once Upstox stops reporting them the next day.
 */
export default function ClosedTodayTable({ positions }: ClosedTodayTableProps) {
  const rows = positions.map((p) => {
    const buyAvg = average(p.buyValue, p.buyQuantity);
    const sellAvg = average(p.sellValue, p.sellQuantity);
    const charges =
      buyAvg != null && sellAvg != null
        ? calculateBrokerage("OPTIONS", [{ buyPrice: buyAvg, sellPrice: sellAvg }], p.buyQuantity).totalCharges
        : null;
    return { p, buyAvg, sellAvg, pnl: round2(p.sellValue - p.buyValue), charges };
  });
  const totalPnl = rows.reduce((sum, r) => sum + r.pnl, 0);
  const totalCharges = rows.reduce((sum, r) => sum + (r.charges ?? 0), 0);

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-background">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              <th className={`${tableHeadClass} py-3 pl-5 pr-2`}>Instrument</th>
              <th className={`${tableHeadClass} px-2 py-3`}>Expiry</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Lots</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Buy Avg</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Sell Avg</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>LTP</th>
              <th className={`${tableHeadClass} px-2 py-3 text-right`}>Realised P&amp;L</th>
              <th className={`${tableHeadClass} px-2 py-3 pr-5 text-right`}>Charges (est.)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, buyAvg, sellAvg, pnl, charges }) => (
              <tr key={p.instrumentKey} className="border-b border-border last:border-0">
                <td className="whitespace-nowrap py-2.5 pl-5 pr-2 font-medium">
                  {describeEntryContract({ instrument: p.instrument, strike_price: p.strike, option_type: p.optionType })}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">{formatCellDate(p.expiry)}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums" title={`${p.buyQuantity} qty`}>
                  {round2(p.buyQuantity / p.lotSize)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                  {buyAvg == null ? "—" : buyAvg.toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
                  {sellAvg == null ? "—" : sellAvg.toFixed(2)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums">
                  {p.lastPrice == null ? "—" : p.lastPrice.toFixed(2)}
                </td>
                <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono font-medium tabular-nums ${pnlColorClass(pnl)}`}>
                  {formatINR(pnl)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 pr-5 text-right font-mono tabular-nums text-muted-foreground">
                  {charges == null ? "—" : formatINR(charges)}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td colSpan={6} className="whitespace-nowrap py-2.5 pl-5 pr-2">
                  Total
                </td>
                <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${pnlColorClass(totalPnl)}`}>
                  {formatINR(totalPnl)}
                </td>
                <td className="whitespace-nowrap px-2 py-2.5 pr-5 text-right font-mono tabular-nums">
                  {formatINR(totalCharges)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
