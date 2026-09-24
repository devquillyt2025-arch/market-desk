"use client";

import type { ReactNode } from "react";

import { AlertCircleIcon, CheckCircleIcon } from "@/components/icons";
import type { PositionRisk, RiskAnalysis, RiskSeverity, RiskVerdict } from "@/lib/calculateRisk";
import { formatINR, pnlColorClass } from "@/lib/format";

const tableHeadClass = "whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground";

const VERDICT_STYLES: Record<RiskVerdict, { label: string; pill: string }> = {
  high: { label: "High risk", pill: "bg-loss/10 text-loss" },
  elevated: { label: "Elevated", pill: "bg-warning/10 text-warning" },
  comfortable: { label: "Comfortable", pill: "bg-profit/10 text-profit" },
};

const SEVERITY_STYLES: Record<RiskSeverity, { label: string; box: string; text: string; dot: string }> = {
  critical: { label: "Critical", box: "border-loss/30 bg-loss/5", text: "text-loss", dot: "bg-loss" },
  warning: { label: "Warning", box: "border-warning/30 bg-warning/5", text: "text-warning", dot: "bg-warning" },
  info: { label: "Note", box: "border-border bg-muted/30", text: "text-muted-foreground", dot: "bg-muted-foreground" },
};

function formatExpiry(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short" });
}

function formatDte(dte: number): string {
  if (dte < 0) return "Expired";
  if (dte === 0) return "Today";
  return `${dte}d`;
}

function dteColorClass(dte: number): string {
  if (dte <= 0) return "text-loss";
  if (dte <= 2) return "text-warning";
  return "text-foreground";
}

function popColorClass(pop: number): string {
  if (pop >= 0.5) return "text-profit";
  if (pop < 0.3) return "text-loss";
  return "text-warning";
}

function popBarClass(pop: number): string {
  if (pop >= 0.5) return "bg-profit";
  if (pop < 0.3) return "bg-loss";
  return "bg-warning";
}

function formatPop(pop: number): string {
  return pop > 0 && pop < 0.01 ? "<1%" : `${Math.round(pop * 100)}%`;
}

function signedPct(v: number, decimals = 1): string {
  return `${v > 0 ? "+" : ""}${v.toFixed(decimals)}%`;
}

function Tile({
  label,
  value,
  hint,
  valueClass = "text-foreground",
  children,
}: {
  label: string;
  value: string;
  hint: string;
  valueClass?: string;
  children?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-background p-4">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-1 font-mono text-xl font-semibold tabular-nums ${valueClass}`}>{value}</dd>
      {children}
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </section>
  );
}

function PositionRow({ p }: { p: PositionRisk }) {
  const { entry } = p.row;
  const isShort = entry.side === "sell";
  const itmLabel = p.itmPct > 0 ? `ITM ${p.itmPct.toFixed(1)}%` : `OTM ${Math.abs(p.itmPct).toFixed(1)}%`;
  const itmClass = p.itmPct > 0 ? (isShort ? "text-loss" : "text-profit") : "text-muted-foreground";

  return (
    <tr className="border-b border-border last:border-0">
      <td className="whitespace-nowrap py-2.5 pl-5 pr-2 font-medium">
        <span className="flex items-center gap-2">
          <span
            className={`size-2 shrink-0 rounded-full ${p.flag ? SEVERITY_STYLES[p.flag].dot : "bg-profit/60"}`}
            title={p.flag ? SEVERITY_STYLES[p.flag].label : "No warnings"}
          />
          {p.contract}
        </span>
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">
        {isShort ? "Sell" : p.isHedge ? "Buy · hedge" : "Buy"}
      </td>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${dteColorClass(p.dte)}`}>
        {formatDte(p.dte)}
      </td>
      <td className="px-2 py-2.5">
        <div className="ml-auto flex w-32 items-center justify-end gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <span
              className={`block h-full rounded-full ${popBarClass(p.pop)}`}
              style={{ width: `${Math.round(p.pop * 100)}%` }}
            />
          </span>
          <span className={`w-10 text-right font-mono tabular-nums ${popColorClass(p.pop)}`}>
            {formatPop(p.pop)}
          </span>
        </div>
      </td>
      <td className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${itmClass}`}>{itmLabel}</td>
      <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
        {p.breakeven.toFixed(0)} <span className="text-xs">({signedPct(p.breakevenMovePct)})</span>
      </td>
      <td className="whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums text-muted-foreground">
        ±{p.expectedMovePct.toFixed(1)}%
      </td>
      <td
        className={`whitespace-nowrap px-2 py-2.5 text-right font-mono tabular-nums ${p.maxLoss === null ? "text-loss" : ""}`}
      >
        {p.maxLoss === null ? "Unlimited" : formatINR(p.maxLoss)}
      </td>
      <td
        className={`whitespace-nowrap px-2 py-2.5 pr-5 text-right font-mono tabular-nums ${
          p.thetaPerDay == null ? "text-muted-foreground" : pnlColorClass(p.thetaPerDay)
        }`}
      >
        {p.thetaPerDay == null ? "—" : formatINR(p.thetaPerDay)}
      </td>
    </tr>
  );
}

type RiskProbabilityPanelProps = {
  /** null while there's nothing live-priced to analyse yet. */
  analysis: RiskAnalysis | null;
  asOf: number | null;
};

/**
 * Live Portfolio's read on "how bad can this get, how likely is it, and what
 * should worry me right now" — a verdict, the headline risk/reward numbers,
 * a ranked list of warning signs, and a per-position breakdown. All numbers
 * come from calculateRisk.ts (market-implied, at expiry, before brokerage).
 */
export default function RiskProbabilityPanel({ analysis, asOf }: RiskProbabilityPanelProps) {
  if (!analysis) {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Risk &amp; Probability</h2>
        <div className="rounded-xl border border-dashed border-border bg-background p-6 text-center text-sm text-muted-foreground">
          Waiting for live prices and IV — the risk read appears as soon as your positions are priced.
        </div>
      </div>
    );
  }

  const verdict = VERDICT_STYLES[analysis.verdict];
  const critical = analysis.warnings.filter((w) => w.severity === "critical").length;
  const warning = analysis.warnings.filter((w) => w.severity === "warning").length;
  const riskPerReward = analysis.rewardToRisk && analysis.rewardToRisk > 0 ? 1 / analysis.rewardToRisk : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Risk &amp; Probability</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${verdict.pill}`}>{verdict.label}</span>
          {(critical > 0 || warning > 0) && (
            <span className="text-xs text-muted-foreground">
              {critical > 0 && `${critical} critical`}
              {critical > 0 && warning > 0 && " · "}
              {warning > 0 && `${warning} warning${warning === 1 ? "" : "s"}`}
            </span>
          )}
        </div>
        <span className="text-xs text-muted-foreground">
          {analysis.analysedCount} of {analysis.openCount} position{analysis.openCount === 1 ? "" : "s"} analysed
          {asOf ? ` · ${new Date(asOf).toLocaleTimeString("en-IN")}` : ""}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile
          label="Probability of Profit"
          value={formatPop(analysis.pop)}
          valueClass={popColorClass(analysis.pop)}
          hint="Market-implied, at expiry"
        >
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${popBarClass(analysis.pop)}`}
              style={{ width: `${Math.round(analysis.pop * 100)}%` }}
            />
          </div>
        </Tile>
        <Tile
          label="Days to Expiry"
          value={analysis.nearestDte === null ? "—" : formatDte(analysis.nearestDte)}
          valueClass={analysis.nearestDte === null ? undefined : dteColorClass(analysis.nearestDte)}
          hint={analysis.nearestExpiry ? `Nearest · ${formatExpiry(analysis.nearestExpiry)}` : "Nearest expiry"}
        />
        <Tile
          label="Max Drawdown"
          value={analysis.maxLoss === null ? "Unlimited" : `−${formatINR(analysis.maxLoss)}`}
          valueClass="text-loss"
          hint={
            analysis.drawdownUsedPct !== null
              ? `${Math.round(analysis.drawdownUsedPct)}% of the worst case already used`
              : "Worst case at expiry"
          }
        />
        <Tile
          label="Max Profit"
          value={analysis.maxProfit === null ? "Unlimited" : formatINR(analysis.maxProfit)}
          valueClass="text-profit"
          hint="Best case at expiry"
        />
        <Tile
          label="Risk : Reward"
          value={riskPerReward === null ? "—" : `${riskPerReward.toFixed(1)} : 1`}
          valueClass={riskPerReward !== null && riskPerReward > 2 ? "text-warning" : undefined}
          hint={riskPerReward === null ? "One side is unbounded" : "₹ risked per ₹1 of upside"}
        />
        <Tile
          label="Expected P&L"
          value={formatINR(analysis.expectedPnl)}
          valueClass={pnlColorClass(analysis.expectedPnl)}
          hint="Model estimate, before brokerage"
        />
        <Tile
          label="Net Theta / Day"
          value={formatINR(analysis.netThetaPerDay)}
          valueClass={pnlColorClass(analysis.netThetaPerDay)}
          hint={analysis.netThetaPerDay >= 0 ? "Time decay is paying you" : "Time decay is costing you"}
        />
        <Tile
          label="1% Market Move"
          value={formatINR(analysis.pnlPer1PctMove)}
          valueClass={pnlColorClass(analysis.pnlPer1PctMove)}
          hint="P&L change if the index rises 1%"
        />
      </dl>

      <div className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Warning signs</h3>
        {analysis.warnings.length === 0 ? (
          <div className="flex items-start gap-3 rounded-xl border border-profit/30 bg-profit/5 p-4">
            <CheckCircleIcon className="mt-0.5 size-4 shrink-0 text-profit" />
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">Nothing is flashing.</span> No short strikes under pressure,
              no expiry-day exposure, and the odds aren&apos;t stacked against the book.
            </p>
          </div>
        ) : (
          analysis.warnings.map((w) => {
            const s = SEVERITY_STYLES[w.severity];
            return (
              <div key={w.id} className={`flex items-start gap-3 rounded-xl border p-4 ${s.box}`}>
                <AlertCircleIcon className={`mt-0.5 size-4 shrink-0 ${s.text}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {w.title}
                    <span className={`ml-2 text-xs font-semibold uppercase tracking-wide ${s.text}`}>{s.label}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{w.detail}</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      <section className="overflow-hidden rounded-xl border border-border bg-background">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className={`${tableHeadClass} py-3 pl-5 pr-2`}>Position</th>
                <th className={`${tableHeadClass} px-2 py-3`}>Side</th>
                <th className={`${tableHeadClass} px-2 py-3 text-right`}>Expiry</th>
                <th className={`${tableHeadClass} px-2 py-3 text-right`}>Chance of Profit</th>
                <th className={`${tableHeadClass} px-2 py-3 text-right`}>Strike</th>
                <th className={`${tableHeadClass} px-2 py-3 text-right`}>Breakeven</th>
                <th className={`${tableHeadClass} px-2 py-3 text-right`}>1σ Move</th>
                <th className={`${tableHeadClass} px-2 py-3 text-right`}>Max Loss</th>
                <th className={`${tableHeadClass} px-2 py-3 pr-5 text-right`}>Theta / Day</th>
              </tr>
            </thead>
            <tbody>
              {analysis.positions.map((p) => (
                <PositionRow key={p.row.entry.id} p={p} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Probabilities use each option&apos;s live implied volatility, zero drift, and assume all indices move together.
        Figures are at expiry and exclude brokerage — a guide to what to watch, not a forecast.
      </p>
    </div>
  );
}
