"use client";

import { useEffect, useState } from "react";

import { ChevronDownIcon, InboxIcon, TrashIcon } from "@/components/icons";
import { formatINR } from "@/lib/format";
import { clearTrades, deleteTrade, getTrades } from "@/lib/tradeStore";
import { INSTRUMENT_LABELS, type TradeWithLegs } from "@/lib/types";

function pnlColorClass(pnl: number): string {
  if (pnl > 0) return "text-profit";
  if (pnl < 0) return "text-loss";
  return "text-foreground";
}

export default function HistoryView() {
  const [trades, setTrades] = useState<TradeWithLegs[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    getTrades().then(setTrades);
  }, []);

  function handleDelete(id: string) {
    setTrades((prev) => (prev ? prev.filter((trade) => trade.id !== id) : prev));
    void deleteTrade(id);
  }

  function handleClearAll() {
    if (!window.confirm("Delete all saved trades from this browser? This can't be undone.")) return;
    setTrades([]);
    void clearTrades();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Saved trades from this browser, newest first.
          </p>
        </div>
        {trades && trades.length > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-loss/40 hover:bg-loss/10 hover:text-loss"
          >
            <TrashIcon className="size-4" />
            Clear All
          </button>
        )}
      </div>

      {trades === null ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-[60px] animate-pulse rounded-xl border border-border bg-card"
            />
          ))}
        </div>
      ) : trades.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <InboxIcon className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No trades saved yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {trades.map((trade) => {
            const isOpen = openId === trade.id;

            return (
              <div
                key={trade.id}
                className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
              >
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setOpenId(isOpen ? null : trade.id)}
                    className="flex flex-1 flex-wrap items-center justify-between gap-2 px-5 py-4 text-left"
                  >
                    <span className="flex flex-wrap items-center gap-3">
                      <span className="font-medium">{INSTRUMENT_LABELS[trade.instrument]}</span>
                      <span className="text-sm text-muted-foreground">
                        {new Date(trade.trade_date).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </span>
                      <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-muted-foreground">
                        {trade.lots} lot{trade.lots === 1 ? "" : "s"} × {trade.lot_size} = Qty{" "}
                        {trade.qty}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span
                        className={`font-mono font-semibold tabular-nums ${pnlColorClass(trade.total_pnl)}`}
                      >
                        {formatINR(trade.total_pnl)}
                      </span>
                      <ChevronDownIcon
                        className={`size-4 shrink-0 text-muted-foreground transition-transform ${
                          isOpen ? "rotate-180" : ""
                        }`}
                      />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(trade.id)}
                    aria-label="Delete trade"
                    className="mr-3 flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-loss/10 hover:text-loss"
                  >
                    <TrashIcon className="size-4" />
                  </button>
                </div>

                {isOpen && (
                  <div className="border-t border-border px-5 py-4">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-muted-foreground">
                          <th className="py-1.5 pr-3 font-medium">Leg</th>
                          <th className="py-1.5 pr-3 font-medium">Buy Price</th>
                          <th className="py-1.5 pr-3 font-medium">Sell Price</th>
                          <th className="py-1.5 font-medium">Net</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trade.legs.map((leg, index) => (
                          <tr key={leg.id} className="border-b border-border last:border-0">
                            <td className="py-1.5 pr-3 text-muted-foreground">{index + 1}</td>
                            <td className="py-1.5 pr-3 font-mono tabular-nums">
                              {leg.buy_price.toFixed(2)}
                            </td>
                            <td className="py-1.5 pr-3 font-mono tabular-nums">
                              {leg.sell_price.toFixed(2)}
                            </td>
                            <td className="py-1.5 font-mono tabular-nums">{leg.net.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-3 text-sm text-muted-foreground">
                      Total Net:{" "}
                      <span className="font-mono tabular-nums text-foreground">
                        {trade.total_net.toFixed(2)}
                      </span>
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
