"use client";

import { PlusIcon, TrashIcon } from "@/components/icons";

export type LegRow = {
  key: number;
  sellPrice: string;
  buyPrice: string;
};

let nextLegKey = 0;
export function newLeg(): LegRow {
  return { key: nextLegKey++, sellPrice: "", buyPrice: "" };
}

export function toNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

const inputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-accent focus:ring-2 focus:ring-accent/30";

type LegsTableProps = {
  legs: LegRow[];
  onLegChange: (key: number, field: "sellPrice" | "buyPrice", value: string) => void;
  onAddLeg: () => void;
  onRemoveLeg: (key: number) => void;
};

export default function LegsTable({ legs, onLegChange, onAddLeg, onRemoveLeg }: LegsTableProps) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50 text-left text-muted-foreground">
              <th className="w-10 py-3 pl-5 pr-2 font-medium">#</th>
              <th className="px-2 py-3 font-medium">Sell Price</th>
              <th className="px-2 py-3 font-medium">Buy Price</th>
              <th className="px-2 py-3 text-right font-medium">Net</th>
              <th className="w-12 py-3 pr-4" />
            </tr>
          </thead>
          <tbody>
            {legs.map((leg, index) => {
              const net = toNumber(leg.sellPrice) - toNumber(leg.buyPrice);
              const legSign = net > 0 ? "profit" : net < 0 ? "loss" : null;
              return (
                <tr key={leg.key} className="border-b border-border last:border-0 hover:bg-muted/30">
                  <td className="py-2.5 pl-5 pr-2 text-muted-foreground">{index + 1}</td>
                  <td className="px-2 py-2.5">
                    <input
                      type="number"
                      step="0.05"
                      inputMode="decimal"
                      value={leg.sellPrice}
                      onChange={(e) => onLegChange(leg.key, "sellPrice", e.target.value)}
                      placeholder="0.00"
                      className={`${inputClass} max-w-32 font-mono tabular-nums`}
                    />
                  </td>
                  <td className="px-2 py-2.5">
                    <input
                      type="number"
                      step="0.05"
                      inputMode="decimal"
                      value={leg.buyPrice}
                      onChange={(e) => onLegChange(leg.key, "buyPrice", e.target.value)}
                      placeholder="0.00"
                      className={`${inputClass} max-w-32 font-mono tabular-nums`}
                    />
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    <span
                      className={`inline-block min-w-20 rounded-md px-2 py-1 font-mono text-sm font-medium tabular-nums ${
                        legSign === "profit"
                          ? "bg-profit/10 text-profit"
                          : legSign === "loss"
                            ? "bg-loss/10 text-loss"
                            : "text-muted-foreground"
                      }`}
                    >
                      {net.toFixed(2)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-4 text-center">
                    <button
                      type="button"
                      onClick={() => onRemoveLeg(leg.key)}
                      disabled={legs.length === 1}
                      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-loss/10 hover:text-loss disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent"
                      aria-label={`Remove leg ${index + 1}`}
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={onAddLeg}
        className="flex w-full items-center justify-center gap-1.5 border-t border-dashed border-border py-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground"
      >
        <PlusIcon className="size-4" />
        Add Leg
      </button>
    </section>
  );
}
